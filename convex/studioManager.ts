/* ============================================================
   Studio Manager - the per-subaccount "employee" that evaluates the
   studio and acts.

   Fuses the deterministic signals (health, profitability vs the
   knowledge base, cross-category risk) with the Studio Brain knowledge
   graph, runs the pure assessment algorithm (lib/managerBrain), then:
     - writes a "Manager brief" insight (one open per org),
     - logs a snapshot to the studio's history journal,
     - optionally narrates the brief with the SMART model, GROUNDED in
       the deterministic facts and run through the draft verifier.

   Everything is org-scoped. The manager for studio A only ever sees
   studio A's graph, metrics, and history.
   ============================================================ */
import { v } from "convex/values";
import { internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildReport, gatherProfitCounts } from "./profitability";
import { gatherRiskFlags } from "./risk";
import { studioHealthFor } from "./agentHealth";
import { summarizeGraph, type GNode, type GEdge } from "./lib/studioGraph";
import { assessStudio, type AssessInput, type Assessment } from "./lib/managerBrain";
import { appendJournal } from "./studioBrain";
import { completeJSON, SMART_MODEL } from "./lib/openai";
import { verifyDraft } from "./lib/aiVerify";
import { tenantGuard } from "./lib/aiGuard";

/** Gather every signal the manager reasons over, for one org. Read-only. */
export const managerData = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<{ orgName: string; input: AssessInput }> => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const report = buildReport(await gatherProfitCounts(ctx, orgId));
    const riskFlags = await gatherRiskFlags(ctx, orgId);
    const health = await studioHealthFor(ctx, orgId);

    const [nodeRows, edgeRows] = await Promise.all([
      ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("studioGraphEdges").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);
    const nodes: GNode[] = nodeRows.map((n) => ({ ref: n.refId, kind: n.kind, label: n.label }));
    const edges: GEdge[] = edgeRows.map((e) => ({ fromRef: e.fromRef, toRef: e.toRef, rel: e.rel, weight: e.weight }));
    const graph = summarizeGraph(nodes, edges);

    const input: AssessInput = {
      healthBand: health.band,
      healthScore: health.overall,
      profitOverall: report.overall,
      profitBand: report.band,
      profitLevers: report.levers.map((l) => ({
        label: l.label, band: l.band, recommendation: l.recommendation,
        estImpactCents: l.estImpactCents, exposureCents: l.exposureCents,
      })),
      risks: riskFlags.map((f) => ({ category: f.category, severity: f.severity, title: f.title })),
      graph: {
        topClients: graph.topClients.map((c) => ({ label: c.label, degree: c.degree })),
        clientConcentration: graph.clientConcentration,
        engineerConcentration: graph.engineerConcentration,
        idleGear: graph.idleGear,
      },
    };
    return { orgName: org?.name ?? "the studio", input };
  },
});

/** Persist the brief: upsert one open "studio_manager" insight + journal it. */
export const persistBrief = internalMutation({
  args: {
    orgId: v.string(),
    standing: v.string(),
    score: v.number(),
    title: v.string(),
    body: v.string(),
    topPriority: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, standing, score, title, body, topPriority }) => {
    const severity = standing === "at_risk" ? "warning" : standing === "watch" ? "opportunity" : "info";
    const existing = await ctx.db
      .query("insights")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const open = existing.find((i) => i.entityType === "studio_manager" && (i.status === "new" || i.status === "seen"));
    if (open) {
      await ctx.db.patch(open._id, { title, body, severity, status: "new" });
    } else {
      await ctx.db.insert("insights", {
        orgId, kind: "opportunity", title, body, entityType: "studio_manager", status: "new", severity,
      });
    }

    // One snapshot entry per run in the studio's history journal.
    await appendJournal(ctx, orgId, {
      kind: "snapshot",
      title: `Manager check-in: ${standing.replace(/_/g, " ")} (${score}/100)`,
      body: topPriority ? `Top priority: ${topPriority}` : undefined,
      importance: standing === "at_risk" ? "high" : standing === "watch" ? "medium" : "low",
    });
  },
});

/** Evaluate one org end-to-end. Deterministic assessment first; an optional
 *  SMART-model narrative is layered on top, grounded in the facts and verified
 *  (placeholder + invented-number guard) before it is stored. */
export const evaluateOrg = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const { orgName, input } = await ctx.runQuery(internal.studioManager.managerData, { orgId });
    const a: Assessment = assessStudio(input);

    // Deterministic body is the safe floor.
    const detLines = [
      a.headline,
      "",
      ...(a.priorities.length ? ["Priorities:", ...a.priorities.map((p, i) => `${i + 1}. ${p.title} - ${p.why}`)] : ["No pressing priorities."]),
      ...(a.relationships.length ? ["", "Relationships:", ...a.relationships.map((r) => `- ${r}`)] : []),
    ];
    let body = detLines.join("\n");

    // Optional narration: a manager's note in plain language, grounded in the
    // facts above. The model rewrites the SUMMARY only; the priority list stays
    // deterministic. Verified before use, with the only allowed money being the
    // figures already in the deterministic body.
    const allowedMoney = (body.match(/\$[\d,]+/g) ?? []);
    const narrative = await completeJSON<{ note?: string }>(
      `You are the studio manager for ${orgName}. In 2-3 sentences, give the owner a plain-language read of where the studio stands and the single most important thing to do next. Base it ONLY on these facts, do not invent numbers:\n\n${body}`,
      {
        model: SMART_MODEL,
        system: `You are a sharp, calm studio operations manager. ${tenantGuard(orgName)} Speak plainly to a busy owner. Output JSON {"note": string}. Do not state any dollar figure that is not in the facts.`,
        schema: { name: "manager_note", schema: { type: "object", properties: { note: { type: "string" } } } },
        maxOutputTokens: 300,
      },
    );
    if (narrative?.data?.note) {
      const note = narrative.data.note.trim();
      if (verifyDraft(note, { allowedMoney }).ok) {
        body = `${note}\n\n${body}`;
      }
    }

    await ctx.runMutation(internal.studioManager.persistBrief, {
      orgId,
      standing: a.standing,
      score: a.score,
      title: `Studio Manager: ${a.standing === "on_track" ? "On track" : a.standing === "watch" ? "Needs attention" : "At risk"} (${a.score}/100)`,
      body,
      topPriority: a.priorities[0]?.title,
    });

    return { standing: a.standing, score: a.score, priorities: a.priorities.length };
  },
});
