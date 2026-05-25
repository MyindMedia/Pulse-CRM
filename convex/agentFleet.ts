import { query, mutation, MutationCtx, QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { resolveViewer } from "./lib/access";
import { DEMO_ORG } from "./lib/tenant";

/* ============================================================
   Agency control plane for Pulse Agent. Lets an agency owner run
   and configure the dedicated per-sub-account agent across every
   studio under their agency. Strictly scoped: an agency member
   only ever sees/touches orgs under their own agencyId.
   ============================================================ */

const AUTONOMY = v.union(v.literal("suggest"), v.literal("auto_low"), v.literal("auto_trusted"));

/** The orgs under the caller's agency (demo seed hidden, staff-scoped). */
async function agencyOrgIds(ctx: QueryCtx | MutationCtx) {
  const viewer = await resolveViewer(ctx).catch(() => null);
  if (!viewer || viewer.kind !== "agency_member") return { viewer: null, orgs: [] as { orgId: string; name: string; slug?: string }[] };
  const all = (await ctx.db.query("orgs").collect()).filter((o) => o.orgId !== DEMO_ORG && o.agencyId === viewer.agencyId);
  const scoped = viewer.scopedSubAccountOrgIds === "all"
    ? all
    : all.filter((o) => (viewer.scopedSubAccountOrgIds as string[]).includes(o.orgId));
  return { viewer, orgs: scoped.map((o) => ({ orgId: o.orgId, name: o.name, slug: o.slug })) };
}

/** One row per sub-account with its agent status, for the agency Agents view. */
export const fleet = query({
  args: {},
  handler: async (ctx) => {
    const { orgs } = await agencyOrgIds(ctx);
    return Promise.all(
      orgs.map(async (o) => {
        const policy = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", o.orgId)).first();
        const pending = await ctx.db
          .query("agentApprovals")
          .withIndex("by_org_status", (q) => q.eq("orgId", o.orgId).eq("status", "pending"))
          .collect();
        const insights = await ctx.db
          .query("agentInsights")
          .withIndex("by_org_status", (q) => q.eq("orgId", o.orgId).eq("status", "active"))
          .collect();
        const lastRun = await ctx.db.query("agentRuns").withIndex("by_org", (q) => q.eq("orgId", o.orgId)).order("desc").first();
        return {
          orgId: o.orgId,
          name: o.name,
          slug: o.slug,
          enabled: policy?.enabled ?? true,
          autonomy: policy?.autonomy ?? "suggest",
          digestEnabled: policy?.digestEnabled ?? true,
          pendingApprovals: pending.length,
          activeInsights: insights.length,
          lastRunAt: lastRun?._creationTime ?? null,
          lastRunStatus: lastRun?.status ?? null,
        };
      }),
    );
  },
});

/** Pending agent approvals across every sub-account (cross-sub queue). */
export const pendingApprovals = query({
  args: {},
  handler: async (ctx) => {
    const { orgs } = await agencyOrgIds(ctx);
    const nameByOrg = new Map(orgs.map((o) => [o.orgId, o.name]));
    const out: Array<Record<string, unknown>> = [];
    for (const o of orgs) {
      const rows = await ctx.db
        .query("agentApprovals")
        .withIndex("by_org_status", (q) => q.eq("orgId", o.orgId).eq("status", "pending"))
        .collect();
      for (const r of rows) out.push({ ...r, studioName: nameByOrg.get(o.orgId) ?? o.orgId });
    }
    return out.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
  },
});

/** Confirm the target org is a sub-account under the caller's agency. */
async function assertSub(ctx: MutationCtx, orgId: string) {
  const { viewer, orgs } = await agencyOrgIds(ctx);
  if (!viewer) throw new ConvexError("Agency access required.");
  if (!orgs.some((o) => o.orgId === orgId)) throw new ConvexError("Sub-account not under this agency.");
}

async function upsertPolicy(ctx: MutationCtx, orgId: string, patch: Record<string, unknown>) {
  const existing = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (existing) await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
  else {
    await ctx.db.insert("agentPolicies", {
      orgId, enabled: true, defaultTone: "professional", autonomy: "suggest",
      digestEnabled: true, digestHourLocal: 8, ...patch, updatedAt: Date.now(),
    });
  }
}

export const setEnabled = mutation({
  args: { orgId: v.string(), enabled: v.boolean() },
  handler: async (ctx, { orgId, enabled }) => {
    await assertSub(ctx, orgId);
    await upsertPolicy(ctx, orgId, { enabled });
    await ctx.db.insert("agentAuditLogs", { orgId, event: enabled ? "agent.enabled" : "agent.disabled", at: Date.now() });
  },
});

export const setAutonomy = mutation({
  args: { orgId: v.string(), autonomy: AUTONOMY },
  handler: async (ctx, { orgId, autonomy }) => {
    await assertSub(ctx, orgId);
    await upsertPolicy(ctx, orgId, { autonomy });
    await ctx.db.insert("agentAuditLogs", { orgId, event: "agent.autonomy", detail: autonomy, at: Date.now() });
  },
});

/** Run the agent now for one sub-account (an analytics review). */
export const runNow = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await assertSub(ctx, orgId);
    const prompt =
      "Review this studio's current operations. Surface the most important risks and opportunities right now (overdue invoices, stale leads, under-booked rooms, sessions missing deposits or files) and recommend the next best actions. Be concise and specific.";
    const runId = await ctx.db.insert("agentRuns", {
      orgId, initiatedBy: "system", runType: "analytics_review", status: "queued", prompt,
    });
    await ctx.db.insert("agentAuditLogs", { orgId, runId, event: "run.created", detail: "agency run-now", at: Date.now() });
    await ctx.scheduler.runAfter(0, internal.agent.runAgentLLM, { runId, orgId, prompt, runType: "analytics_review" });
    return runId;
  },
});
