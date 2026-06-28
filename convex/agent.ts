import {
  query, mutation, internalQuery, internalMutation, internalAction,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentOrg, currentActor } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { completeJSON, SMART_MODEL } from "./lib/openai";
import { summarizeGraph } from "./lib/studioGraph";

/* JSON contract for the conversational agent's structured response. Forces a
   valid object so we never brace-slice free text. strict:false keeps it lenient
   on optional fields. */
const AGENT_SCHEMA = {
  name: "pulse_agent_response",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      draft: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            severity: { type: "string" },
            explanation: { type: "string" },
          },
        },
      },
      recommendedActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            actionType: { type: "string" },
            riskLevel: { type: "string" },
            approvalRequired: { type: "boolean" },
            explanation: { type: "string" },
            proposedPayload: { type: "object" },
          },
        },
      },
    },
  },
} as const;
import { tenantGuard, fenceUntrusted } from "./lib/aiGuard";
import { sendEmail } from "./lib/email";
import { sendSms } from "./lib/sms";
import { studioHealthFor } from "./agentHealth";

/* ============================================================
   Pulse Agent - tenant-isolated AI ops manager, one org at a
   time. The model reasons + drafts; Convex authorizes, executes,
   meters, and audits. Approval-first: client-facing / financial /
   file / automation actions become agentApprovals, never direct
   sends. "workspace" in the spec == orgId here.
   ============================================================ */

const TONE = v.union(
  v.literal("professional"), v.literal("friendly"), v.literal("luxury"),
  v.literal("direct"), v.literal("custom"),
);
const AUTONOMY = v.union(v.literal("suggest"), v.literal("auto_low"), v.literal("auto_trusted"));

function period(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const DEFAULT_POLICY = {
  enabled: true,
  defaultTone: "professional" as const,
  autonomy: "suggest" as const,
  digestEnabled: true,
  digestHourLocal: 8,
};

// ── Policy ──────────────────────────────────────────────────────────────

export const getPolicy = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const row = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      enabled: row?.enabled ?? DEFAULT_POLICY.enabled,
      defaultTone: row?.defaultTone ?? DEFAULT_POLICY.defaultTone,
      customToneInstructions: row?.customToneInstructions,
      autonomy: row?.autonomy ?? DEFAULT_POLICY.autonomy,
      digestEnabled: row?.digestEnabled ?? DEFAULT_POLICY.digestEnabled,
      digestHourLocal: row?.digestHourLocal ?? DEFAULT_POLICY.digestHourLocal,
    };
  },
});

export const updatePolicy = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    defaultTone: v.optional(TONE),
    customToneInstructions: v.optional(v.string()),
    autonomy: v.optional(AUTONOMY),
    digestEnabled: v.optional(v.boolean()),
    digestHourLocal: v.optional(v.number()),
  },
  handler: async (ctx, patch) => {
    const viewer = await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const existing = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    if (existing) await ctx.db.patch(existing._id, { ...clean, updatedAt: Date.now() });
    else await ctx.db.insert("agentPolicies", { orgId, ...DEFAULT_POLICY, ...clean, updatedAt: Date.now() });
  },
});

// ── Runs + chat ─────────────────────────────────────────────────────────

export const listRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("agentRuns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 20);
    return rows;
  },
});

export const getRun = query({
  args: { id: v.id("agentRuns") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const run = await ctx.db.get(id);
    if (!run || run.orgId !== orgId) return null;
    const messages = await ctx.db.query("agentMessages").withIndex("by_run", (q) => q.eq("runId", id)).collect();
    return { run, messages: messages.sort((a, b) => a._creationTime - b._creationTime) };
  },
});

export const listInsights = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db
      .query("agentInsights")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .order("desc")
      .take(20);
  },
});

export const listApprovals = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db
      .query("agentApprovals")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(40);
  },
});

