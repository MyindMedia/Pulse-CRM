import { query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Predictive intelligence + learning loop.

   Two prediction families, both grounded in the studio's OWN data
   (not a generic prior):
     - no-show probability per upcoming session, driving a deposit
       recommendation;
     - room dynamic-pricing recommendation from real utilisation.

   Plus a learning loop: when the owner edits or dismisses an AI
   draft, that decision is captured as an `agentMemories` note and
   fed back into future draft generation, so the agent gets more
   on-voice the longer a studio uses it.

   The scoring layer is pure (data in / data out) so it is unit
   tested without a database.
   ============================================================ */

const DAY = 86_400_000;
const BOOKABLE_HOURS_PER_DAY = 10; // assumed sellable hours/room/day for utilisation
const UTIL_WINDOW_DAYS = 30;

/* ── Pure no-show model ─────────────────────────────────────── */

export type NoShowInput = {
  reliability: string; // "solid" | "watch" | "flagged"
  depositPaid: boolean;
  priorSessions: number; // this artist's completed + no-show count
  priorNoShows: number; // this artist's no-show count
};

export type RiskBand = "low" | "elevated" | "high";

/**
 * No-show probability in 0..0.95. Blends a reliability/deposit base with the
 * artist's own historical no-show rate at this studio, so it sharpens as the
 * studio accumulates history. New clients carry a small uncertainty bump.
 */
export function noShowProbability(i: NoShowInput): number {
  let base = i.reliability === "flagged" ? 0.5 : i.reliability === "watch" ? 0.3 : 0.12;
  if (!i.depositPaid) base += 0.2;
  const historyRate = i.priorSessions > 0 ? i.priorNoShows / i.priorSessions : 0;
  const newClientBump = i.priorSessions === 0 ? 0.05 : 0;
  const p = base * 0.6 + historyRate * 0.4 + newClientBump;
  return Math.max(0, Math.min(0.95, p));
}

export function riskBand(p: number): RiskBand {
  return p >= 0.4 ? "high" : p >= 0.22 ? "elevated" : "low";
}

/** Deposit % to protect the slot, scaled to risk. */
export function suggestedDepositPct(p: number): number {
  if (p >= 0.4) return 50;
  if (p >= 0.22) return 30;
  return 20;
}

function riskReasons(i: NoShowInput): string[] {
  const out: string[] = [];
  if (i.reliability === "flagged") out.push("Client is flagged for reliability.");
  else if (i.reliability === "watch") out.push("Client is on the watch list.");
  if (!i.depositPaid) out.push("No deposit on file yet.");
  if (i.priorSessions > 0 && i.priorNoShows > 0) {
    out.push(`${i.priorNoShows} no-show${i.priorNoShows === 1 ? "" : "s"} in ${i.priorSessions} prior session${i.priorSessions === 1 ? "" : "s"}.`);
  }
  if (i.priorSessions === 0) out.push("First booking - no history yet.");
  if (out.length === 0) out.push("Solid history and deposit paid.");
  return out;
}

/* ── Pure pricing model ─────────────────────────────────────── */

export type PricingInput = { utilizationPct: number; hourlyRateCents: number };
export type PricingRec = {
  action: "raise" | "hold" | "discount";
  suggestedRateCents: number;
  reason: string;
};

export function pricingRecommendation(i: PricingInput): PricingRec {
  if (i.hourlyRateCents <= 0) {
    return { action: "hold", suggestedRateCents: i.hourlyRateCents, reason: "No rate set on this room." };
  }
  if (i.utilizationPct >= 85) {
    const r = Math.round((i.hourlyRateCents * 1.12) / 100) * 100;
    return { action: "raise", suggestedRateCents: r, reason: `Running at ${i.utilizationPct}% - demand supports about 12% more on peak windows.` };
  }
  if (i.utilizationPct <= 30) {
    const r = Math.round((i.hourlyRateCents * 0.85) / 100) * 100;
    return { action: "discount", suggestedRateCents: r, reason: `Only ${i.utilizationPct}% booked - an off-peak discount fills idle time.` };
  }
  return { action: "hold", suggestedRateCents: i.hourlyRateCents, reason: `Healthy at ${i.utilizationPct}% - hold the rate.` };
}

/* ── Data-backed helpers ────────────────────────────────────── */

async function artistHistory(ctx: { db: QueryCtx["db"] }, artistId: Id<"artists">, excludeSessionId?: Id<"sessions">) {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_artist", (q) => q.eq("artistId", artistId))
    .collect();
  let priorSessions = 0;
  let priorNoShows = 0;
  for (const s of sessions) {
    if (excludeSessionId && s._id === excludeSessionId) continue;
    if (s.status === "completed" || s.status === "no_show") priorSessions += 1;
    if (s.status === "no_show") priorNoShows += 1;
  }
  return { priorSessions, priorNoShows };
}

async function scoreSession(ctx: { db: QueryCtx["db"] }, session: Doc<"sessions">) {
  const artist = await ctx.db.get(session.artistId);
  const { priorSessions, priorNoShows } = await artistHistory(ctx, session.artistId, session._id);
  const input: NoShowInput = {
    reliability: artist?.reliability ?? "solid",
    depositPaid: session.depositPaid,
    priorSessions,
    priorNoShows,
  };
  const p = noShowProbability(input);
  const band = riskBand(p);
  return {
    sessionId: session._id,
    title: session.title,
    startTime: session.startTime,
    artistName: artist?.name ?? "Unknown",
    score: Math.round(p * 100),
    band,
    suggestedDepositPct: suggestedDepositPct(p),
    reasons: riskReasons(input),
  };
}

/* ── Studio-facing queries ──────────────────────────────────── */

/** No-show risk for one upcoming session. */
export const sessionRisk = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    return scoreSession(ctx, session);
  },
});

