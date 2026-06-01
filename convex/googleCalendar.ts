import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  googleCalendarUpsertEvent,
  googleCalendarDeleteEvent,
  googleConfigured,
  PULSE_ORIGIN_TAG,
  type GoogleCalendarEventBody,
} from "./lib/google";

/* ============================================================
   Two-way Google Calendar sync.

   When a studio is connected to its Google account, every session
   created or status-changed in Pulse is pushed onto their primary
   calendar so the studio's source-of-truth schedule reflects Pulse
   bookings. Cancellations remove the Google event. The mapper layer
   is pure so its serialisation is unit-tested without the network.

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
};

/** Pure: Pulse session -> Google Calendar event body. Status maps onto the
 *  three Google states (`confirmed` / `tentative` / `cancelled`). */
export function sessionToCalendarEvent(
  session: SessionForCalendar,
  opts?: { studioName?: string },
): GoogleCalendarEventBody {
  const googleStatus: "confirmed" | "tentative" | "cancelled" =
    session.status === "cancelled" || session.status === "no_show"
      ? "cancelled"
      : session.status === "tentative"
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
    // Tag so the inbound pull recognises this as a Pulse-origin event and
    // skips it (prevents the session looping back in as a busy block).
    extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } },
  };
}

/** Internal: everything an action needs to push one session. Null when the
 *  org is not Google-connected or when the studio's record is gone. */
export const _pushContext = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", session.orgId)).first();
    if (!org?.googleRefreshToken) return null;
    return {
      orgId: session.orgId,
      studioName: org.name ?? "Studio",
      googleRefreshToken: org.googleRefreshToken,
      googleCalendarEventId: session.googleCalendarEventId ?? null,
      session: {
        title: session.title,
        startTime: session.startTime,
        endTime: session.endTime,
        status: session.status,
        serviceType: session.serviceType,
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

/** Push a Pulse session to the studio's Google primary calendar.
 *  No-op when Google is not configured or the studio is not connected. */
export const pushSession = internalAction({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.googleCalendar._pushContext, { sessionId });
    if (!c) return; // not connected; silent no-op
    const body = sessionToCalendarEvent(c.session, { studioName: c.studioName });
    try {
      const res = await googleCalendarUpsertEvent(c.googleRefreshToken, body, c.googleCalendarEventId ?? undefined);
      if (!c.googleCalendarEventId) {
        await ctx.runMutation(internal.googleCalendar._writebackEventId, {
          sessionId,
          eventId: res.eventId,
        });
      }
    } catch (err) {
      console.error("[googleCalendar.pushSession]", err);
    }
  },
});

/** Remove a Pulse session from the studio's Google primary calendar. */
export const removeSession = internalAction({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.googleCalendar._pushContext, { sessionId });
    if (!c || !c.googleCalendarEventId) return;
    try {
      await googleCalendarDeleteEvent(c.googleRefreshToken, c.googleCalendarEventId);
      await ctx.runMutation(internal.googleCalendar._writebackEventId, { sessionId, eventId: null });
    } catch (err) {
      console.error("[googleCalendar.removeSession]", err);
    }
  },
});

/** Schedule a push for one session, safe to call from any mutation. No-op when
 *  the org is not Google-connected (the action itself checks again). */
export async function scheduleGoogleCalendarPush(
  ctx: { scheduler: { runAfter: (delay: number, fn: typeof internal.googleCalendar.pushSession, args: { sessionId: Id<"sessions"> }) => Promise<unknown> } },
  sessionId: Id<"sessions">,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.googleCalendar.pushSession, { sessionId });
}

/** Schedule a remove for one session. */
export async function scheduleGoogleCalendarRemove(
  ctx: { scheduler: { runAfter: (delay: number, fn: typeof internal.googleCalendar.removeSession, args: { sessionId: Id<"sessions"> }) => Promise<unknown> } },
  sessionId: Id<"sessions">,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.googleCalendar.removeSession, { sessionId });
}
