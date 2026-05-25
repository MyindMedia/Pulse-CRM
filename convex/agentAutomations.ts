import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Agent automations - recurring agent tasks (spec 12). A saved
   prompt the agent runs on a daily/weekly schedule, producing
   insights + approvals like any other run. The deterministic
   "convert a suggestion into a standing automation" surface.
   ============================================================ */

const CADENCE = v.union(v.literal("daily"), v.literal("weekly"));
const DAY = 86_400_000;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db.query("agentAutomations").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(50);
  },
});

export const create = mutation({
  args: { name: v.string(), prompt: v.string(), cadence: CADENCE, weekday: v.optional(v.number()) },
  handler: async (ctx, { name, prompt, cadence, weekday }) => {
    const viewer = await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    if (!name.trim() || !prompt.trim()) throw new ConvexError("Name and prompt are required.");
    const id = await ctx.db.insert("agentAutomations", {
      orgId, name: name.trim(), prompt: prompt.trim(), cadence,
      weekday: cadence === "weekly" ? (weekday ?? 1) : undefined,
      enabled: true, runCount: 0,
      createdBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
      createdAt: Date.now(),
    });
    await ctx.db.insert("agentAuditLogs", { orgId, event: "automation.created", detail: name.trim(), at: Date.now() });
    return id;
  },
});

export const toggle = mutation({
  args: { id: v.id("agentAutomations"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "ops.autonomy.manage", { orgId });
    const a = await ctx.db.get(id);
    if (!a || a.orgId !== orgId) throw new ConvexError("Not found");
    await ctx.db.patch(id, { enabled });
  },
});

export const remove = mutation({
  args: { id: v.id("agentAutomations") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "ops.autonomy.manage", { orgId });
    const a = await ctx.db.get(id);
    if (!a || a.orgId !== orgId) throw new ConvexError("Not found");
    await ctx.db.delete(id);
    await ctx.db.insert("agentAuditLogs", { orgId, event: "automation.deleted", at: Date.now() });
  },
});

/** Enabled automations whose cadence window has elapsed, for one org. */
export const _due = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("agentAutomations")
      .withIndex("by_org_enabled", (q) => q.eq("orgId", orgId).eq("enabled", true))
      .collect();
    return rows.filter((a) => {
      const windowMs = a.cadence === "weekly" ? 6.5 * DAY : 20 * 60 * 60 * 1000;
      return !a.lastRunAt || now - a.lastRunAt >= windowMs;
    });
  },
});

/** Cron-driven: run every active org's due automations. Rides automation.tick. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of orgIds) {
      const due = await ctx.runQuery(internal.agentAutomations._due, { orgId });
      for (const a of due) {
        const runId = await ctx.runMutation(internal.agentAutomations._startRun, { id: a._id });
        if (runId) await ctx.runAction(internal.agent.runAgentLLM, { runId, orgId, prompt: a.prompt, runType: "automation_recommendation" });
      }
    }
  },
});

/** Create a standing automation from an approved enable_automation action. */
export const _fromApproval = internalMutation({
  args: { orgId: v.string(), payload: v.any() },
  handler: async (ctx, { orgId, payload }) => {
    const p = (payload ?? {}) as { name?: string; prompt?: string; cadence?: string; weekday?: number };
    if (!p.prompt) return false;
    await ctx.db.insert("agentAutomations", {
      orgId, name: p.name ?? "Agent automation", prompt: p.prompt,
      cadence: p.cadence === "weekly" ? "weekly" : "daily",
      weekday: p.cadence === "weekly" ? (p.weekday ?? 1) : undefined,
      enabled: true, runCount: 0, createdBy: "agent:approved", createdAt: Date.now(),
    });
    await ctx.db.insert("agentAuditLogs", { orgId, event: "automation.created", detail: p.name ?? "from approval", at: Date.now() });
    return true;
  },
});

/** Create the system run for a due automation + advance its schedule. */
export const _startRun = internalMutation({
  args: { id: v.id("agentAutomations") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || !a.enabled) return null;
    const now = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      orgId: a.orgId, initiatedBy: "automation", runType: "automation_recommendation",
      status: "queued", prompt: a.prompt,
    });
    await ctx.db.patch(id, { lastRunAt: now, runCount: a.runCount + 1 });
    await ctx.db.insert("agentAuditLogs", { orgId: a.orgId, runId, event: "run.created", detail: `automation: ${a.name}`, at: now });
    return runId;
  },
});
