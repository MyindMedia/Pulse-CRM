/* ============================================================
   Ops Autopilot - the approval queue + audited execution.

   `opsBrain` proposes actions; this module is how a human (or, for
   graduated types, the autopilot) acts on them. Execution runs through
   the same notify/email/session seams the rest of the product uses and
   always writes an activity + audit trail. Execution is idempotent:
   re-running an already-executed action is a no-op.
   ============================================================ */
import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentOrg, currentActor } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { sendEmail } from "./lib/email";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Open queue for the active org: proposed actions plus snoozes that are due. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("opsActions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((r) => r.status === "proposed" || (r.status === "snoozed" && (r.snoozeUntil ?? 0) <= now))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt - a.createdAt)
      .slice(0, limit ?? 30);
  },
});

/** Badge counts for the nav. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("opsActions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const open = rows.filter((r) => r.status === "proposed" || (r.status === "snoozed" && (r.snoozeUntil ?? 0) <= now));
    return { open: open.length, high: open.filter((r) => r.priority === "high").length };
  },
});

/** Internal: fetch one action for the executor. */
export const getInternal = internalQuery({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/** Bump the per-type trust counters that drive autonomy graduation. */
async function bumpTrust(ctx: MutationCtx, orgId: string, actionType: string, kind: "approved" | "dismissed") {
  const row = await ctx.db
    .query("opsAutonomy")
    .withIndex("by_org_type", (q) => q.eq("orgId", orgId).eq("actionType", actionType))
    .first();
  if (!row) {
    await ctx.db.insert("opsAutonomy", {
      orgId,
      actionType,
      mode: "manual",
      approvedCount: kind === "approved" ? 1 : 0,
      dismissedCount: kind === "dismissed" ? 1 : 0,
    });
    return;
  }
  await ctx.db.patch(row._id, {
    approvedCount: row.approvedCount + (kind === "approved" ? 1 : 0),
    dismissedCount: row.dismissedCount + (kind === "dismissed" ? 1 : 0),
  });
}

/** Approve a queued action -> schedule execution. */
export const approve = mutation({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => {
    const action = await ctx.db.get(id);
    if (!action) throw new Error("Not found");
    await requireCapability(ctx, "ops.action.approve", { orgId: action.orgId, entityId: id });
    if (action.status !== "proposed" && action.status !== "snoozed") {
      throw new Error(`Cannot approve an action that is ${action.status}`);
    }
    const actor = await currentActor(ctx);
    await ctx.db.patch(id, { status: "approved", decidedAt: Date.now(), decidedBy: actor });
    await bumpTrust(ctx, action.orgId, action.type, "approved");
    await ctx.scheduler.runAfter(0, internal.opsActions.execute, { id });
  },
});

/** Dismiss a queued action. */
export const dismiss = mutation({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => {
    const action = await ctx.db.get(id);
    if (!action) throw new Error("Not found");
    await requireCapability(ctx, "ops.action.approve", { orgId: action.orgId, entityId: id });
    const actor = await currentActor(ctx);
    await ctx.db.patch(id, { status: "dismissed", decidedAt: Date.now(), decidedBy: actor });
    await bumpTrust(ctx, action.orgId, action.type, "dismissed");
  },
});

/** Snooze a queued action until a later time. */
export const snooze = mutation({
  args: { id: v.id("opsActions"), until: v.number() },
  handler: async (ctx, { id, until }) => {
    const action = await ctx.db.get(id);
    if (!action) throw new Error("Not found");
    await requireCapability(ctx, "ops.action.approve", { orgId: action.orgId, entityId: id });
    await ctx.db.patch(id, { status: "snoozed", snoozeUntil: until });
  },
});

/** Internal: execute an approved action. Idempotent; fully audited. */
export const execute = internalAction({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => {
    const action = await ctx.runQuery(internal.opsActions.getInternal, { id });
    if (!action || action.status === "executed") return;
    let emailStatus: "sent" | "failed" | "simulated" | undefined;
    if (action.payload.kind === "email" && action.payload.to) {
      emailStatus = await sendEmail({
        to: action.payload.to,
        subject: action.payload.subject,
        html: `<p>${escapeHtml(action.payload.body)}</p>`,
      });
    }
    await ctx.runMutation(internal.opsActions.finalize, { id, emailStatus });
  },
});

/** Internal: record execution side effects + audit, flip status. */
export const finalize = internalMutation({
  args: {
    id: v.id("opsActions"),
    emailStatus: v.optional(v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated"))),
  },
  handler: async (ctx, { id, emailStatus }) => {
    const action = await ctx.db.get(id);
    if (!action || action.status === "executed") return;

    let result = "noted";
    const p = action.payload;
    if (p.kind === "email") {
      await ctx.db.insert("notifications", {
        orgId: action.orgId,
        channel: "email",
        recipient: p.to ?? "",
        subject: p.subject,
        body: p.body,
        kind: p.notifyKind,
        status: emailStatus ?? "simulated",
      });
      result = `email ${emailStatus ?? "simulated"} to ${p.to ?? "n/a"}`;
    } else if (p.kind === "session_status") {
      const session = await ctx.db.get(p.sessionId);
      if (session && session.orgId === action.orgId) {
        await ctx.db.patch(p.sessionId, { status: p.newStatus });
        result = `session -> ${p.newStatus}`;
      } else {
        result = "session not found";
      }
    }

    await ctx.db.insert("activity", {
      orgId: action.orgId,
      kind: `ops.${action.type}`,
      summary: `Autopilot: ${action.title}`,
      actorName: action.decidedBy ?? "Autopilot",
      entityType: action.entityType,
      entityId: action.entityId,
      accent: "gold",
    });
    await ctx.db.insert("auditEvents", {
      orgId: action.orgId,
      viewerType: "studio_member",
      viewerId: action.decidedBy ?? "autopilot",
      action: `ops.execute.${action.type}`,
      resource: id,
      result: "allow",
      reason: action.autonomy ? "autopilot" : "approved",
    });
    await ctx.db.patch(id, { status: "executed", executedAt: Date.now(), result });
  },
});

/* ============================================================
   Autonomy graduation (Phase 3)
   ============================================================ */

/** Action types the owner could safely graduate to auto-execute:
 * approved >= 5 times with a low dismiss rate, still in manual mode. */
export const suggestions = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("opsAutonomy")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((r) => {
        const total = r.approvedCount + r.dismissedCount;
        return r.mode === "manual" && r.approvedCount >= 5 && total > 0 && r.dismissedCount / total < 0.2;
      })
      .map((r) => ({ actionType: r.actionType, approvedCount: r.approvedCount, dismissedCount: r.dismissedCount }));
  },
});

/** Flip an action type between manual and auto. */
export const setMode = mutation({
  args: { actionType: v.string(), mode: v.union(v.literal("manual"), v.literal("auto")) },
  handler: async (ctx, { actionType, mode }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "ops.autonomy.manage", { orgId });
    const row = await ctx.db
      .query("opsAutonomy")
      .withIndex("by_org_type", (q) => q.eq("orgId", orgId).eq("actionType", actionType))
      .first();
    if (row) await ctx.db.patch(row._id, { mode });
    else await ctx.db.insert("opsAutonomy", { orgId, actionType, mode, approvedCount: 0, dismissedCount: 0 });
  },
});
