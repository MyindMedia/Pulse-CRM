import { describe, it, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { RECEPTIONIST_QUESTIONS, jevIntent } from "./lib/jevQuestions";
import { receptionistAction } from "./receptionist";

/* Jev (TypeSafe System One), listen-only. These tests hold the promise that
   matters: Jev's answer is logged next to the live decision, without the
   message text, and nothing about the reply to the client changes. */

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => {
  class APIError extends Error {}
  class TypeSafeClient {
    systemOne = systemOne;
  }
  return { TypeSafeClient, APIError };
});

const jevAnswers = (bookingInquiry: number, wantsHuman: number) => ({
  model: "jev-1.13.0",
  answers: {
    bookingInquiry: { type: "noul", noul: bookingInquiry },
    wantsHuman: { type: "noul", noul: wantsHuman },
  },
  usage: { input_tokens: 120, output_tokens: 4 },
});

const ORG = "pulse-demo";
const initT = () => convexTest(schema);

describe("Jev receptionist questions (pure)", () => {
  it("asks two yes/no questions with criteria", () => {
    for (const q of Object.values(RECEPTIONIST_QUESTIONS)) {
      expect(q.type).toBe("noul");
      expect(q.instructions.length).toBeGreaterThan(20);
      expect(q.criteria.true && q.criteria.false).toBeTruthy();
    }
  });

  it("thresholds probabilities, and a human request outranks a booking one", () => {
    expect(jevIntent({ bookingInquiry: { noul: 0.92 }, wantsHuman: { noul: 0.08 } })).toEqual({ isBookingInquiry: true, wantsHuman: false });
    expect(jevIntent({ bookingInquiry: { noul: 0.9 }, wantsHuman: { noul: 0.7 } })).toEqual({ isBookingInquiry: false, wantsHuman: true });
    expect(jevIntent({ bookingInquiry: { noul: 0.3 }, wantsHuman: { noul: 0.2 } })).toEqual({ isBookingInquiry: false, wantsHuman: false });
    expect(jevIntent({ bookingInquiry: { noul: 0.6 }, wantsHuman: { noul: 0.1 } }, 0.7).isBookingInquiry).toBe(false);
  });

  it("maps an intent to the action a client experiences", () => {
    expect(receptionistAction({ isBookingInquiry: true, wantsHuman: true })).toBe("human");
    expect(receptionistAction({ isBookingInquiry: true, wantsHuman: false })).toBe("booking");
    expect(receptionistAction({ isBookingInquiry: false, wantsHuman: false })).toBe("skip");
  });
});

describe("jev.shadowReceptionist", () => {
  beforeEach(() => {
    systemOne.mockReset();
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
  });

  const primary = { isBookingInquiry: true, wantsHuman: false, source: "anthropic" };

  it("logs Jev's action and probabilities next to the live one, without the message text", async () => {
    const t = initT();
    systemOne.mockResolvedValue(jevAnswers(0.94, 0.05));
    const res = await t.action(internal.jev.shadowReceptionist, {
      orgId: ORG, body: "Any studio time Saturday?", studioName: "Skyline", sourceId: "msg_1", primary,
    });
    expect(res).toMatchObject({ logged: true, primaryAction: "booking", jevAction: "booking" });
    const [row] = await t.run((ctx) => ctx.db.query("jevShadow").collect());
    expect(row).toMatchObject({
      orgId: ORG, feature: "receptionist.intent", sourceId: "msg_1",
      primarySource: "anthropic", primaryAction: "booking", jevAction: "booking", model: "jev-1.13.0",
      jevProbabilities: { bookingInquiry: 0.94, wantsHuman: 0.05 },
    });
    expect(JSON.stringify(row)).not.toContain("Saturday");
    // Jev saw the text as data, alongside the channel and studio.
    expect(systemOne.mock.calls[0][0].state).toMatchObject({ message: "Any studio time Saturday?", studio: "Skyline" });
  });

  it("records a disagreement as it is", async () => {
    const t = initT();
    systemOne.mockResolvedValue(jevAnswers(0.4, 0.86));
    await t.action(internal.jev.shadowReceptionist, { orgId: ORG, body: "call me", primary });
    const [row] = await t.run((ctx) => ctx.db.query("jevShadow").collect());
    expect(row).toMatchObject({ primaryAction: "booking", jevAction: "human" });
  });

  it("logs nothing without a key, and nothing when Jev is down", async () => {
    const t = initT();
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await t.action(internal.jev.shadowReceptionist, { orgId: ORG, body: "hi", primary })).toMatchObject({ logged: false, reason: "no_key" });
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    systemOne.mockRejectedValue(new Error("network down"));
    expect(await t.action(internal.jev.shadowReceptionist, { orgId: ORG, body: "hi", primary })).toMatchObject({ logged: false, reason: "jev_unavailable" });
    expect(await t.run((ctx) => ctx.db.query("jevShadow").collect())).toHaveLength(0);
  });
});

describe("jev.report", () => {
  it("summarizes agreement, disagreement pairs and latency", async () => {
    const t = initT();
    const base = { orgId: ORG, feature: "receptionist.intent", primarySource: "anthropic", jevProbabilities: {}, model: "jev-1.13.0" };
    await t.mutation(internal.jev._record, { ...base, primaryAction: "booking", jevAction: "booking", latencyMs: 200 });
    await t.mutation(internal.jev._record, { ...base, primaryAction: "skip", jevAction: "skip", latencyMs: 300 });
    await t.mutation(internal.jev._record, { ...base, primaryAction: "booking", jevAction: "human", latencyMs: 400 });
    const r = await t.query(internal.jev.report, {});
    expect(r).toMatchObject({ total: 3, avgJevLatencyMs: 300, pairs: { "booking -> booking": 1, "skip -> skip": 1, "booking -> human": 1 } });
    expect(r.agreement).toBeCloseTo(2 / 3);
  });
});

describe("receptionist.handle shadow hook", () => {
  async function setup() {
    const t = initT();
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active",
        ownerEmail: "owner@skyline.com", aiReceptionistEnabled: true,
      });
    });
    const artistId = await t.run((ctx) =>
      ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", phone: "(404) 555-0140", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }),
    );
    return { t, artistId };
  }
  const queuedShadows = (t: ReturnType<typeof initT>) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("shadowReceptionist")),
    );

  it("queues the Jev shadow when JEV_SHADOW=1, and the reply is unchanged", async () => {
    const { t, artistId } = await setup();
    vi.stubEnv("JEV_SHADOW", "1");
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    const res = await t.action(internal.receptionist.handle, {
      orgId: ORG, from: "+14045550140", body: "Do you have studio time to book this weekend?", artistId,
    });
    expect(res.status).toBe("replied_booking");
    const queued = await queuedShadows(t);
    expect(queued).toHaveLength(1);
    expect(queued[0].args[0]).toMatchObject({ primary: { isBookingInquiry: true, wantsHuman: false, source: "heuristic" } });
  });

  it("queues nothing when the switch is off", async () => {
    const { t, artistId } = await setup();
    vi.stubEnv("JEV_SHADOW", "");
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    await t.action(internal.receptionist.handle, {
      orgId: ORG, from: "+14045550140", body: "Do you have studio time to book this weekend?", artistId,
    });
    expect(await queuedShadows(t)).toHaveLength(0);
  });
});
