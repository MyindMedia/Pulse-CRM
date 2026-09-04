import { query } from "./_generated/server";
import { mutation } from "./functions";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability } from "./lib/access";
import { currentOrg, currentOrgWithCapability, assertOrg } from "./lib/tenant";
import { payoutForSession, payoutTotals } from "./lib/payoutMath";

/* ============================================================
   Engineer payouts.

   A session ends, and the studio owes the engineer something. Today
   that is worked out in somebody's head at the end of the month.

   This queues it at the moment the session completes, from whichever
   basis that teammate is on, with the arithmetic attached. Nothing
   pays itself: a payout sits in "queued" until a human approves it,
   and only a second, separate action marks it paid. The money leaving
   the building is always somebody's decision.
   ============================================================ */

/** Hours clocked against one session, from the time clock. */
async function clockedHours(
  ctx: MutationCtx,
  orgId: string,
  memberId: Id<"members">,
  session: Doc<"sessions">,
): Promise<number> {
  const entries = await ctx.db
    .query("timeEntries")
    .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", memberId))
    .collect();
  let ms = 0;
  for (const e of entries) {
    const out = e.clockOutAt;
    if (!out) continue;
    // Overlap between the punch and the session window, so a shift spanning
    // two sessions is not billed twice to the same one.
    const from = Math.max(e.clockInAt, session.startTime);
    const to = Math.min(out, session.endTime);
    if (to > from) ms += to - from;
  }
  return ms / 3_600_000;
}

/**
 * Queue the engineer's cut for a completed session.
 *
 * Called from the session-completion fan-out. Idempotent: a session that is
 * completed, reopened and completed again does not pay twice.
 */
export async function queuePayoutForSession(
  ctx: MutationCtx,
  session: Doc<"sessions">,
): Promise<Id<"payouts"> | null> {
  const memberId = session.engineerId;
  if (!memberId) return null;

  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", session.orgId))
    .first();
  if (org?.autoPayouts !== true) return null;

  // Never pay the same session twice.
  const existing = await ctx.db
    .query("payouts")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .collect();
  if (existing.some((p) => p.status !== "void")) return null;

  const member = await ctx.db.get(memberId);
  if (!member || member.orgId !== session.orgId) return null;

  const result = payoutForSession({
    payType: member.payType,
    commissionPct: member.commissionPct,
    pointsPerSession: member.pointsPerSession,
    payRateCents: member.payRateCents,
    sessionRateCents: session.rateCents,
    hours: member.payType === "hourly"
      ? await clockedHours(ctx, session.orgId, memberId, session)
      : undefined,
    pointValueCents: org?.pointValueCents,
  });
  // No basis configured is not the same as owing nothing. Queue nothing and
  // let payroll stay the source of truth for that person.
  if (!result || result.amountCents <= 0) return null;

  const payoutId = await ctx.db.insert("payouts", {
    orgId: session.orgId,
    memberId,
    sessionId: session._id,
    basis: result.basis,
    amountCents: result.amountCents,
    explanation: result.explanation,
    status: "queued",
    sessionRateCents: result.snapshot.sessionRateCents,
    commissionPctSnapshot: result.snapshot.commissionPct,
    pointsSnapshot: result.snapshot.points,
    pointValueCentsSnapshot: result.snapshot.pointValueCents,
    hoursSnapshot: result.snapshot.hours,
    createdAt: Date.now(),
  });

  await ctx.db.insert("activity", {
    orgId: session.orgId,
    kind: "payout.queued",
    summary: `Payout queued - ${member.name}, ${result.explanation}`,
    entityType: "session",
    entityId: session._id,
    accent: "gold",
  });
  return payoutId;
}

/** Payouts for the studio, newest first, with each teammate's name attached. */
export const list = query({
  args: {
    status: v.optional(v.union(
      v.literal("queued"), v.literal("approved"), v.literal("paid"), v.literal("void"),
    )),
  },
  handler: async (ctx, { status }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const rows = status
      ? await ctx.db
          .query("payouts")
          .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
          .collect()
      : await ctx.db
          .query("payouts")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();

    const members = new Map(
      (await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
        .map((m) => [m._id as string, m]),
    );

    const items = rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => ({
        ...p,
        memberName: members.get(p.memberId as string)?.name ?? "Removed teammate",
      }));

    return { items, totals: payoutTotals(rows) };
  },
});