/** Ask the agent something. Captures intent, schedules the LLM run. */
export const createRun = mutation({
  args: { prompt: v.string(), runType: v.optional(v.string()) },
  handler: async (ctx, { prompt, runType }) => {
    const viewer = await requireCapability(ctx, "insights.read");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const clerkUserId = "clerkUserId" in viewer ? viewer.clerkUserId : undefined;

    const runId = await ctx.db.insert("agentRuns", {
      orgId,
      clerkUserId,
      initiatedBy: "user",
      runType: "chat",
      status: "queued",
      prompt,
    });
    await ctx.db.insert("agentMessages", { orgId, runId, role: "user", body: prompt });
    await ctx.db.insert("agentAuditLogs", { orgId, runId, event: "run.created", actor: clerkUserId, at: Date.now() });
    await ctx.scheduler.runAfter(0, internal.agent.runAgentLLM, { runId, orgId, prompt, runType: runType ?? "chat" });
    return runId;
  },
});

// ── Scoped context (one org only) ───────────────────────────────────────

export const _context = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();

    const upcoming = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gt("startTime", now))
      .take(50);
    const invoices = await ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const payments = await ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const opps = await ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const equipment = await ctx.db.query("equipment").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();

    const unpaid = invoices.filter((i) => i.status !== "paid" && i.status !== "void");
    const overdue = unpaid.filter((i) => (i.dueDate ?? Infinity) < now);
    const openOpps = opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
    const staleLeads = openOpps.filter((o) => (o._creationTime ?? now) < now - 14 * 86_400_000);
    const activeSongs = songs.filter((s) => s.stage !== "delivered");
    const revenueThisMonth = payments
      .filter((p) => p.status === "paid" && p._creationTime >= monthStart.getTime())
      .reduce((s, p) => s + (p.amountCents ?? 0), 0);

    // Inventory / equipment: value, state, and depreciation (purchase vs
    // current). Values are PER-UNIT, so multiply by quantity for totals.
    const qty = (e: { quantity?: number }) => (e.quantity && e.quantity > 0 ? e.quantity : 1);
    const eqPurchase = equipment.reduce((s, e) => s + e.purchaseCents * qty(e), 0);
    const eqCurrent = equipment.reduce((s, e) => s + e.currentValueCents * qty(e), 0);
    const eqInstalled = equipment.filter((e) => e.installedInRoomId).length;
    const eqStatus = (st: string) => equipment.filter((e) => e.status === st).length;
    const depreciatedItems = equipment
      .filter((e) => e.currentValueCents < e.purchaseCents)
      .sort((a, b) => (b.purchaseCents - b.currentValueCents) - (a.purchaseCents - a.currentValueCents))
      .slice(0, 8)
      .map((e) => ({
        name: e.name,
        category: e.category,
        status: e.status,
        condition: e.condition ?? null,
        purchaseCents: e.purchaseCents,
        currentValueCents: e.currentValueCents,
      }));

    // Per-room inventory value (so the agent can answer "value of Studio A").
    // Includes a Storage bucket for unassigned gear. Qty-aware.
    const roomNameById = new Map(rooms.map((r) => [r._id, r.name]));
    const roomBuckets = new Map<string, { room: string; count: number; units: number; currentValueCents: number }>();
    for (const e of equipment) {
      const key = e.installedInRoomId ?? "__storage__";
      const room = e.installedInRoomId
        ? (roomNameById.get(e.installedInRoomId) ?? "Unknown room")
        : "Storage";
      const b = roomBuckets.get(key) ?? { room, count: 0, units: 0, currentValueCents: 0 };
      b.count += 1;
      b.units += qty(e);
      b.currentValueCents += e.currentValueCents * qty(e);
      roomBuckets.set(key, b);
    }
    const roomInventory = [...roomBuckets.values()].sort(
      (a, b) => b.currentValueCents - a.currentValueCents,
    );

    // Software & licenses (DAWs, plugins, subscriptions).
    const software = await ctx.db.query("softwareLicenses").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const swAnnualRecurring = software.reduce((s, l) => {
      if (l.licenseType !== "subscription") return s;
      if (l.billingInterval === "monthly") return s + l.costCents * 12;
      if (l.billingInterval === "annual") return s + l.costCents;
      return s;
    }, 0);
    const swPerpetual = software.filter((l) => l.licenseType === "perpetual").reduce((s, l) => s + l.costCents, 0);

    const health = await studioHealthFor(ctx, orgId);
    const memories = await ctx.db
      .query("agentMemories")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .collect();

    // Studio Brain: knowledge-graph highlights + recent history, so the agent
    // reasons over relationships and memory, not just a point-in-time snapshot.
    const [brainNodes, brainEdges, recentJournal] = await Promise.all([
      ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("studioGraphEdges").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("studioJournal").withIndex("by_org_at", (q) => q.eq("orgId", orgId)).order("desc").take(8),
    ]);
    const graph = summarizeGraph(
      brainNodes.map((n) => ({ ref: n.refId, kind: n.kind, label: n.label })),
      brainEdges.map((e) => ({ fromRef: e.fromRef, toRef: e.toRef, rel: e.rel, weight: e.weight })),
    );

    return {
      orgName: org?.name ?? "the studio",
      plan: org?.plan ?? "studio",
      health: { overall: health.overall, band: health.band, components: health.components },
      memory: memories.map((m) => ({ type: m.memoryType, summary: m.summary })),
      rooms: rooms.length,
      inventory: {
        count: equipment.length,
        installed: eqInstalled,
        inStorage: equipment.length - eqInstalled,
        purchaseTotalCents: eqPurchase,
        currentValueCents: eqCurrent,
        depreciationCents: eqPurchase - eqCurrent,
        available: eqStatus("available"),
        inUse: eqStatus("in_use"),
        maintenance: eqStatus("maintenance"),
        retired: eqStatus("retired"),
        depreciatedItems,
        byRoom: roomInventory,
      },
      software: {
        count: software.length,
        annualRecurringCents: swAnnualRecurring,
        perpetualValueCents: swPerpetual,
        subscriptions: software.filter((l) => l.licenseType === "subscription").length,
        items: software.slice(0, 30).map((l) => ({
          name: l.name,
          vendor: l.vendor ?? null,
          category: l.category,
          licenseType: l.licenseType,
          costCents: l.costCents,
          billingInterval: l.billingInterval,
        })),
      },
      summary: {
        revenueThisMonthCents: revenueThisMonth,
        unpaidInvoices: unpaid.length,
        unpaidCents: unpaid.reduce((s, i) => s + (i.amountCents ?? 0), 0),
        overdueInvoices: overdue.length,
        upcomingSessions: upcoming.length,
        openLeads: openOpps.length,
        staleLeads: staleLeads.length,
        activeSongs: activeSongs.length,
      },
      brain: {
        topClients: graph.topClients.map((c) => c.label),
        clientConcentration: graph.clientConcentration,
        engineerConcentration: graph.engineerConcentration,
        idleGear: graph.idleGear,
        history: recentJournal.map((j) => ({ title: j.title, kind: j.kind })),
      },
    };
  },
});

