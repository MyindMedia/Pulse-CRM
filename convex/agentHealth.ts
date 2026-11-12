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

/* Every read below is an indexed range over only the rows the score uses,
   and each one is capped. The panel sits on the home screen and the fleet
   view runs it once per studio, so it must never grow with a studio's whole
   history (Convex fails a query past 16,384 documents read). Worst case is
   about 8,000 documents. */
export const HEALTH_READ_CAP = 300;
const UNPAID_INVOICE = ["draft", "sent", "viewed", "overdue"] as const;
const OPEN_STAGE = ["inquiry", "qualified", "proposal", "booked", "in_progress", "delivered"] as const;
/** Songs still being made. Delivered and released songs are finished. */
const ACTIVE_SONG = ["writing", "demo", "tracking", "editing", "mixing", "mastering"] as const;

export async function studioHealthFor(ctx: QueryCtx, orgId: string) {
  const now = Date.now();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const cap = HEALTH_READ_CAP;
  const horizon = now + 14 * DAY;

  const [payments, invoiceRuns, sessions, rooms, oppRuns, songRuns, artists] = await Promise.all([
    // Payments made this month only.
    ctx.db.query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId).gte("_creationTime", monthStart.getTime()))
      .take(cap * 4),
    // Unpaid invoices only, status by status.
    Promise.all(UNPAID_INVOICE.map((status) =>
      ctx.db.query("invoices").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status)).take(cap))),
    // Sessions starting in the next 14 days only.
    ctx.db.query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now).lte("startTime", horizon))
      .take(cap * 4),
    ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(cap),
    // Open opportunities only, stage by stage.
    Promise.all(OPEN_STAGE.map((stage) =>
      ctx.db.query("opportunities").withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", stage)).take(cap))),
    // Songs still in production only, stage by stage.
    Promise.all(ACTIVE_SONG.map((stage) =>
      ctx.db.query("songs").withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", stage)).take(cap))),
    // The most recent clients: retention is a share, so a recent sample is enough.
    ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(cap * 4),
  ]);
  const unpaid = invoiceRuns.flat();
  const opps = oppRuns.flat();
  const songs = songRuns.flat();

  // 1. Revenue health (30) - collection rate, penalize overdue.
  const paidThisMonth = payments.filter((p) => p.status === "paid").reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const overdue = unpaid.filter((i) => (i.dueDate ?? Infinity) < now);
  const overdueCents = overdue.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const collectBase = paidThisMonth + overdueCents;
  const collectionRate = collectBase > 0 ? paidThisMonth / collectBase : 0.8;
  const revenue = clamp(collectionRate * 100 - Math.min(overdue.length * 6, 30));

  // 2. Booking utilization (20) - session-hours next 14d vs bookable capacity.
  const bookable = rooms.filter((r) => r.bookable !== false && r.status !== "retired");
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
