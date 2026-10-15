import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  googleCalendarUpsertEvent,
  googleCalendarDeleteEvent,
  googleConfigured,
  isInvalidGrant,
  PULSE_ORIGIN_TAG,
  type GoogleCalendarEventBody,
} from "./lib/google";
import { studioPushesGoogle } from "./lib/roomBusy";

/* ============================================================
   Two-way Google Calendar sync.

   When a studio is connected to its Google account, every booking
   created or changed in Pulse is pushed onto their primary calendar so
   the studio's source-of-truth schedule reflects Pulse bookings.
   Cancellations remove the Google event. The push is started by a
   trigger on the sessions table (lib/googleCalendarTrigger.ts), so no
   booking path can skip it. The mapper layer is pure so its
   serialisation is unit-tested without the network.

   Read-direction (Google -> Pulse) lives in googleCalendarSync.ts:
   a cron pulls the connected primary calendar's events in as org-wide
   busy blocks (Pulse-origin events skipped). The legacy iCal feed in
   externalCalendars.ts still works for studios who paste a URL.
   ============================================================ */

export type SessionForCalendar = {
  title: string;
  startTime: number;
  endTime: number;
  status: "tentative" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  serviceType?: string;
  /** Booking-request state (sessions.requestStatus). Unset on ordinary bookings. */
  requestStatus?: "pending" | "approved" | "declined";
};

/** Pure: Pulse session -> Google Calendar event body. Status maps onto the
 *  three Google states (`confirmed` / `tentative` / `cancelled`). */
export function sessionToCalendarEvent(
  session: SessionForCalendar,
  opts?: { studioName?: string },
): GoogleCalendarEventBody {
  // A declined request leaves Google; a pending one shows tentative even if
  // its slot is held as confirmed; approved and confirmed show as confirmed.
  const googleStatus: "confirmed" | "tentative" | "cancelled" =
    session.status === "cancelled" || session.status === "no_show" || session.requestStatus === "declined"
      ? "cancelled"
      : session.status === "tentative" || session.requestStatus === "pending"
        ? "tentative"
        : "confirmed";

  const serviceLine = session.serviceType ? ` (${session.serviceType})` : "";
  const studio = opts?.studioName ?? "the studio";

  return {
    summary: `${session.title}${serviceLine}`,
    description: `Session at ${studio}. Synced from Pulse.`,
    start: { dateTime: new Date(session.startTime).toISOString() },
    end: { dateTime: new Date(session.endTime).toISOString() },
    status: googleStatus,
    transparency: "opaque",
    // Tag so the inbound pull recognises this as a Pulse-origin event and
    // skips it (prevents the session looping back in as a busy block).
    extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } },
  };
}

/** Pure: the Google event id a session is written under. Google allows the
 *  characters 0-9 and a-v; hex of the Convex id stays inside them, so every
 *  push for one booking addresses the same event. */