// ── Internal writers (auditable) ────────────────────────────────────────

export const _finalize = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    orgId: v.string(),
    status: v.union(v.literal("completed"), v.literal("needs_approval"), v.literal("failed")),
    summary: v.optional(v.string()),
    assistant: v.optional(v.string()),
    source: v.optional(v.string()),
    modelName: v.optional(v.string()),
    error: v.optional(v.string()),
    findings: v.optional(v.array(v.object({
      title: v.string(),
      severity: v.union(v.literal("info"), v.literal("opportunity"), v.literal("warning"), v.literal("critical")),
      explanation: v.string(),
    }))),
    autonomy: v.optional(v.union(v.literal("suggest"), v.literal("auto_low"), v.literal("auto_trusted"))),
    approvals: v.optional(v.array(v.object({
      actionType: v.string(),
      title: v.string(),
      explanation: v.string(),
      riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
      proposedPayload: v.any(),
    }))),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    if (a.assistant) await ctx.db.insert("agentMessages", { orgId: a.orgId, runId: a.runId, role: "assistant", body: a.assistant });
    for (const f of a.findings ?? []) {
      await ctx.db.insert("agentInsights", { orgId: a.orgId, runId: a.runId, title: f.title, severity: f.severity, explanation: f.explanation, status: "active", createdAt: now });
      await ctx.db.insert("agentAuditLogs", { orgId: a.orgId, runId: a.runId, event: "insight.created", detail: f.title, at: now });
    }
    const validTypes = new Set(["send_email", "send_sms", "create_invoice", "update_invoice", "schedule_session", "enable_automation", "deliver_files", "update_client_record"]);
    // Controlled autonomy: only "auto_trusted" auto-runs, and only low-risk
    // client reminders (send_email/send_sms). Everything else always waits.
    const autoOk = new Set(["send_email", "send_sms"]);
    for (const ap of a.approvals ?? []) {
      if (!validTypes.has(ap.actionType)) continue;
      const auto = a.autonomy === "auto_trusted" && ap.riskLevel === "low" && autoOk.has(ap.actionType);
      const approvalId = await ctx.db.insert("agentApprovals", {
        orgId: a.orgId, runId: a.runId, actionType: ap.actionType as never,
        title: ap.title, explanation: ap.explanation, proposedPayload: ap.proposedPayload,
        riskLevel: ap.riskLevel, status: auto ? "approved" : "pending",
        decidedBy: auto ? "agent:auto" : undefined, decidedAt: auto ? now : undefined,
        createdAt: now,
      });
      await ctx.db.insert("agentAuditLogs", { orgId: a.orgId, runId: a.runId, event: auto ? "approval.auto_approved" : "approval.created", detail: ap.title, at: now });
      if (auto) await ctx.scheduler.runAfter(0, internal.agent.executeApproval, { id: approvalId });
    }
    await ctx.db.patch(a.runId, {
      status: a.status, summary: a.summary, source: a.source, modelName: a.modelName,
      error: a.error, completedAt: now,
    });
    await ctx.db.insert("agentAuditLogs", { orgId: a.orgId, runId: a.runId, event: `run.${a.status}`, at: now });

    // Usage metering for the billing period.
    const p = period(now);
    const usage = await ctx.db.query("agentUsage").withIndex("by_org_period", (q) => q.eq("orgId", a.orgId).eq("period", p)).first();
    const drafts = a.approvals?.length ?? 0;
    if (usage) await ctx.db.patch(usage._id, { runs: usage.runs + 1, drafts: usage.drafts + drafts, updatedAt: now });
    else await ctx.db.insert("agentUsage", { orgId: a.orgId, period: p, runs: 1, drafts, sends: 0, inputTokens: 0, outputTokens: 0, updatedAt: now });
  },
});

