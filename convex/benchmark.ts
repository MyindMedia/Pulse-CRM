import { query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";

/* ============================================================
   State of the Recording Studio.

   Studio owners have no numbers. Rates have been flat for four years
   and nobody can say whether that is them or the market. Pulse holds
   the only dataset that can answer it.

   PRIVACY IS THE WHOLE DESIGN. Three rules, enforced here rather
   than promised in a policy:

     1. Minimum cohort. A number is only returned when at least
        MIN_COHORT distinct studios contribute to it. Below that it
        comes back null, not rounded, not estimated.
     2. No identifiers. Nothing here returns an orgId, a name, a slug,
        a client, or anything traceable to one studio.
     3. Medians, not totals. A total can be reverse-engineered by a
        studio that knows its own contribution; a median cannot.
   ============================================================ */

/** Below this many studios in a cohort, we publish nothing. */
export const MIN_COHORT = 5;

const DAY = 86_400_000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

/** A cohort's stats, or nulls when too few studios contributed. */
function summarize(
  label: string,
  studios: { rates: number[]; utilization: number; noShowPct: number; leadDays: number[] }[],
) {
  const n = studios.length;
  if (n < MIN_COHORT) {
    return { label, studios: n, suppressed: true as const,
      medianHourlyCents: null, p25HourlyCents: null, p75HourlyCents: null,
      medianUtilizationPct: null, medianNoShowPct: null, medianLeadDays: null };
  }
  const allRates = studios.flatMap((s) => s.rates);
  return {
    label,
    studios: n,
    suppressed: false as const,
    medianHourlyCents: median(allRates),
    p25HourlyCents: percentile(allRates, 25),
    p75HourlyCents: percentile(allRates, 75),
    medianUtilizationPct: median(studios.map((s) => s.utilization)),
    medianNoShowPct: median(studios.map((s) => s.noShowPct)),
    medianLeadDays: median(studios.flatMap((s) => s.leadDays)),
  };
}

type StudioStats = {
  region: string;
  roomTypes: string[];
  rates: number[];
  utilization: number;
  noShowPct: number;
  leadDays: number[];
};

async function gather(ctx: QueryCtx, windowDays: number): Promise<StudioStats[]> {
  const since = Date.now() - windowDays * DAY;
  const orgs = (await ctx.db.query("orgs").collect()).filter(
    (o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo",
  );

  const out: StudioStats[] = [];
  for (const org of orgs) {
    const rooms = (await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect()).filter((r) => r.status !== "retired");
    const rates = rooms.map((r) => r.hourlyRateCents ?? 0).filter((c) => c > 0);
    if (rates.length === 0) continue;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", org.orgId).gte("startTime", since))
      .collect();
    // A studio with almost no activity would swing a median without being
    // representative of anything.
    if (sessions.length < 3) continue;

    const held = sessions.filter((s) => s.status !== "cancelled");
    const noShows = sessions.filter((s) => s.status === "no_show").length;
    const bookedMs = held.reduce((sum, s) => sum + Math.max(0, s.endTime - s.startTime), 0);
    // Utilization against a 10-hour day per room, which is the honest
    // approximation: nobody sells 24 hours.
    const capacityMs = rooms.length * windowDays * 10 * 3_600_000;

    const leadDays = held
      .map((s) => (s.startTime - s._creationTime) / DAY)
      .filter((d) => d >= 0 && d < 365)
      .map((d) => Math.round(d));

    out.push({
      region: org.directoryRegion?.trim() || "Unreported",
      roomTypes: [...new Set(rooms.map((r) => r.roomType).filter(Boolean) as string[])],
      rates,
      utilization: capacityMs > 0 ? Math.round((bookedMs / capacityMs) * 100) : 0,
      noShowPct: sessions.length ? Math.round((noShows / sessions.length) * 100) : 0,
      leadDays,
    });
  }
  return out;
}

/**
 * The benchmark, plus this studio's own position in it.
 *
 * Gated on Reports: the report is a reason to be on a paid plan, and the
 * studio-vs-market comparison is the part that only makes sense with your own
 * numbers next to it.
 */
export const report = query({
  args: { windowDays: v.optional(v.number()) },
  handler: async (ctx, { windowDays }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const window = Math.min(Math.max(windowDays ?? 90, 30), 365);
    const all = await gather(ctx, window);

    const overall = summarize("All studios", all);

    const byRegion = new Map<string, StudioStats[]>();
    for (const s of all) {
      const arr = byRegion.get(s.region) ?? [];
      arr.push(s);
      byRegion.set(s.region, arr);
    }
    const byRoomType = new Map<string, StudioStats[]>();
    for (const s of all) {
      for (const rt of s.roomTypes) {
        const arr = byRoomType.get(rt) ?? [];
        arr.push(s);
        byRoomType.set(rt, arr);
      }
    }

    // The caller's own numbers, computed the same way, so the comparison is
    // like for like rather than one method against another.
    const myRooms = (await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()).filter((r) => r.status !== "retired");
    const myRates = myRooms.map((r) => r.hourlyRateCents ?? 0).filter((c) => c > 0);
    const mySessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", Date.now() - window * DAY),
      )
      .collect();
    const myHeld = mySessions.filter((s) => s.status !== "cancelled");
    const myNoShows = mySessions.filter((s) => s.status === "no_show").length;
    const myBookedMs = myHeld.reduce((sum, s) => sum + Math.max(0, s.endTime - s.startTime), 0);
    const myCapacityMs = myRooms.length * window * 10 * 3_600_000;

    const you = {
      medianHourlyCents: median(myRates),
      utilizationPct: myCapacityMs > 0 ? Math.round((myBookedMs / myCapacityMs) * 100) : null,
      noShowPct: mySessions.length ? Math.round((myNoShows / mySessions.length) * 100) : null,
      sessions: mySessions.length,
    };

    return {
      windowDays: window,
      minCohort: MIN_COHORT,
      // Say the sample size out loud. A benchmark that hides how thin it is
      // is worse than no benchmark.
      contributingStudios: all.length,
      publishable: all.length >= MIN_COHORT,
      overall,
      byRegion: [...byRegion.entries()]
        .map(([label, s]) => summarize(label, s))
        .sort((a, b) => b.studios - a.studios),
      byRoomType: [...byRoomType.entries()]
        .map(([label, s]) => summarize(label, s))
        .sort((a, b) => b.studios - a.studios),
      you,
      // How this studio sits against the market, only where both halves exist.
      comparison:
        overall.suppressed || you.medianHourlyCents === null
          ? null
          : {
              rateDeltaPct: overall.medianHourlyCents
                ? Math.round(
                    ((you.medianHourlyCents - overall.medianHourlyCents) /
                      overall.medianHourlyCents) * 100,
                  )
                : null,
              utilizationDeltaPts:
                you.utilizationPct !== null && overall.medianUtilizationPct !== null
                  ? you.utilizationPct - overall.medianUtilizationPct
                  : null,
              noShowDeltaPts:
                you.noShowPct !== null && overall.medianNoShowPct !== null
                  ? you.noShowPct - overall.medianNoShowPct
                  : null,
            },
    };
  },
});
