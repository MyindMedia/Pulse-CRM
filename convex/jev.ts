import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { askJev, jevEnabled } from "./lib/jevClient";
import { RECEPTIONIST_QUESTIONS, receptionistState, jevIntent } from "./lib/jevQuestions";
import { RECEPTIONIST_SAMPLES } from "./lib/receptionistSamples";
import { classifyIntent, receptionistAction } from "./receptionist";

/* ============================================================
   Jev (TypeSafe System One): fast, calibrated yes/no and choice judgments.

   Listen-only for now. Jev answers the same questions as the live classifier
   and the pair is logged (jevShadow) without the message text, so its
   decisions can be compared and thresholds tuned before Jev acts on
   anything. Switch: JEV_SHADOW=1 plus TYPESAFE_API_KEY on the deployment.
   The key stays server-side; nothing here runs in a browser.
   ============================================================ */

/** Ask Jev the receptionist's two questions. Null when Jev is unavailable. */
async function askReceptionist(
  body: string,
  studioName?: string | null,
): Promise<{ action: "human" | "booking" | "skip"; probabilities: Record<string, number>; model: string; latencyMs: number } | null> {
  const asked = await askJev(receptionistState(body, studioName), RECEPTIONIST_QUESTIONS);
  if (!asked) return null;
  const { answers, model } = asked.result;
  return {
    action: receptionistAction(jevIntent(answers)),
    probabilities: { bookingInquiry: answers.bookingInquiry.noul, wantsHuman: answers.wantsHuman.noul },
    model,
    latencyMs: asked.latencyMs,
  };
}

export const _record = internalMutation({
  args: {
    orgId: v.string(),
    feature: v.string(),
    sourceId: v.optional(v.string()),
    primarySource: v.string(),
    primaryAction: v.string(),
    jevAction: v.string(),
    jevProbabilities: v.record(v.string(), v.number()),
    model: v.string(),
    latencyMs: v.number(),
  },
  handler: async (ctx, row) => {
    await ctx.db.insert("jevShadow", { ...row, at: Date.now() });
  },
});

/** Scheduled by receptionist.handle after the live classification. Logs Jev's
 *  answer next to the live one; never sends anything or changes the reply. */
export const shadowReceptionist = internalAction({
  args: {
    orgId: v.string(),
    body: v.string(),
    studioName: v.optional(v.union(v.string(), v.null())),
    sourceId: v.optional(v.string()),
    primary: v.object({ isBookingInquiry: v.boolean(), wantsHuman: v.boolean(), source: v.string() }),
  },
  handler: async (ctx, { orgId, body, studioName, sourceId, primary }) => {
    if (!jevEnabled()) return { logged: false, reason: "no_key" };
    const jev = await askReceptionist(body, studioName);
    if (!jev) return { logged: false, reason: "jev_unavailable" };
    await ctx.runMutation(internal.jev._record, {
      orgId,
      feature: "receptionist.intent",
      sourceId,
      primarySource: primary.source,
      primaryAction: receptionistAction(primary),
      jevAction: jev.action,
      jevProbabilities: jev.probabilities,
      model: jev.model,
      latencyMs: jev.latencyMs,
    });
    return { logged: true, primaryAction: receptionistAction(primary), jevAction: jev.action };
  },
});

/** Operator report over the shadow log: how often Jev's action matches the
 *  live one, which way they disagree, and Jev's latency.
 *  `npx convex run jev:report '{}'` */
export const report = internalQuery({
  args: { feature: v.optional(v.string()), sinceMs: v.optional(v.number()) },
  handler: async (ctx, { feature = "receptionist.intent", sinceMs = 0 }) => {
    const rows = await ctx.db
      .query("jevShadow")
      .withIndex("by_feature_at", (q) => q.eq("feature", feature).gte("at", sinceMs))
      .collect();
    const pairs: Record<string, number> = {};
    let agree = 0;
    let latency = 0;
    for (const r of rows) {
      const key = `${r.primaryAction} -> ${r.jevAction}`;
      pairs[key] = (pairs[key] ?? 0) + 1;
      if (r.primaryAction === r.jevAction) agree += 1;
      latency += r.latencyMs;
    }
    return {
      feature,
      total: rows.length,
      agreement: rows.length ? agree / rows.length : null,
      avgJevLatencyMs: rows.length ? Math.round(latency / rows.length) : null,
      pairs,
    };
  },
});

/** Replay the labeled sample texts through the live classifier and Jev and
 *  score both against the expected action. For staging, which receives no
 *  real texts. `npx convex run jev:replayReceptionist '{}'` */
export const replayReceptionist = internalAction({
  args: {},
  handler: async () => {
    if (!jevEnabled()) throw new Error("TYPESAFE_API_KEY is not set on this deployment.");
    const rows: {
      text: string;
      expected: string;
      live: string;
      liveSource: string;
      jev: string | null;
      bookingInquiry: number | null;
      wantsHuman: number | null;
    }[] = [];
    const jevLatency: number[] = [];
    // Five at a time keeps the live classifier's calls polite.
    for (let i = 0; i < RECEPTIONIST_SAMPLES.length; i += 5) {
      const batch = RECEPTIONIST_SAMPLES.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (s) => {
          const [live, jev] = await Promise.all([classifyIntent(s.text), askReceptionist(s.text)]);
          if (jev) jevLatency.push(jev.latencyMs);
          return {
            text: s.text,
            expected: s.expected,
            live: receptionistAction(live),
            liveSource: live.source,
            jev: jev?.action ?? null,
            bookingInquiry: jev ? Math.round(jev.probabilities.bookingInquiry * 100) / 100 : null,
            wantsHuman: jev ? Math.round(jev.probabilities.wantsHuman * 100) / 100 : null,
          };
        }),
      );
      rows.push(...results);
    }
    const n = rows.length;
    const liveRight = rows.filter((r) => r.live === r.expected).length;
    const jevRight = rows.filter((r) => r.jev === r.expected).length;
    const sorted = [...jevLatency].sort((a, b) => a - b);
    return {
      samples: n,
      liveAccuracy: liveRight / n,
      jevAccuracy: jevRight / n,
      jevLatencyMsP50: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      misses: rows.filter((r) => r.live !== r.expected || r.jev !== r.expected),
    };
  },
});