export function pulseEventId(sessionId: string): string {
  return `pulse${Array.from(new TextEncoder().encode(sessionId), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** A failed Google call, recorded where the owner can see it. A revoked or
 *  expired grant (invalid_grant) clears the token so nothing keeps retrying and
 *  the settings card offers "Reconnect Google"; any other failure is written to
 *  the studio's push error so it stops being invisible. */
export async function recordGoogleFailure(ctx: ActionCtx, orgId: string, where: string, err: unknown): Promise<void> {
  console.error(`[googleCalendar.${where}]`, err);
  if (isInvalidGrant(err)) {
    await ctx.runMutation(internal.googleAuth._markReconnect, { orgId });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  await ctx.runMutation(internal.googleCalendar._recordPushError, { orgId, error: message.slice(0, 300) });
}

export const _recordPushError = internalMutation({
  args: { orgId: v.string(), error: v.string() },
  handler: async (ctx, { orgId, error }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) await ctx.db.patch(org._id, { googleCalendarPushError: error, googleCalendarPushErrorAt: Date.now() });
  },
});

export const _clearPushError = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org?.googleCalendarPushError) {
      await ctx.db.patch(org._id, { googleCalendarPushError: undefined, googleCalendarPushErrorAt: undefined });
    }
  },
});

/** Internal: where this studio pushes. Null when it is not connected or its
 *  sync direction does not push (pull and off). */
export const _orgPushTarget = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org?.googleRefreshToken || !studioPushesGoogle(org)) return null;
    return {
      orgId,
      studioName: org.name ?? "Studio",
      googleRefreshToken: org.googleRefreshToken,
      calendarId: org.googleCalendarId ?? "primary",
      hadPushError: Boolean(org.googleCalendarPushError),
    };
  },
});

/** Internal: everything an action needs to push one session. Null when the
 *  org is not Google-connected, does not push, or the booking is gone. */
export const _pushContext = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", session.orgId)).first();
    if (!org?.googleRefreshToken || !studioPushesGoogle(org)) return null;
    return {
      orgId: session.orgId,
      studioName: org.name ?? "Studio",
      googleRefreshToken: org.googleRefreshToken,
      calendarId: org.googleCalendarId ?? "primary",
      hadPushError: Boolean(org.googleCalendarPushError),
      googleCalendarEventId: session.googleCalendarEventId ?? null,
      session: {
        title: session.title,
        startTime: session.startTime,
        endTime: session.endTime,
        status: session.status,
        serviceType: session.serviceType,
        requestStatus: session.requestStatus,
      },
    };
  },
});

export const _writebackEventId = internalMutation({
  args: { sessionId: v.id("sessions"), eventId: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionId, eventId }) => {
    await ctx.db.patch(sessionId, { googleCalendarEventId: eventId ?? undefined });
  },
});

/** Mirror a Pulse session onto the studio's chosen Google calendar: written
 *  (created or updated) while it is live, removed once it is cancelled, a
 *  no-show or a declined request. No-op when Google is not configured, the
 *  studio is not connected, or its direction does not push. A failure is
 *  recorded on the studio, never thrown into the booking. */
export const pushSession = internalAction({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.googleCalendar._pushContext, { sessionId });
    if (!c) return; // not connected, or direction does not push; silent no-op
    const body = sessionToCalendarEvent(c.session, { studioName: c.studioName });
    const eventId = c.googleCalendarEventId ?? pulseEventId(sessionId);
    try {
      if (body.status === "cancelled") {
        await googleCalendarDeleteEvent(c.googleRefreshToken, eventId, c.calendarId);
        if (c.googleCalendarEventId) {
          await ctx.runMutation(internal.googleCalendar._writebackEventId, { sessionId, eventId: null });
        }
      } else {
        const res = await googleCalendarUpsertEvent(c.googleRefreshToken, body, eventId, c.calendarId);
        if (res.eventId !== c.googleCalendarEventId) {
          await ctx.runMutation(internal.googleCalendar._writebackEventId, { sessionId, eventId: res.eventId });
        }
      }
      if (c.hadPushError) await ctx.runMutation(internal.googleCalendar._clearPushError, { orgId: c.orgId });
    } catch (err) {
      await recordGoogleFailure(ctx, c.orgId, "pushSession", err);
    }
  },
});

/** Remove the Google event of a session or room block deleted from Pulse. */
export const removeEvent = internalAction({
  args: { orgId: v.string(), eventId: v.string() },
  handler: async (ctx, { orgId, eventId }) => {
    if (!googleConfigured()) return;
    const target = await ctx.runQuery(internal.googleCalendar._orgPushTarget, { orgId });
    if (!target) return;
    try {
      await googleCalendarDeleteEvent(target.googleRefreshToken, eventId, target.calendarId);
    } catch (err) {
      await recordGoogleFailure(ctx, orgId, "removeEvent", err);
    }
  },
});

/* ---------- room blocks ---------- */

export type RoomBlockForCalendar = { label: string; startTime: number; endTime: number; roomName?: string; note?: string };

/** Pure: a room block -> a busy Google event titled with the block's label. */
export function roomBlockToCalendarEvent(block: RoomBlockForCalendar, opts?: { studioName?: string }): GoogleCalendarEventBody {
  const where = block.roomName ? ` Room: ${block.roomName}.` : "";
  return {
    summary: block.label,
    description: `Room block at ${opts?.studioName ?? "the studio"}.${where} Synced from Pulse.`,
    start: { dateTime: new Date(block.startTime).toISOString() },
    end: { dateTime: new Date(block.endTime).toISOString() },
    status: "confirmed",
    transparency: "opaque",
    extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } },
  };
}

export const _blockPushContext = internalQuery({
  args: { blockId: v.id("roomBlocks") },
  handler: async (ctx, { blockId }) => {
    const block = await ctx.db.get(blockId);
    if (!block) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", block.orgId)).first();
    if (!org?.googleRefreshToken || !studioPushesGoogle(org)) return null;
    const room = await ctx.db.get(block.roomId);
    return {
      orgId: block.orgId,
      studioName: org.name ?? "Studio",
      googleRefreshToken: org.googleRefreshToken,
      calendarId: org.googleCalendarId ?? "primary",
      hadPushError: Boolean(org.googleCalendarPushError),
      googleCalendarEventId: block.googleCalendarEventId ?? null,
      block: { label: block.label, startTime: block.startTime, endTime: block.endTime, roomName: room?.name, note: block.note },
    };
  },
});

export const _writebackBlockEventId = internalMutation({
  args: { blockId: v.id("roomBlocks"), eventId: v.string() },
  handler: async (ctx, { blockId, eventId }) => {
    await ctx.db.patch(blockId, { googleCalendarEventId: eventId });
  },
});

/** Mirror a room block onto the studio calendar as a busy event. */
export const pushRoomBlock = internalAction({
  args: { blockId: v.id("roomBlocks") },
  handler: async (ctx, { blockId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.googleCalendar._blockPushContext, { blockId });
    if (!c) return;
    const body = roomBlockToCalendarEvent(c.block, { studioName: c.studioName });
    const eventId = c.googleCalendarEventId ?? pulseEventId(blockId);
    try {
      const res = await googleCalendarUpsertEvent(c.googleRefreshToken, body, eventId, c.calendarId);
      if (res.eventId !== c.googleCalendarEventId) {
        await ctx.runMutation(internal.googleCalendar._writebackBlockEventId, { blockId, eventId: res.eventId });
      }
      if (c.hadPushError) await ctx.runMutation(internal.googleCalendar._clearPushError, { orgId: c.orgId });
    } catch (err) {
      await recordGoogleFailure(ctx, c.orgId, "pushRoomBlock", err);
    }
  },
});
