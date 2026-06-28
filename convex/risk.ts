/* ============================================================
   Risk detector - the org-scoped binding for lib/guardrails.

   Loads ONE org's live records (every query `by_org`-indexed; orgId is
   resolved from the access engine, never client args), runs the pure
   category detectors in lib/guardrails, then:
     - auto-posts CRITICAL flags as internal `insights` rows (kind
       "risk") - the low-risk, no-outbound half of the autonomy policy;
     - exposes the full flag list to the dashboard via a gated query;
     - feeds actionable flags into opsBrain as note_only `studio_risk`
       proposals (surfaced in the inbox; nothing client-facing fires
       without approval).
   ============================================================ */
import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";
import { allRiskFlags, type RiskFlag, type RiskSeverity } from "./lib/guardrails";
import type { ProposedAction, Priority } from "./opsBrain";

/** Load org-scoped data and run every detector. orgId arrives already
 *  resolved - this never reads another tenant's rows. */
export async function gatherRiskFlags(ctx: QueryCtx | MutationCtx, orgId: string): Promise<RiskFlag[]> {
  const now = Date.now();
  const [songs, splitSheets, opps, sessions, shifts, members, availability, timeOff] = await Promise.all([
    ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("splitSheets").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("shifts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("availability").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("timeOff").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ]);

  const sheetBySong = new Map(splitSheets.map((sh) => [sh.songId, sh] as const));

  return allRiskFlags({
    now,
    songs: songs.map((s) => ({
      id: s._id,
      title: s.title,
      stage: s.stage,
      splitStatus: sheetBySong.get(s._id)?.status,
      updatedAt: s._creationTime,
      deadline: s.deadline,
    })),
    opps: opps.map((o) => ({
      id: o._id,
      title: o.title,
      stage: o.stage,
      valueCents: o.valueCents,
      probability: o.probability,
      updatedAt: o.updatedAt ?? o._creationTime,
    })),
    sessions: sessions.map((s) => ({
      id: s._id,
      title: s.title,
      roomId: s.roomId,
      engineerId: s.engineerId,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    })),
    shifts: shifts.map((s) => ({ id: s._id, memberId: s.memberId, startTime: s.startTime, endTime: s.endTime, status: s.status })),
    members: members.map((m) => ({ id: m._id, name: m.name })),
    availability: availability.map((a) => ({ memberId: a.memberId, weekday: a.weekday, startMinutes: a.startMinutes, endMinutes: a.endMinutes })),
    timeOff: timeOff.map((t) => ({ memberId: t.memberId, startTime: t.startTime, endTime: t.endTime, status: t.status })),
  });
}

const SEVERITY_PRIORITY: Record<RiskSeverity, Priority> = { critical: "high", warning: "medium", info: "low" };

/** Map risk flags to opsActions candidates (note_only). One per flag, deduped
 *  on `${category}:${key}`. These recommend; they never send. */
export function riskFlagCandidates(flags: RiskFlag[]): ProposedAction[] {
  return flags.map((f) => ({
    type: "studio_risk",
    priority: SEVERITY_PRIORITY[f.severity],
    title: f.title,
    rationale: f.detail,
    entityType: f.entityType ?? f.category,
    entityId: f.entityId ?? `${f.category}:${f.key}`,
    payload: { kind: "note_only" },
  }));
}

/** Public read: the studio's open risk flags, grouped by category. Gated by
 *  `insights.read` to match the other analytics surfaces. */
export const flags = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const all = await gatherRiskFlags(ctx, orgId);
    const byCategory: Record<string, RiskFlag[]> = {};
    for (const f of all) (byCategory[f.category] ??= []).push(f);
    return {
      total: all.length,
      critical: all.filter((f) => f.severity === "critical").length,
      warning: all.filter((f) => f.severity === "warning").length,
      flags: all,
      byCategory,
    };
  },
});

/** Internal read for crons / agent context. */
export const flagsFor = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => gatherRiskFlags(ctx, orgId),
});

/** Auto-post critical risk flags as internal insights (deduped on the flag's
 *  stable key). Resolves insights whose flag has cleared so the list self-heals. */
export const postCriticalInsights = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const flags = await gatherRiskFlags(ctx, orgId);
    const critical = flags.filter((f) => f.severity === "critical");
    const liveKeys = new Set(critical.map((f) => `${f.category}:${f.key}`));

    const existing = await ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const openRiskInsights = existing.filter((i) => i.kind === "risk" && (i.status === "new" || i.status === "seen") && (i.entityType ?? "").startsWith("risk:"));
    const openByTag = new Map(openRiskInsights.map((i) => [i.entityType as string, i] as const));

    let posted = 0;
    for (const f of critical) {
      const tag = `risk:${f.category}:${f.key}`;
      if (openByTag.has(tag)) continue; // already surfaced
      await ctx.db.insert("insights", {
        orgId,
        kind: "risk",
        title: f.title,
        body: f.detail,
        entityType: tag,
        entityId: f.entityId,
        status: "new",
        severity: "warning",
      });
      posted++;
    }

    // Self-heal: dismiss open risk insights whose underlying flag has cleared.
    let cleared = 0;
    for (const i of openRiskInsights) {
      const tag = (i.entityType ?? "").slice("risk:".length);
      if (!liveKeys.has(tag)) {
        await ctx.db.patch(i._id, { status: "dismissed" });
        cleared++;
      }
    }
    return { posted, cleared, critical: critical.length };
  },
});
