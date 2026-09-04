import { query } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { currentOrgWithCapability } from "./lib/tenant";

/* ============================================================
   Recovery ledger - the "Recovered by Pulse" ROI engine. Every
   dollar Pulse actively saves or recovers (forfeited deposits,
   cancellation / no-show fees, waitlist backfills, reminder-driven
   collections) is recorded here so the owner sees a running number
   proving the subscription pays for itself.

   `record` is internal - called from the flows that recover money
   (No-Show Shield, waitlist fill, dunning). `summary` is the
   read for the dashboard tile + monthly recap.
   ============================================================ */

const kindV = v.union(
  v.literal("deposit_forfeited"),
  v.literal("cancellation_fee"),
  v.literal("no_show_fee"),
  v.literal("waitlist_fill"),
  v.literal("reminder_collected"),
);

/** Record a recovered-dollars event. Idempotency is the caller's job (pass a
 *  stable sessionId/invoiceId and check before calling if a flow can re-fire). */
export const record = internalMutation({
  args: {
    orgId: v.string(),
    kind: kindV,
    amountCents: v.number(),
    at: v.optional(v.number()),
    sessionId: v.optional(v.id("sessions")),
    invoiceId: v.optional(v.id("invoices")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.amountCents <= 0) return null;
    return await ctx.db.insert("recoveryEvents", {
      orgId: args.orgId,
      kind: args.kind,
      amountCents: args.amountCents,
      at: args.at ?? Date.now(),
      sessionId: args.sessionId,
      invoiceId: args.invoiceId,
      note: args.note,
    });
  },
});

const LABELS: Record<string, string> = {
  deposit_forfeited: "Forfeited deposits",
  cancellation_fee: "Late-cancel fees",
  no_show_fee: "No-show fees",
  waitlist_fill: "Waitlist backfills",
  reminder_collected: "Reminder-driven payments",
};

/** Recovered-dollars roll-up: all-time, this month, last 30 days, and a
 *  by-kind breakdown, plus the most recent events. insights.read gated. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();
    const monthStart = (() => {
      const d = new Date(now);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    })();
    const thirtyAgo = now - 30 * 86_400_000;

    const events = await ctx.db
      .query("recoveryEvents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    let totalCents = 0;
    let thisMonthCents = 0;
    let last30Cents = 0;
    const byKindMap = new Map<string, number>();
    for (const e of events) {
      totalCents += e.amountCents;
      if (e.at >= monthStart) thisMonthCents += e.amountCents;
      if (e.at >= thirtyAgo) last30Cents += e.amountCents;
      byKindMap.set(e.kind, (byKindMap.get(e.kind) ?? 0) + e.amountCents);
    }
    const byKind = [...byKindMap.entries()]
      .map(([kind, amountCents]) => ({ kind, label: LABELS[kind] ?? kind, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);

    const recent = events
      .sort((a, b) => b.at - a.at)
      .slice(0, 10)
      .map((e) => ({ _id: e._id, kind: e.kind, label: LABELS[e.kind] ?? e.kind, amountCents: e.amountCents, at: e.at, note: e.note ?? null }));

    return { totalCents, thisMonthCents, last30Cents, byKind, recent, count: events.length };
  },
});
