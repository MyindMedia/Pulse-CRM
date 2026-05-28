import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  noShowProbability, riskBand, suggestedDepositPct, pricingRecommendation,
} from "./predictions";

const ORG = "pulse-demo";
const DAY = 86_400_000;

async function drain(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("no-show model (pure)", () => {
  it("flagged clients outrank solid clients", () => {
    const flagged = noShowProbability({ reliability: "flagged", depositPaid: true, priorSessions: 0, priorNoShows: 0 });
    const solid = noShowProbability({ reliability: "solid", depositPaid: true, priorSessions: 0, priorNoShows: 0 });
    expect(flagged).toBeGreaterThan(solid);
  });

  it("an unpaid deposit raises the score", () => {
    const paid = noShowProbability({ reliability: "solid", depositPaid: true, priorSessions: 5, priorNoShows: 0 });
    const unpaid = noShowProbability({ reliability: "solid", depositPaid: false, priorSessions: 5, priorNoShows: 0 });
    expect(unpaid).toBeGreaterThan(paid);
  });

  it("the studio's own no-show history raises the score", () => {
    const clean = noShowProbability({ reliability: "solid", depositPaid: true, priorSessions: 10, priorNoShows: 0 });
    const flaky = noShowProbability({ reliability: "solid", depositPaid: true, priorSessions: 10, priorNoShows: 5 });
    expect(flaky).toBeGreaterThan(clean);
  });

  it("stays within 0..0.95 and bands sensibly", () => {
    const p = noShowProbability({ reliability: "flagged", depositPaid: false, priorSessions: 4, priorNoShows: 4 });
    expect(p).toBeLessThanOrEqual(0.95);
    expect(p).toBeGreaterThan(0);
    expect(riskBand(0.5)).toBe("high");
    expect(riskBand(0.3)).toBe("elevated");
    expect(riskBand(0.1)).toBe("low");
    expect(suggestedDepositPct(0.5)).toBe(50);
    expect(suggestedDepositPct(0.1)).toBe(20);
  });
});

describe("pricing model (pure)", () => {
  it("raises a hot room, discounts a cold room, holds a healthy one", () => {
    expect(pricingRecommendation({ utilizationPct: 90, hourlyRateCents: 10000 }).action).toBe("raise");
    expect(pricingRecommendation({ utilizationPct: 15, hourlyRateCents: 10000 }).action).toBe("discount");
    expect(pricingRecommendation({ utilizationPct: 55, hourlyRateCents: 10000 }).action).toBe("hold");
  });

  it("a hot-room raise suggests a higher rate", () => {
    const rec = pricingRecommendation({ utilizationPct: 95, hourlyRateCents: 10000 });
    expect(rec.suggestedRateCents).toBeGreaterThan(10000);
  });
});

describe("prediction queries + learning loop", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("sessionRisk scores an upcoming session from artist history", async () => {
    const sessionId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Risky", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "watch",
      });
      return ctx.db.insert("sessions", {
        orgId: ORG, title: "Future date", artistId, serviceType: "recording",
        startTime: Date.now() + DAY, endTime: Date.now() + DAY + 3_600_000,
        status: "confirmed", rateCents: 10000, depositCents: 2000, depositPaid: false, intakeCompleted: false,
      });
    });
    const risk = await t.query(api.predictions.sessionRisk, { sessionId });
    expect(risk).not.toBeNull();
    expect(risk!.band === "elevated" || risk!.band === "high").toBe(true);
    expect(risk!.suggestedDepositPct).toBeGreaterThanOrEqual(30);
  });

  it("roomPricing recommends a discount for an idle room", async () => {
    await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        orgId: ORG, name: "Quiet B", roomType: "Mix suite", status: "available", hourlyRateCents: 8000,
      });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Occasional", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      await ctx.db.insert("sessions", {
        orgId: ORG, title: "One session", artistId, serviceType: "mixing", roomId,
        startTime: Date.now() - 2 * DAY, endTime: Date.now() - 2 * DAY + 7_200_000,
        status: "completed", rateCents: 16000, depositCents: 4000, depositPaid: true, intakeCompleted: true,
      });
    });
    const rows = await t.query(api.predictions.roomPricing, {});
    const quiet = rows.find((r) => r.name === "Quiet B");
    expect(quiet).toBeDefined();
    expect(quiet!.action).toBe("discount");
    expect(quiet!.utilizationPct).toBeLessThan(30);
  });

  it("approving with an edit records a style preference the enricher can reuse", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("opsActions", {
        orgId: ORG, type: "convert_lead", priority: "high",
        title: "Convert lead - X", rationale: "new",
        entityType: "artist", entityId: "a1",
        payload: { kind: "email", to: "x@x.com", subject: "Hi", body: "Original draft body.", notifyKind: "lead.convert" },
        status: "proposed", autonomy: false, source: "rule",
        dedupeKey: "convert_lead:a1", createdAt: Date.now(),
      }),
    );
    await t.mutation(api.opsActions.approve, { id, editedBody: "Hand-tuned, punchier copy that the owner prefers." });
    await drain(t);

    const notes = await t.run(async (ctx) =>
      (await ctx.db.query("agentMemories").collect()).filter(
        (m) => m.orgId === ORG && m.memoryType === "tone_preferences",
      ),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].summary).toContain("convert_lead");
  });

  it("dismissing records an automation-history note", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("opsActions", {
        orgId: ORG, type: "pricing_opportunity", priority: "low",
        title: "Raise Room A rate", rationale: "hot",
        entityType: "room", entityId: "r1",
        payload: { kind: "note_only" },
        status: "proposed", autonomy: false, source: "rule",
        dedupeKey: "pricing_opportunity:r1", createdAt: Date.now(),
      }),
    );
    await t.mutation(api.opsActions.dismiss, { id });

    const notes = await t.run(async (ctx) =>
      (await ctx.db.query("agentMemories").collect()).filter(
        (m) => m.orgId === ORG && m.memoryType === "automation_history",
      ),
    );
    expect(notes.some((n) => n.summary.includes("pricing_opportunity"))).toBe(true);
  });
});