/** Ranked no-show risk across upcoming sessions (highest first). */
export const upcomingRisks = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const now = Date.now();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const upcoming = sessions.filter(
      (s) => s.startTime > now && (s.status === "tentative" || s.status === "confirmed"),
    );
    const scored = await Promise.all(upcoming.map((s) => scoreSession(ctx, s)));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit ?? 20);
  },
});

/** Per-room utilisation + a dynamic-pricing recommendation. */
export const roomPricing = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const now = Date.now();
    const since = now - UTIL_WINDOW_DAYS * DAY;
    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const capacityMs = UTIL_WINDOW_DAYS * BOOKABLE_HOURS_PER_DAY * 3_600_000;

    return rooms.map((room) => {
      const bookedMs = sessions
        .filter(
          (s) =>
            s.roomId === room._id &&
            s.startTime >= since &&
            (s.status === "completed" || s.status === "confirmed" || s.status === "in_progress"),
        )
        .reduce((sum, s) => sum + Math.max(0, s.endTime - s.startTime), 0);
      const utilizationPct = capacityMs > 0 ? Math.min(100, Math.round((bookedMs / capacityMs) * 100)) : 0;
      const rec = pricingRecommendation({ utilizationPct, hourlyRateCents: room.hourlyRateCents ?? 0 });
      return {
        roomId: room._id,
        name: room.name,
        hourlyRateCents: room.hourlyRateCents ?? 0,
        utilizationPct,
        ...rec,
      };
    });
  },
});

/* ── Learning loop ──────────────────────────────────────────── */

function snippet(s: string, max = 160): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

/**
 * Capture an owner edit of an AI draft as a style preference the enricher can
 * reuse. Only fires for email actions whose body actually changed.
 */
export async function recordApprovalLearning(ctx: MutationCtx, action: Doc<"opsActions">, finalBody?: string): Promise<void> {
  if (!finalBody) return;
  if (action.payload.kind !== "email") return;
  if (finalBody.trim() === action.payload.body.trim()) return;
  const now = Date.now();
  await ctx.db.insert("agentMemories", {
    orgId: action.orgId,
    memoryType: "tone_preferences",
    summary: `For ${action.type} emails, the owner edited the draft toward: "${snippet(finalBody)}"`,
    confidence: 0.5,
    source: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

/** Capture a dismissal so repeated rejections of a type are visible. */
export async function recordDismissLearning(ctx: MutationCtx, action: Doc<"opsActions">): Promise<void> {
  const now = Date.now();
  await ctx.db.insert("agentMemories", {
    orgId: action.orgId,
    memoryType: "automation_history",
    summary: `Owner dismissed a ${action.type} suggestion ("${snippet(action.title, 80)}").`,
    confidence: 0.4,
    source: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Internal: short style-guidance block for the enricher, drawn from the most
 * recent edit-preferences relevant to this action type. Empty string when none.
 */
export const styleGuidance = internalQuery({
  args: { orgId: v.string(), actionType: v.string() },
  handler: async (ctx, { orgId, actionType }) => {
    const notes = await ctx.db
      .query("agentMemories")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .collect();
    const relevant = notes
      .filter((n) => n.memoryType === "tone_preferences" && n.summary.includes(actionType))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 2);
    if (relevant.length === 0) return "";
    return (
      "STUDIO STYLE NOTES (match this owner's edits to past drafts):\n" +
      relevant.map((n) => `- ${n.summary}`).join("\n")
    );
  },
});
