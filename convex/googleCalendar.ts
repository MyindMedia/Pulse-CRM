import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  googleCalendarUpsertEvent,
  googleCalendarDeleteEvent,
  googleConfigured,
  PULSE_ORIGIN_TAG,
  type GoogleCalendarEventBody,
} from "./lib/google";

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

/** Pure: the Google event id a session is written under. Google allows the
 *  characters 0-9 and a-v; hex of the Convex id stays inside them, so every
 *  push for one booking addresses the same event. */
export function pulseEventId(sessionId: string): string {
  return `pulse${Array.from(new TextEncoder().encode(sessionId), (b) => b.toString(16).padStart(2, "0")).join("")}`;
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

/** Mirror a Pulse session onto the studio's Google primary calendar: written
 *  (created or updated) while it is live, removed once it is cancelled or a
 *  no-show. No-op when Google is not configured or the studio is not connected. */
export const pushSession = internalAction({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.googleCalendar._pushContext, { sessionId });
    if (!c) return; // not connected; silent no-op
    const body = sessionToCalendarEvent(c.session, { studioName: c.studioName });
    const eventId = c.googleCalendarEventId ?? pulseEventId(sessionId);
    try {
      if (body.status === "cancelled") {
        await googleCalendarDeleteEvent(c.googleRefreshToken, eventId);
        if (c.googleCalendarEventId) {
          await ctx.runMutation(internal.googleCalendar._writebackEventId, { sessionId, eventId: null });
        }
        return;
      }
      const res = await googleCalendarUpsertEvent(c.googleRefreshToken, body, eventId);
      if (res.eventId !== c.googleCalendarEventId) {
        await ctx.runMutation(internal.googleCalendar._writebackEventId, { sessionId, eventId: res.eventId });
      }
    } catch (err) {
      console.error("[googleCalendar.pushSession]", err);
    }
  },
});

/** The studio's Google refresh token, for an action that has only the org. */
export const _orgRefreshToken = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return org?.googleRefreshToken ?? null;
  },
});

/** Remove the Google event of a session that has been deleted from Pulse. */
export const removeEvent = internalAction({
  args: { orgId: v.string(), eventId: v.string() },
  handler: async (ctx, { orgId, eventId }) => {
    if (!googleConfigured()) return;
    const token = await ctx.runQuery(internal.googleCalendar._orgRefreshToken, { orgId });
    if (!token) return;
    try {
      await googleCalendarDeleteEvent(token, eventId);
    } catch (err) {
      console.error("[googleCalendar.removeEvent]", err);
    }
  },
});
