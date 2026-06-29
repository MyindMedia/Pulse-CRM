import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { resolveViewer } from "./lib/access";

/* ============================================================
   Time clock - self-service clock in / out for studio staff.
   Quick and mobile-first: the viewer is resolved to their own
   member row (from the access viewer's memberId), so a teammate
   can only ever clock THEMSELVES. Admin payroll lives in
   convex/payroll.ts.
   ============================================================ */

const HOUR = 3_600_000;
const MIN = 60_000;

/** The viewer's own member row, or null (unauthenticated / demo sentinel /
 *  agency viewer / cross-org). All self-service clock actions hang off this. */
async function currentMember(
  ctx: QueryCtx,
): Promise<{ orgId: string; member: Doc<"members"> } | null> {
  const viewer = await resolveViewer(ctx).catch(() => null);
  if (!viewer || viewer.kind !== "studio_member") return null;
  const orgId = viewer.orgId;
  const memberId = viewer.memberId as unknown as string;
  if (!memberId || memberId === "demo") return null; // demo owner has no real row
  const member = await ctx.db.get(viewer.memberId).catch(() => null);
  if (!member || member.orgId !== orgId) return null;
  return { orgId, member };
}

/** The member's currently-open entry, if any. */
async function activeEntry(ctx: QueryCtx, memberId: Doc<"members">["_id"]) {
  return await ctx.db
    .query("timeEntries")
    .withIndex("by_member_status", (q) => q.eq("memberId", memberId).eq("status", "active"))
    .first();
}

/**
 * Drives the mobile clock widget. Returns who you are, whether you're on the
 * clock, and whether a prompt should pop:
 *  - "clock_in": a shift of yours is in its window (from 15 min before start to
 *    its end) and you have no open entry covering it.
 *  - "clock_out": you're clocked in and the scheduled end has passed (and you
 *    haven't snoozed the nudge).
 */
export const myStatus = query({
  args: {},
  handler: async (ctx) => {
    const cm = await currentMember(ctx);
    if (!cm) return { member: null, active: null, prompt: null };
    const { orgId, member } = cm;
    const now = Date.now();

    const active = await activeEntry(ctx, member._id);
    const shifts = (
      await ctx.db
        .query("shifts")
        .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", member._id))
        .collect()
    ).filter((s) => s.status !== "cancelled");

    let prompt:
      | { type: "clock_in"; shiftId: string; shiftStart: number; shiftEnd: number }
      | { type: "clock_out"; entryId: string; shiftEnd: number }
      | null = null;

    if (active) {
      const shift = active.shiftId ? shifts.find((s) => s._id === active.shiftId) : null;
      const scheduledEnd = shift?.endTime ?? active.clockInAt + 8 * HOUR;
      const snoozed = active.snoozedUntil && now < active.snoozedUntil;
      if (now >= scheduledEnd && !snoozed) {
        prompt = { type: "clock_out", entryId: active._id, shiftEnd: scheduledEnd };
      }
    } else {
      const windowOpen = shifts
        .filter((s) => now >= s.startTime - 15 * MIN && now <= s.endTime)
        .sort((a, b) => a.startTime - b.startTime)[0];
      if (windowOpen) {
        const completed = await ctx.db
          .query("timeEntries")
          .withIndex("by_member_status", (q) => q.eq("memberId", member._id).eq("status", "completed"))
          .collect();
        const covered = completed.some((e) => e.shiftId === windowOpen._id);
        if (!covered) {
          prompt = {
            type: "clock_in",
            shiftId: windowOpen._id,
            shiftStart: windowOpen.startTime,
            shiftEnd: windowOpen.endTime,
          };
        }
      }
    }

    // Raw shift windows near now (+-12h) + which shifts a completed entry has
    // already covered, so the client can re-evaluate the prompt on a ticking
    // clock (Convex queries don't re-run on a timer, only on data change).
    const near = shifts.filter((s) => s.endTime >= now - 12 * HOUR && s.startTime <= now + 12 * HOUR);
    const completedAll = await ctx.db
      .query("timeEntries")
      .withIndex("by_member_status", (q) => q.eq("memberId", member._id).eq("status", "completed"))
      .collect();

    return {
      member: { _id: member._id, name: member.name },
      active: active
        ? {
            _id: active._id,
            clockInAt: active.clockInAt,
            shiftId: active.shiftId ?? null,
            snoozedUntil: active.snoozedUntil ?? null,
            scheduledEnd: active.shiftId
              ? shifts.find((s) => s._id === active.shiftId)?.endTime ?? active.clockInAt + 8 * HOUR
              : active.clockInAt + 8 * HOUR,
          }
        : null,
      prompt,
      shifts: near.map((s) => ({ _id: s._id, startTime: s.startTime, endTime: s.endTime })),
      coveredShiftIds: completedAll.map((e) => e.shiftId).filter(Boolean) as string[],
    };
  },
});

/** Clock in. Idempotent - if already on the clock, returns the open entry. */
export const clockIn = mutation({
  args: { shiftId: v.optional(v.id("shifts")) },
  handler: async (ctx, { shiftId }) => {
    const cm = await currentMember(ctx);
    if (!cm) throw new Error("Only studio team members can clock in.");
    const { orgId, member } = cm;
    const open = await activeEntry(ctx, member._id);
    if (open) return open._id;
    if (shiftId) {
      const shift = await ctx.db.get(shiftId);
      if (!shift || shift.orgId !== orgId || shift.memberId !== member._id) {
        throw new Error("That shift isn't yours.");
      }
    }
    return await ctx.db.insert("timeEntries", {
      orgId,
      memberId: member._id,
      shiftId,
      clockInAt: Date.now(),
      status: "active",
      rateCentsSnapshot: member.payType === "hourly" ? member.payRateCents : undefined,
      source: "self",
    });
  },
});

/** Clock out - closes your open entry. */
export const clockOut = mutation({
  args: { note: v.optional(v.string()) },
  handler: async (ctx, { note }) => {
    const cm = await currentMember(ctx);
    if (!cm) throw new Error("Only studio team members can clock out.");
    const open = await activeEntry(ctx, cm.member._id);
    if (!open) return null;
    await ctx.db.patch(open._id, {
      clockOutAt: Date.now(),
      status: "completed",
      note: note ?? open.note,
    });
    return open._id;
  },
});

/** "Still working" - snooze the end-of-shift clock-out nudge for a while. */
export const snooze = mutation({
  args: { minutes: v.optional(v.number()) },
  handler: async (ctx, { minutes }) => {
    const cm = await currentMember(ctx);
    if (!cm) return null;
    const open = await activeEntry(ctx, cm.member._id);
    if (!open) return null;
    const m = Math.min(Math.max(minutes ?? 60, 5), 600);
    await ctx.db.patch(open._id, { snoozedUntil: Date.now() + m * MIN });
    return open._id;
  },
});

/** The viewer's own recent time entries (their timesheet). */
export const myEntries = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cm = await currentMember(ctx);
    if (!cm) return [];
    const rows = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_member", (q) => q.eq("orgId", cm.orgId).eq("memberId", cm.member._id))
      .collect();
    return rows.sort((a, b) => b.clockInAt - a.clockInAt).slice(0, limit ?? 20);
  },
});