// ── The LLM run ─────────────────────────────────────────────────────────

export const runAgentLLM = internalAction({
  args: { runId: v.id("agentRuns"), orgId: v.string(), prompt: v.string(), runType: v.string() },
  handler: async (ctx, { runId, orgId, prompt }) => {
    try {
      const cx = await ctx.runQuery(internal.agent._context, { orgId });
      const policy = await ctx.runQuery(internal.agent._policyFor, { orgId });
      const tone = policy.defaultTone === "custom" && policy.customToneInstructions
        ? policy.customToneInstructions
        : policy.defaultTone;

      const system = [
        "You are Pulse Agent, an AI studio operations manager inside the Pulse platform.",
        tenantGuard(cx.orgName),
        "You may analyze data, explain patterns, and recommend actions. You may NOT claim any external action was performed.",
        "You can see this studio's full operating picture: revenue, invoices, sessions, leads, songs, rooms, equipment/inventory (purchase value, current value, depreciation, condition, state, quantity, AND a per-room value breakdown), and software & licenses. Answer questions about any of it directly from the data provided - including the current value of a specific room (use the 'Value by room' breakdown). Only say something is not tracked when the data explicitly shows zero of it.",
        "For client-facing, financial, calendar, file-delivery, or automation-enabling actions, propose an approval (do not send).",
        `Tone: ${tone}. Write for a busy studio owner in plain, natural language.`,
        "Money: always write amounts in plain US dollars like $5,510 or $360. NEVER write cents or the word 'cents', and never show raw numbers like 551000.",
        "Never invent placeholder links or fake URLs (e.g. '[payment link]'). Only include a link if you were given a real one; otherwise tell the user where to find the action in Pulse.",
        "Do not quote internal metric numbers (e.g. 'a score of 24'). Describe health qualitatively (strong, steady, watch, at risk) and explain it in real business terms.",
        "Be specific and concise. No filler.",
        "Respond with ONLY a JSON object matching: { summary: string, findings: [{title, severity: info|opportunity|warning|critical, explanation}], recommendedActions: [{title, actionType, riskLevel: low|medium|high|critical, approvalRequired: boolean, explanation, proposedPayload}], draft?: string }",
        "actionType must be one of: send_email, send_sms, create_invoice, update_invoice, schedule_session, enable_automation, deliver_files, update_client_record.",
      ].join("\n");

      const s = cx.summary;
      const inv = cx.inventory;
      const snapshot = [
        `- Revenue this month: ${usd(s.revenueThisMonthCents)}`,
        `- Unpaid invoices: ${s.unpaidInvoices} (${usd(s.unpaidCents)} outstanding, ${s.overdueInvoices} overdue)`,
        `- Upcoming sessions: ${s.upcomingSessions}`,
        `- Open leads: ${s.openLeads} (${s.staleLeads} stale)`,
        `- Active songs: ${s.activeSongs}`,
        `- Rooms: ${cx.rooms}`,
        inv.count > 0
          ? `- Inventory: ${inv.count} equipment items, ${usd(inv.currentValueCents)} current value`
          : `- Inventory: no equipment tracked`,
        cx.software.count > 0
          ? `- Software: ${cx.software.count} licenses, ${usd(cx.software.annualRecurringCents)}/yr recurring`
          : null,
      ].filter(Boolean).join("\n");

      // Full inventory detail so the Agent can answer value / state / depreciation
      // questions directly instead of deflecting.
      const valueDelta =
        inv.depreciationCents > 0
          ? `net depreciation of ${usd(inv.depreciationCents)} below purchase`
          : inv.depreciationCents < 0
            ? `net gain of ${usd(-inv.depreciationCents)} above purchase`
            : `unchanged from purchase`;
      const inventoryBlock =
        inv.count > 0
          ? `\n\nInventory / equipment detail:\n` +
            [
              `- Items: ${inv.count} (${inv.installed} installed in rooms, ${inv.inStorage} in storage)`,
              `- Current value: ${usd(inv.currentValueCents)}; purchased for ${usd(inv.purchaseTotalCents)} (${valueDelta})`,
              `- State: ${inv.available} available, ${inv.inUse} in use, ${inv.maintenance} in maintenance, ${inv.retired} retired`,
              inv.byRoom.length
                ? `- Value by room (current value of gear assigned to each room): ${inv.byRoom
                    .map((r) => `${r.room}: ${usd(r.currentValueCents)} (${r.count} items)`)
                    .join("; ")}. When asked for a specific room's value, use this breakdown.`
                : `- No gear assigned to any room yet (all in storage).`,
              inv.depreciatedItems.length
                ? `- Items that have lost value: ${inv.depreciatedItems
                    .map((d) => `${d.name} (${d.category}, ${d.condition ?? "condition n/a"}): ${usd(d.purchaseCents)} -> ${usd(d.currentValueCents)}`)
                    .join("; ")}`
                : `- No individual item has lost value.`,
            ].join("\n")
          : "";

      const sw = cx.software;
      const softwareBlock =
        sw.count > 0
          ? `\n\nSoftware & licenses:\n` +
            [
              `- ${sw.count} licenses (${sw.subscriptions} subscriptions): ${usd(sw.annualRecurringCents)}/yr recurring, ${usd(sw.perpetualValueCents)} one-time/perpetual value.`,
              sw.items.length
                ? `- Titles: ${sw.items
                    .map((i) => `${i.name}${i.vendor ? ` (${i.vendor})` : ""} ${usd(i.costCents)}${i.billingInterval === "monthly" ? "/mo" : i.billingInterval === "annual" ? "/yr" : ""}`)
                    .join("; ")}`
                : "",
            ].filter(Boolean).join("\n")
          : "";

      const memoryBlock = cx.memory.length
        ? `\n\n${fenceUntrusted("STUDIO MEMORY", cx.memory.map((m) => `- [${m.type}] ${m.summary}`).join("\n"))}`
        : "";

      // Studio Brain: relationship graph + recent history so the agent answers
      // with continuity ("who are our biggest clients", "what changed lately").
      const b = cx.brain;
      const brainBlock =
        b && (b.topClients.length || b.history.length)
          ? `\n\nStudio Brain (relationships + history):\n` +
            [
              b.topClients.length ? `- Strongest client relationships: ${b.topClients.slice(0, 5).join(", ")}` : null,
              b.clientConcentration.label ? `- ${b.clientConcentration.label} is ${b.clientConcentration.share}% of activity` : null,
              b.engineerConcentration.label ? `- ${b.engineerConcentration.label} runs ${b.engineerConcentration.share}% of sessions` : null,
              b.idleGear > 0 ? `- ${b.idleGear} rentable item(s) with no upcoming bookings` : null,
              b.history.length ? `- Recent history: ${b.history.slice(0, 5).map((h) => h.title).join("; ")}` : null,
            ]
              .filter(Boolean)
              .join("\n")
          : "";
      const userPrompt = [
        `Studio: ${cx.orgName} (plan: ${cx.plan}).`,
        `Overall studio health is ${cx.health.band} (the weakest areas are ${weakestAreas(cx.health.components)}).`,
        `Current snapshot:\n${snapshot}`,
        `User request: ${prompt}${inventoryBlock}${softwareBlock}${memoryBlock}${brainBlock}`,
      ].join("\n\n");

      // Judgment task -> the full GPT-5 tier, with a forced JSON contract so we
      // never parse malformed free text.
      const ai = await completeJSON<Parsed>(userPrompt, {
        system,
        model: SMART_MODEL,
        maxOutputTokens: 1200,
        schema: AGENT_SCHEMA,
      });

      if (!ai) {
        // No LLM configured (or unparseable) -> deterministic fallback summary.
        const s = cx.summary;
        const summary = `${cx.orgName} snapshot: ${usd(s.revenueThisMonthCents)} collected this month, ${s.unpaidInvoices} unpaid invoices (${usd(s.unpaidCents)} outstanding, ${s.overdueInvoices} overdue), ${s.upcomingSessions} upcoming sessions, ${s.openLeads} open leads (${s.staleLeads} stale), ${s.activeSongs} active songs.`;
        await ctx.runMutation(internal.agent._finalize, { runId, orgId, status: "completed", summary, assistant: summary, source: "fallback" });
        return;
      }

      const parsed = ai.data;
      const approvals = (parsed.recommendedActions ?? [])
        .filter((a) => a.approvalRequired !== false && a.actionType)
        .map((a) => ({
          actionType: a.actionType!,
          title: a.title ?? "Proposed action",
          explanation: a.explanation ?? "",
          riskLevel: normalizeRisk(a.riskLevel),
          proposedPayload: a.proposedPayload ?? {},
        }));
      const findings = (parsed.findings ?? []).map((f) => ({
        title: f.title ?? "Finding",
        severity: normalizeSeverity(f.severity),
        explanation: f.explanation ?? "",
      }));
      const assistant = parsed.summary || parsed.draft || "I could not produce a summary this time.";

      await ctx.runMutation(internal.agent._finalize, {
        runId, orgId,
        status: approvals.length > 0 ? "needs_approval" : "completed",
        summary: parsed.summary ?? assistant.slice(0, 280),
        assistant,
        source: ai.source,
        modelName: ai.model,
        autonomy: policy.autonomy,
        findings,
        approvals,
      });
    } catch (err) {
      await ctx.runMutation(internal.agent._finalize, {
        runId, orgId, status: "failed",
        error: err instanceof Error ? err.message : "agent run failed",
      });
    }
  },
});

