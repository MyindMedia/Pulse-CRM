import { query, internalQuery, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   Studio Health - a deterministic, explainable 0-100 score the
   agent interprets (it never computes business-critical metrics
   from raw records itself). Six weighted sub-scores per spec 13.2.
   ============================================================ */

const DAY = 86_400_000;

type Component = { key: string; label: string; score: number; weight: number; signal: string };

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

export async function studioHealthFor(ctx: QueryCtx, orgId: string) {
  const now = Date.now();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const payments = await ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const invoices = await ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const opps = await ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();

  // 1. Revenue health (30) - collection rate, penalize overdue.
  const paidThisMonth = payments.filter((p) => p.status === "paid" && p._creationTime >= monthStart.getTime()).reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const unpaid = invoices.filter((i) => i.status !== "paid" && i.status !== "void");
  const overdue = unpaid.filter((i) => (i.dueDate ?? Infinity) < now);
  const overdueCents = overdue.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const collectBase = paidThisMonth + overdueCents;
  const collectionRate = collectBase > 0 ? paidThisMonth / collectBase : 0.8;
  const revenue = clamp(collectionRate * 100 - Math.min(overdue.length * 6, 30));

  // 2. Booking utilization (20) - session-hours next 14d vs bookable capacity.
  const bookable = rooms.filter((r) => r.bookable !== false && r.status !== "retired");
  const horizon = now + 14 * DAY;
  const bookedHours = sessions
    .filter((s) => s.startTime >= now && s.startTime <= horizon && s.status !== "cancelled" && s.status !== "no_show")
    .reduce((sum, s) => sum + (s.endTime - s.startTime) / 3_600_000, 0);
  const capacityHours = Math.max(1, bookable.length * 14 * 8); // 8 sellable hours/day
  const utilization = clamp((bookedHours / capacityHours) * 100 * 2.2); // scale: ~45% util = full marks

  // 3. Lead pipeline (20) - open volume, penalize stale.
  const openOpps = opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const stale = openOpps.filter((o) => (o._creationTime ?? now) < now - 14 * DAY);
  const staleRatio = openOpps.length > 0 ? stale.length / openOpps.length : 0;
  const leads = clamp((openOpps.length > 0 ? 70 : 40) + Math.min(openOpps.length * 4, 30) - staleRatio * 50);

  // 4. Client retention (15) - repeat clients share.
  const withSessions = artists.filter((a) => (a.sessionCount ?? 0) > 0);
  const repeat = withSessions.filter((a) => (a.sessionCount ?? 0) > 1);
  const retention = clamp(withSessions.length > 0 ? (repeat.length / withSessions.length) * 100 : 60);

  // 5. Project completion (10) - active songs progressing, penalize stalled.
  const activeSongs = songs.filter((s) => s.stage !== "delivered");
  const stalled = activeSongs.filter((s) => (s._creationTime ?? now) < now - 21 * DAY);
  const projects = clamp(activeSongs.length === 0 ? 70 : 100 - (stalled.length / activeSongs.length) * 70);

  // 6. Automation coverage (5) - is the agent engaged.
  const policy = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  const automation = clamp(policy?.enabled ? (policy.digestEnabled ? 90 : 65) : 30);

  const components: Component[] = [
    { key: "revenue", label: "Revenue health", score: revenue, weight: 30, signal: `${overdue.length} overdue invoice(s), ${(collectionRate * 100).toFixed(0)}% collection rate` },
    { key: "utilization", label: "Booking utilization", score: utilization, weight: 20, signal: `${Math.round(bookedHours)}h booked of ~${capacityHours}h capacity next 14 days` },
    { key: "leads", label: "Lead pipeline", score: leads, weight: 20, signal: `${openOpps.length} open leads, ${stale.length} stale` },
    { key: "retention", label: "Client retention", score: retention, weight: 15, signal: `${repeat.length}/${withSessions.length} clients are repeat` },
    { key: "projects", label: "Project completion", score: projects, weight: 10, signal: `${activeSongs.length} active songs, ${stalled.length} stalled` },
    { key: "automation", label: "Automation coverage", score: automation, weight: 5, signal: policy?.enabled ? "agent on" : "agent off" },
  ];
  const overall = clamp(components.reduce((s, c) => s + c.score * c.weight, 0) / 100);
  const band = overall >= 75 ? "strong" : overall >= 55 ? "steady" : overall >= 40 ? "watch" : "at risk";

  return { overall, band, components };
}

export const studioHealth = query({
  args: {},
  handler: async (ctx) => studioHealthFor(ctx, await currentOrg(ctx)),
});

export const _healthFor = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => studioHealthFor(ctx, orgId),
});
