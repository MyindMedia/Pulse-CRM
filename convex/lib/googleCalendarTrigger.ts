import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { googleConfigured } from "./google";

/* Two-way Google Calendar, outbound half: every change to a booking reaches the
   studio's Google calendar, whichever mutation made it. Registered as a trigger
   on `sessions` in functions.ts, so a booking path cannot forget it (the public
   booking page, deposit and SMS confirmations and the waitlist used to skip
   it). The Google call itself is scheduled, never made inline: Google being
   slow or down must not block a booking. */

/** The fields a Google event is built from (googleCalendar.sessionToCalendarEvent).
 *  A change to anything else, such as payments or notes, does not push. */
export const CALENDAR_FIELDS = ["title", "startTime", "endTime", "status", "serviceType"] as const;

export type SessionChange = {
  id: Id<"sessions">;
  operation: "insert" | "update" | "delete";
  oldDoc: Doc<"sessions"> | null;
  newDoc: Doc<"sessions"> | null;
};

/** Pure: what one change to a session asks of Google, if anything. */
export function googleWorkFor(change: SessionChange): { kind: "push" } | { kind: "remove"; eventId: string } | null {
  if (change.operation === "delete") {
    const eventId = change.oldDoc?.googleCalendarEventId;
    return eventId ? { kind: "remove", eventId } : null;
  }
  const { oldDoc, newDoc } = change;
  if (change.operation === "update" && oldDoc && newDoc && CALENDAR_FIELDS.every((f) => oldDoc[f] === newDoc[f])) {
    return null;
  }
  return { kind: "push" };
}

/** Schedules the Google push or removal for one session change, when the
 *  studio is connected. */
export async function syncSessionToGoogle(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  change: SessionChange,
): Promise<void> {
  const work = googleWorkFor(change);
  if (!work || !googleConfigured()) return;
  const orgId = (change.newDoc ?? change.oldDoc)?.orgId;
  if (!orgId) return;
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!org?.googleRefreshToken) return;
  if (work.kind === "remove") {
    await ctx.scheduler.runAfter(0, internal.googleCalendar.removeEvent, { orgId, eventId: work.eventId });
  } else {
    await ctx.scheduler.runAfter(0, internal.googleCalendar.pushSession, { sessionId: change.id });
  }
}