export const _policyFor = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const row = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      enabled: row?.enabled ?? DEFAULT_POLICY.enabled,
      defaultTone: row?.defaultTone ?? DEFAULT_POLICY.defaultTone,
      customToneInstructions: row?.customToneInstructions,
      autonomy: row?.autonomy ?? DEFAULT_POLICY.autonomy,
      digestEnabled: row?.digestEnabled ?? DEFAULT_POLICY.digestEnabled,
    };
  },
});

// ── Approvals: approve / reject / execute ───────────────────────────────

export const approveRequest = mutation({
  args: { id: v.id("agentApprovals"), editedPayload: v.optional(v.any()) },
  handler: async (ctx, { id, editedPayload }) => {
    const orgId = await currentOrg(ctx);
    const viewer = await requireCapability(ctx, "ops.action.approve", { orgId });
    const ap = await ctx.db.get(id);
    if (!ap || ap.orgId !== orgId) throw new ConvexError("Not found");
    if (ap.status !== "pending") throw new ConvexError(`Already ${ap.status}`);
    await ctx.db.patch(id, {
      status: "approved",
      decidedBy: "clerkUserId" in viewer ? viewer.clerkUserId : await currentActor(ctx),
      decidedAt: Date.now(),
      ...(editedPayload !== undefined ? { proposedPayload: editedPayload } : {}),
    });
    await ctx.db.insert("agentAuditLogs", { orgId, runId: ap.runId, event: "approval.approved", detail: ap.title, at: Date.now() });
    await ctx.scheduler.runAfter(0, internal.agent.executeApproval, { id });
  },
});

