import { query } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability } from "./lib/access";
import { currentOrg, assertOrg } from "./lib/tenant";
import { describeRule, fillTemplate, MAX_TEMPLATE, TRIGGERS } from "./lib/ruleSpec";

/* ============================================================
   Standing rules.

   The loop this closes: the agent notices a pattern, suggests an
   action, the owner approves it, and then the same suggestion comes
   back next week. After the third approval nobody wants it reasoned
   about again - they want it to just happen.

   A rule is if-this-then-that with no model in the loop, which is
   what makes it safe to run unattended. Client-facing actions still
   route through the same send paths as everything else, so opt-outs
   and quiet hours apply exactly as they always did.
   ============================================================ */

const triggerV = v.union(
  v.literal("session.completed"),
  v.literal("session.no_show"),
  v.literal("session.upcoming"),
  v.literal("invoice.overdue"),
  v.literal("client.dormant"),
  v.literal("booking.created"),
);

const actionV = v.union(
  v.literal("notify_team"),
  v.literal("email_client"),
  v.literal("sms_client"),
  v.literal("flag_insight"),
);

function cleanTemplate(raw: string): string {
  const t = raw.trim().slice(0, MAX_TEMPLATE);
  if (!t) throw new ConvexError({ code: "RULE_EMPTY", message: "Give the rule something to say." });
  return t;
}

/** Every rule for the studio, with its plain-English description. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("agentRules")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r, description: describeRule(r) }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    trigger: triggerV,
    action: actionV,
    template: v.string(),
    thresholdDays: v.optional(v.number()),
    thresholdHours: v.optional(v.number()),
    fromInsightId: v.optional(v.id("agentInsights")),
    sourceNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = await currentOrg(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError({ code: "RULE_EMPTY", message: "Give the rule a name." });

    const spec = TRIGGERS.find((t) => t.key === args.trigger)!;
    // Only keep the threshold the trigger actually reads, so a stale value
    // from a changed dropdown cannot quietly alter when the rule fires.
    const thresholdHours = spec.needs === "hours"
      ? Math.min(Math.max(args.thresholdHours ?? spec.defaultValue ?? 24, 1), 336)
      : undefined;
    const thresholdDays = spec.needs === "days"
      ? Math.min(Math.max(args.thresholdDays ?? spec.defaultValue ?? 7, 1), 730)
      : undefined;

    const id = await ctx.db.insert("agentRules", {
      orgId,
      name,
      trigger: args.trigger,
      action: args.action,
      template: cleanTemplate(args.template),
      thresholdDays,
      thresholdHours,
      enabled: true,
      fromInsightId: args.fromInsightId,
      sourceNote: args.sourceNote?.trim() || undefined,
      runCount: 0,
      createdBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
      createdAt: Date.now(),
    });

    await ctx.db.insert("agentAuditLogs", {
      orgId,
      event: "rule.created",
      detail: `${name} - ${describeRule({ ...args, thresholdDays, thresholdHours })}`,
      at: Date.now(),
    });
    return id;
  },
});

/**
 * Promote an insight into a standing rule.
 *
 * The one-click path: the insight supplies the name and the provenance, the
 * caller supplies what should happen from now on. The insight is dismissed on
 * the way out, because it has been answered permanently rather than once.
 */
export const promoteInsight = mutation({
  args: {
    insightId: v.id("agentInsights"),
    trigger: triggerV,
    action: actionV,
    template: v.string(),
    thresholdDays: v.optional(v.number()),
    thresholdHours: v.optional(v.number()),
  },
  handler: async (ctx, { insightId, ...rest }) => {
    const viewer = await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = await currentOrg(ctx);
    const insight = await ctx.db.get(insightId);
    assertOrg(insight, orgId);

    const spec = TRIGGERS.find((t) => t.key === rest.trigger)!;
    const thresholdHours = spec.needs === "hours"
      ? Math.min(Math.max(rest.thresholdHours ?? spec.defaultValue ?? 24, 1), 336)
      : undefined;
    const thresholdDays = spec.needs === "days"
      ? Math.min(Math.max(rest.thresholdDays ?? spec.defaultValue ?? 7, 1), 730)
      : undefined;

    const id = await ctx.db.insert("agentRules", {
      orgId,
      name: insight.title.slice(0, 120),
      trigger: rest.trigger,
      action: rest.action,
      template: cleanTemplate(rest.template),
      thresholdDays,
      thresholdHours,
      enabled: true,
      fromInsightId: insightId,
      sourceNote: insight.explanation.slice(0, 400),
      runCount: 0,
      createdBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
      createdAt: Date.now(),
    });

    // Answered permanently, so it should stop asking.
    await ctx.db.patch(insightId, { status: "dismissed" });
    await ctx.db.insert("agentAuditLogs", {
      orgId,
      event: "rule.promoted",
      detail: `Promoted "${insight.title}" to a standing rule`,
      at: Date.now(),
    });
    return id;
  },
});

