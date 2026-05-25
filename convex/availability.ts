import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { requireCapability, resolveViewer, AccessError } from "./lib/access";
import { notify } from "./lib/notify";

/* Staff self-service: weekly availability + time-off requests. */

/** The signed-in staff member (mapped via Clerk id), or null. */
async function myMember(ctx: QueryCtx | MutationCtx): Promise<Doc<"members"> | null> {
  const orgId = await currentOrg(ctx);
  const viewer = await resolveViewer(ctx).catch(() => null);
  const clerkUserId = viewer && "clerkUserId" in viewer ? viewer.clerkUserId : null;
  if (!clerkUserId) return null;
  return await ctx.db
    .query("members")
    .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
    .first();
}

// ── Availability (staff sets their own) ─────────────────────

export const myAvailability = query({
  args: {},
  handler: async (ctx) => {
    const me = await myMember(ctx);
    if (!me) return { member: null, slots: [] };
    const slots = await ctx.db
      .query("availability")
      .withIndex("by_org_member", (q) => q.eq("orgId", me.orgId).eq("memberId", me._id))
      .collect();
    return {
      member: { _id: me._id, name: me.name },
      slots: slots
        .map((s) => ({ _id: s._id, weekday: s.weekday, startMinutes: s.startMinutes, endMinutes: s.endMinutes }))
        .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes),
    };
  },
});

/** Replace the caller's weekly availability with the given slots. */
export const setMyAvailability = mutation({
  args: {
    slots: v.array(
      v.object({ weekday: v.number(), startMinutes: v.number(), endMinutes: v.number() }),
    ),
  },
  handler: async (ctx, { slots }) => {
    const me = await myMember(ctx);
    if (!me) throw new Error("Only team members can set availability.");
    const existing = await ctx.db
      .query("availability")
      .withIndex("by_org_member", (q) => q.eq("orgId", me.orgId).eq("memberId", me._id))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const s of slots) {
      if (s.endMinutes <= s.startMinutes || s.weekday < 0 || s.weekday > 6) continue;
      await ctx.db.insert("availability", {
        orgId: me.orgId,
        memberId: me._id,
        weekday: s.weekday,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
      });
    }
  },
});

// ── Time-off (request + approve) ────────────────────────────

export const myTimeOff = query({
  args: {},
  handler: async (ctx) => {
    const me = await myMember(ctx);
    if (!me) return [];
    return (
      await ctx.db
        .query("timeOff")
        .withIndex("by_org_member", (q) => q.eq("orgId", me.orgId).eq("memberId", me._id))
        .collect()
    ).sort((a, b) => b.startTime - a.startTime);
  },
});

export const requestTimeOff = mutation({
  args: { startTime: v.number(), endTime: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await myMember(ctx);
    if (!me) throw new Error("Only team members can request time off.");
    if (args.endTime <= args.startTime) throw new Error("End must be after start.");
    return await ctx.db.insert("timeOff", {
      orgId: me.orgId,
      memberId: me._id,
      startTime: args.startTime,
      endTime: args.endTime,
      reason: args.reason?.trim() || undefined,
      status: "pending",
    });
  },
});

/** Manager view: pending time-off requests with the requester's name. */
export const pendingTimeOff = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    // Managers only - degrade to [] for everyone else so the inbox simply
    // doesn't render (no throw into a boundary-less page).
    try {
      await requireCapability(ctx, "schedule.manage");
    } catch (e) {
      if (e instanceof AccessError) return [];
      throw e;
    }
    const rows = await ctx.db
      .query("timeOff")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .collect();
    return Promise.all(
      rows
        .sort((a, b) => a.startTime - b.startTime)
        .map(async (r) => {
          const m = await ctx.db.get(r.memberId);
          return { ...r, memberName: m?.name ?? "-" };
        }),
    );
  },
});

export const decideTimeOff = mutation({
  args: { id: v.id("timeOff"), decision: v.union(v.literal("approved"), v.literal("denied")) },
  handler: async (ctx, { id, decision }) => {
    const orgId = await currentOrg(ctx);
    const viewer = await requireCapability(ctx, "schedule.manage");
    const req = await ctx.db.get(id);
    if (!req || req.orgId !== orgId) throw new Error("Request not found");
    await ctx.db.patch(id, {
      status: decision,
      decidedBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
    });
    const member = await ctx.db.get(req.memberId);
    if (member?.email) {
      const when = new Date(req.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: member.email,
        subject: `Time off ${decision}`,
        body: `Your time-off request starting ${when} was ${decision}.`,
        kind: "timeoff.decided",
      });
    }
  },
});