export const rejectRequest = mutation({
  args: { id: v.id("agentApprovals") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const viewer = await requireCapability(ctx, "ops.action.approve", { orgId });
    const ap = await ctx.db.get(id);
    if (!ap || ap.orgId !== orgId) throw new ConvexError("Not found");
    await ctx.db.patch(id, {
      status: "rejected",
      decidedBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
      decidedAt: Date.now(),
    });
    await ctx.db.insert("agentAuditLogs", { orgId, runId: ap.runId, event: "approval.rejected", detail: ap.title, at: Date.now() });
  },
});

export const dismissInsight = mutation({
  args: { id: v.id("agentInsights") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "insights.read", { orgId });
    const ins = await ctx.db.get(id);
    if (!ins || ins.orgId !== orgId) throw new ConvexError("Not found");
    await ctx.db.patch(id, { status: "dismissed" });
  },
});

/** Execute an approved action via the existing send paths. Idempotent-ish:
 *  only runs on a still-"approved" row. */
export const executeApproval = internalAction({
  args: { id: v.id("agentApprovals") },
  handler: async (ctx, { id }) => {
    const ap = await ctx.runQuery(internal.agent._approvalForExec, { id });
    if (!ap || ap.status !== "approved") return;
    let ok = false;
    let result = "";
    try {
      const p = (ap.proposedPayload ?? {}) as { to?: string; subject?: string; body?: string };
      if (ap.actionType === "send_email" && p.to) {
        const status = await sendEmail({ to: p.to, subject: p.subject ?? "A note from the studio", html: `<div>${(p.body ?? "").replace(/\n/g, "<br/>")}</div>` });
        ok = status !== "failed"; result = `email ${status}`;
      } else if (ap.actionType === "send_sms" && p.to) {
        const status = await sendSms({ to: p.to, body: p.body ?? "" });
        ok = status !== "failed"; result = `sms ${status}`;
      } else if (ap.actionType === "enable_automation") {
        const created = await ctx.runMutation(internal.agentAutomations._fromApproval, { orgId: ap.orgId, payload: ap.proposedPayload });
        ok = created; result = created ? "automation created" : "automation payload missing a prompt";
      } else {
        // Other action types are recorded as approved but executed by their own
        // modules / a future executor; mark executed with a note.
        ok = true; result = "approved (no auto-executor for this action type yet)";
      }
    } catch (err) {
      ok = false; result = err instanceof Error ? err.message : "execution error";
    }
    await ctx.runMutation(internal.agent._markExecuted, { id, ok, result });
  },
});