/** What this teammate is owed. A staff member may read their OWN payouts. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], totals: payoutTotals([]) };
    const me = (await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()).find((m) => m.clerkUserId === identity.subject);
    if (!me) return { items: [], totals: payoutTotals([]) };

    const rows = await ctx.db
      .query("payouts")
      .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", me._id))
      .collect();
    return {
      items: rows.sort((a, b) => b.createdAt - a.createdAt),
      totals: payoutTotals(rows),
    };
  },
});

async function mineOrThrow(ctx: MutationCtx, id: Id<"payouts">, orgId: string) {
  const p = await ctx.db.get(id);
  assertOrg(p, orgId);
  return p;
}

/** Approve a queued payout. Approving is not paying. */
export const approve = mutation({
  args: { id: v.id("payouts") },
  handler: async (ctx, { id }) => {
    const viewer = await requireCapability(ctx, "insights.read");
    const orgId = await currentOrg(ctx);
    const p = await mineOrThrow(ctx, id, orgId);
    if (p.status !== "queued") {
      throw new ConvexError({ code: "PAYOUT_STATE", message: `That payout is already ${p.status}.` });
    }
    await ctx.db.patch(id, {
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: (viewer as { clerkUserId?: string }).clerkUserId ?? "system",
    });
  },
});

/** Mark an approved payout as paid, and post it into the P&L as labor cost. */
export const markPaid = mutation({
  args: { id: v.id("payouts"), note: v.optional(v.string()) },
  handler: async (ctx, { id, note }) => {
    const viewer = await requireCapability(ctx, "insights.read");
    const orgId = await currentOrg(ctx);
    const p = await mineOrThrow(ctx, id, orgId);
    if (p.status !== "approved") {
      throw new ConvexError({
        code: "PAYOUT_STATE",
        message: "Approve the payout before marking it paid.",
      });
    }
    const member = await ctx.db.get(p.memberId);
    // Post it into the P&L the same way payroll does, so labor cost is one
    // number wherever you read it from.
    const expenseId = await ctx.db.insert("expenses", {
      orgId,
      category: "payroll",
      vendor: member?.name ?? "Engineer payout",
      description: `Session payout - ${p.explanation}`,
      amountCents: p.amountCents,
      date: Date.now(),
      memberId: p.memberId,
      notes: note?.trim() || undefined,
      createdBy: (viewer as { clerkUserId?: string }).clerkUserId ?? "system",
    });
    await ctx.db.patch(id, {
      status: "paid",
      paidAt: Date.now(),
      paidBy: (viewer as { clerkUserId?: string }).clerkUserId ?? "system",
      note: note ?? p.note,
      expenseId,
    });
  },
});

/** Void a payout that should not have been queued. Never deletes: the row is
 *  the record that somebody decided not to pay it. */
export const voidPayout = mutation({
  args: { id: v.id("payouts"), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    await requireCapability(ctx, "insights.read");
    const orgId = await currentOrg(ctx);
    const p = await mineOrThrow(ctx, id, orgId);
    if (p.status === "paid") {
      throw new ConvexError({
        code: "PAYOUT_STATE",
        message: "That payout is already paid. Record a correction instead of voiding it.",
      });
    }
    await ctx.db.patch(id, { status: "void", note: reason.trim() || p.note });
  },
});

/** A manager entering a payout by hand - a bonus, a correction, a one-off. */
export const createManual = mutation({
  args: {
    memberId: v.id("members"),
    amountCents: v.number(),
    note: v.string(),
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, { memberId, amountCents, note, sessionId }) => {
    await requireCapability(ctx, "insights.read");
    const orgId = await currentOrg(ctx);
    const member = await ctx.db.get(memberId);
    assertOrg(member, orgId);
    if (amountCents <= 0) throw new Error("A payout has to be more than zero.");
    return await ctx.db.insert("payouts", {
      orgId,
      memberId,
      sessionId,
      basis: "manual",
      amountCents: Math.round(amountCents),
      explanation: note.trim() || "Manual payout",
      status: "queued",
      createdAt: Date.now(),
    });
  },
});

/** Studio settings for the payout engine. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return {
      autoPayouts: org?.autoPayouts === true,
      pointValueCents: org?.pointValueCents ?? 0,
    };
  },
});

export const setSettings = mutation({
  args: {
    autoPayouts: v.optional(v.boolean()),
    pointValueCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "insights.read");
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");
    await ctx.db.patch(org._id, {
      ...(args.autoPayouts !== undefined ? { autoPayouts: args.autoPayouts } : {}),
      ...(args.pointValueCents !== undefined
        ? { pointValueCents: Math.max(0, Math.round(args.pointValueCents)) }
        : {}),
    });
  },
});