export const setEnabled = mutation({
  args: { id: v.id("agentRules"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = await currentOrg(ctx);
    const rule = await ctx.db.get(id);
    assertOrg(rule, orgId);
    await ctx.db.patch(id, { enabled });
    await ctx.db.insert("agentAuditLogs", {
      orgId,
      event: enabled ? "rule.enabled" : "rule.paused",
      detail: rule.name,
      at: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("agentRules") },
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = await currentOrg(ctx);
    const rule = await ctx.db.get(id);
    assertOrg(rule, orgId);
    await ctx.db.delete(id);
    await ctx.db.insert("agentAuditLogs", {
      orgId, event: "rule.deleted", detail: rule.name, at: Date.now(),
    });
  },
});

/** What a rule would say, filled in with a real name. Preview before saving. */
export const preview = query({
  args: { template: v.string(), clientName: v.optional(v.string()) },
  handler: async (ctx, { template, clientName }) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return fillTemplate(template.slice(0, MAX_TEMPLATE), {
      client: clientName ?? "Ari",
      studio: org?.name ?? "the studio",
    });
  },
});

/* ── Firing ─────────────────────────────────────────────────── */

/**
 * Run every enabled rule for one trigger.
 *
 * Called from the places that already know the event happened (session
 * completion, no-show, booking creation), so a rule fires on the real event
 * rather than by polling for it.
 */
export async function fireRules(
  ctx: MutationCtx,
  orgId: string,
  trigger: Doc<"agentRules">["trigger"],
  context: { clientName?: string; entityType?: string; entityId?: string },
): Promise<number> {
  const rules = await ctx.db
    .query("agentRules")
    .withIndex("by_org_trigger", (q) => q.eq("orgId", orgId).eq("trigger", trigger))
    .collect();
  const live = rules.filter((r) => r.enabled);
  if (live.length === 0) return 0;

  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();

  for (const rule of live) {
    const message = fillTemplate(rule.template, {
      client: context.clientName,
      studio: org?.name,
    });

    // Client-facing actions are queued as insights rather than sent from
    // here. A rule may run unattended; it may not invent a new send path that
    // skips opt-outs, quiet hours and the existing delivery plumbing.
    if (rule.action === "notify_team" || rule.action === "flag_insight") {
      await ctx.db.insert("insights", {
        orgId,
        kind: rule.action === "notify_team" ? "risk" : "opportunity",
        severity: "info",
        title: rule.name,
        body: message,
        status: "new",
        ...(context.entityType && context.entityId
          ? { entityType: context.entityType, entityId: context.entityId as Id<"sessions"> }
          : {}),
      });
    } else {
      await ctx.db.insert("agentApprovals", {
        orgId,
        actionType: rule.action === "email_client" ? "send_email" : "send_sms",
        title: rule.name,
        explanation:
          `Raised by the standing rule "${rule.name}". ${describeRule(rule)}`,
        proposedPayload: { message, ruleId: rule._id, channel: rule.action },
        // A rule is deterministic and was set up deliberately, but it is still
        // a message going to a client, so it lands in the same approval queue
        // as everything else client-facing.
        riskLevel: "low",
        status: "pending",
        createdAt: Date.now(),
      });
    }

    await ctx.db.patch(rule._id, {
      runCount: rule.runCount + 1,
      lastRunAt: Date.now(),
    });
  }
  return live.length;
}

/** Cron entry point for the time-based triggers that have no event to hang
 *  off: an invoice going overdue, a client going quiet. */
export const sweep = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const rules = (await ctx.db
      .query("agentRules")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()).filter((r) => r.enabled);

    let fired = 0;
    for (const rule of rules) {
      if (rule.trigger === "invoice.overdue") {
        const days = rule.thresholdDays ?? 7;
        const cutoff = now - days * 86_400_000;
        const invoices = await ctx.db
          .query("invoices")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
        const hits = invoices.filter(
          (i) => i.status !== "paid" && (i.dueDate ?? i._creationTime) < cutoff,
        );
        if (hits.length > 0) {
          fired += await fireRules(ctx, orgId, "invoice.overdue", {});
        }
      }
      if (rule.trigger === "client.dormant") {
        const days = rule.thresholdDays ?? 90;
        const cutoff = now - days * 86_400_000;
        const artists = await ctx.db
          .query("artists")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
        const quiet = artists.filter(
          (a) => a.status === "active" && (a.lastContactAt ?? 0) < cutoff,
        );
        if (quiet.length > 0) {
          fired += await fireRules(ctx, orgId, "client.dormant", {
            clientName: quiet[0].name,
          });
        }
      }
    }
    return { fired };
  },
});