export const _approvalForExec = internalQuery({
  args: { id: v.id("agentApprovals") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const _markExecuted = internalMutation({
  args: { id: v.id("agentApprovals"), ok: v.boolean(), result: v.string() },
  handler: async (ctx, { id, ok, result }) => {
    const ap = await ctx.db.get(id);
    if (!ap) return;
    await ctx.db.patch(id, { status: ok ? "executed" : "failed", executedAt: Date.now(), result });
    await ctx.db.insert("agentAuditLogs", { orgId: ap.orgId, runId: ap.runId, event: ok ? "approval.executed" : "approval.failed", detail: result, at: Date.now() });
    if (ok) {
      const p = period();
      const usage = await ctx.db.query("agentUsage").withIndex("by_org_period", (q) => q.eq("orgId", ap.orgId).eq("period", p)).first();
      if (usage) await ctx.db.patch(usage._id, { sends: usage.sends + 1, updatedAt: Date.now() });
    }
  },
});

// ── Memory (per-org, explicit, editable) ────────────────────────────────

const MEMORY_TYPE = v.union(
  v.literal("studio_profile"), v.literal("tone_preferences"), v.literal("business_rules"),
  v.literal("client_patterns"), v.literal("risk_notes"), v.literal("automation_history"),
);

export const listMemories = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db
      .query("agentMemories")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(50);
  },
});

export const addMemory = mutation({
  args: { memoryType: MEMORY_TYPE, summary: v.string() },
  handler: async (ctx, { memoryType, summary }) => {
    const viewer = await requireCapability(ctx, "ops.autonomy.manage");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const body = summary.trim();
    if (!body) throw new ConvexError("Memory cannot be empty.");
    const now = Date.now();
    const id = await ctx.db.insert("agentMemories", {
      orgId, memoryType, summary: body, confidence: 1, source: "user", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("agentAuditLogs", { orgId, event: "memory.added", detail: memoryType, at: now });
    return id;
  },
});

export const deleteMemory = mutation({
  args: { id: v.id("agentMemories") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "ops.autonomy.manage", { orgId });
    const m = await ctx.db.get(id);
    if (!m || m.orgId !== orgId) throw new ConvexError("Not found");
    await ctx.db.delete(id);
    await ctx.db.insert("agentAuditLogs", { orgId, event: "memory.deleted", at: Date.now() });
  },
});

// ── Daily brief (scheduled, policy-gated) ───────────────────────────────

const DIGEST_PROMPT =
  "Produce today's studio brief. Cover: today's and tomorrow's sessions and any prep risks, overdue invoices worth chasing, stale leads to follow up, and the single most important action to take today. Keep it short and skimmable.";

/** Start a digest run for one org if it's enabled and hasn't run in ~20h.
 *  Returns the runId to kick, or null. */
export const _maybeStartDigest = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<Id<"agentRuns"> | null> => {
    const policy = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const enabled = policy?.enabled ?? DEFAULT_POLICY.enabled;
    const digestEnabled = policy?.digestEnabled ?? DEFAULT_POLICY.digestEnabled;
    if (!enabled || !digestEnabled) return null;
    const now = Date.now();
    if (policy?.lastDigestAt && now - policy.lastDigestAt < 20 * 60 * 60 * 1000) return null;

    const runId = await ctx.db.insert("agentRuns", {
      orgId, initiatedBy: "system", runType: "daily_digest", status: "queued", prompt: DIGEST_PROMPT,
    });
    if (policy) await ctx.db.patch(policy._id, { lastDigestAt: now });
    else await ctx.db.insert("agentPolicies", { orgId, ...DEFAULT_POLICY, lastDigestAt: now, updatedAt: now });
    await ctx.db.insert("agentAuditLogs", { orgId, runId, event: "run.created", detail: "daily digest", at: now });
    return runId;
  },
});

/** Cron-driven: generate the daily brief for every active org that's due.
 *  Scheduled from automation.tick so it rides the existing 15-min cadence. */
export const sweepDigests = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of orgIds) {
      const runId = await ctx.runMutation(internal.agent._maybeStartDigest, { orgId });
      if (runId) {
        await ctx.runAction(internal.agent.runAgentLLM, { runId, orgId, prompt: DIGEST_PROMPT, runType: "daily_digest" });
      }
    }
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────

type ParsedAction = { title?: string; actionType?: string; riskLevel?: string; approvalRequired?: boolean; explanation?: string; proposedPayload?: unknown };
type Parsed = {
  summary?: string;
  draft?: string;
  findings?: { title?: string; severity?: string; explanation?: string }[];
  recommendedActions?: ParsedAction[];
};


/** Whole-dollar money for human-facing copy. Never cents. */
function usd(cents?: number): string {
  return `$${Math.round((cents ?? 0) / 100).toLocaleString("en-US")}`;
}

/** The two weakest health components, as a readable phrase. */
function weakestAreas(components: { label: string; score: number }[]): string {
  const sorted = [...components].sort((a, b) => a.score - b.score).slice(0, 2);
  return sorted.map((c) => c.label.toLowerCase()).join(" and ") || "none";
}

function normalizeRisk(r?: string): "low" | "medium" | "high" | "critical" {
  return r === "medium" || r === "high" || r === "critical" ? r : "low";
}
function normalizeSeverity(s?: string): "info" | "opportunity" | "warning" | "critical" {
  return s === "opportunity" || s === "warning" || s === "critical" ? s : "info";
}
