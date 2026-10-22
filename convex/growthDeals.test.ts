import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { localMidnight } from "./lib/roomBlockRange";
import { localDayKey } from "./lib/tz";

/* Off-peak pricing, deal texts and the Google review link
   (openspec/changes/off-peak-and-google-reviews). No identity = the demo
   viewer, owner of pulse-demo. No SMS provider or TypeSafe key = sends are
   simulated and the agent is "unreachable". */

const ORG = "pulse-demo";
const TZ = "America/New_York";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ALL_DAY = { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, pct: 25 };

function artistRow(orgId: string, name: string, phone?: string, extra: Record<string, unknown> = {}) {
  return {
    orgId, name, type: "artist" as const, phone,
    genres: [], tags: [], status: "active" as const, lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" as const,
    ...extra,
  };
}

async function scheduledSends(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((s) => s.name.endsWith(":_send") || s.name.endsWith(":_deliver"))
      .map((s) => s.args[0] as { to?: string; phone?: string; body?: string; text?: string }),
  );
}

describe("off-peak pricing at booking", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  const start = Date.now() + 7 * DAY;

  beforeEach(async () => {
    t = convexTest(schema);
    room = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active", timezone: TZ,
        offPeakEnabled: true,
        discountCodes: [
          { code: "SAVE10", pct: 10, active: true },
          { code: "SAVE50", pct: 50, active: true },
        ],
      });
      return ctx.db.insert("rooms", {
        orgId: ORG, name: "Room A", status: "available", bookable: true,
        hourlyRateCents: 10000, minimumHours: 1, depositPct: 30, offPeakWindows: [ALL_DAY],
      });
    });
  });

  it("charges the off-peak rate and records the saving, not a comp", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", startTime: start, durationHours: 2,
    });
    expect(res.rateCents).toBe(15000);
    expect(res.offPeakCents).toBe(5000);
    expect(res.depositCents).toBe(Math.round(15000 * 0.3));
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.offPeakCents).toBe(5000);
    expect(s?.compType).toBeUndefined();
  });

  it("a weaker promo code is not spent; a stronger one wins alone", async () => {
    const weak = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", startTime: start, durationHours: 2, discountCode: "SAVE10",
    });
    expect(weak.rateCents).toBe(15000);
    expect(weak.discountCode).toBeNull();

    const strong = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", startTime: start + 3 * HOUR, durationHours: 2, discountCode: "SAVE50",
    });
    expect(strong.rateCents).toBe(10000);
    expect(strong.discountCode).toBe("SAVE50");
    expect(strong.offPeakCents).toBe(0);
    const s = await t.run((ctx) => ctx.db.get(strong.sessionId));
    expect(s?.compType).toBe("discounted");
    expect(s?.offPeakCents).toBeUndefined();
  });

  it("charges full price when the studio switch is off", async () => {
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect())[0];
      await ctx.db.patch(org._id, { offPeakEnabled: false });
    });
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", startTime: start, durationHours: 2,
    });
    expect(res.rateCents).toBe(20000);
  });

  it("ships the windows to the public page only while prices are shown", async () => {
    const shown = await t.query(api.booking.room, { roomId: room });
    expect(shown?.offPeak).toEqual({ windows: [ALL_DAY], tz: TZ });
    expect(shown).not.toHaveProperty("offPeakWindows");

    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect())[0];
      await ctx.db.patch(org._id, { bookingFeatures: { hidePricing: true } });
    });
    const hidden = await t.query(api.booking.room, { roomId: room });
    expect(hidden?.offPeak).toBeNull();
  });

  it("confirms a new opt-in by text once deal texts are live", async () => {
    vi.useFakeTimers();
    await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", clientPhone: "404-555-0109",
      startTime: start, durationHours: 1, dealsOptIn: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    const a = await t.run(async (ctx) => (await ctx.db.query("artists").collect())[0]);
    expect(a.dealsConfirmSentAt).toBeGreaterThan(0);
    const sends = await scheduledSends(t);
    expect(sends.some((s) => s.to === "+14045550109" && /deals list/.test(s.body ?? ""))).toBe(true);
  });

  it("records deal-text consent only when ticked with a phone, and never clears it", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", clientPhone: "404-555-0101",
      startTime: start, durationHours: 1, dealsOptIn: true,
    });
    let a = await t.run(async (ctx) => (await ctx.db.query("artists").collect())[0]);
    expect(a.dealsOptInSource).toBe("booking_form");
    expect(a.dealsConsentVersion).toBeTruthy();
    const firstAt = a.dealsOptInAt;
    expect(firstAt).toBeGreaterThan(0);

    await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com", clientPhone: "404-555-0101",
      startTime: start + 3 * HOUR, durationHours: 1,
    });
    a = await t.run(async (ctx) => (await ctx.db.query("artists").collect())[0]);
    expect(a.dealsOptInAt).toBe(firstAt);

    await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Ray", clientEmail: "ray@x.com", startTime: start + 6 * HOUR, durationHours: 1, dealsOptIn: true,
    });
    const ray = await t.run(async (ctx) => (await ctx.db.query("artists").collect()).find((x) => x.name === "Ray"));
    expect(ray?.dealsOptInAt).toBeUndefined();
  });
});

describe("DEALS keyword and the Google review line", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active",
        googleReviewUrl: "https://g.page/r/skyline/review",
      });
    });
  });

  it("DEALS opts the client in and confirms with STOP wording", async () => {
    await t.run((ctx) => ctx.db.insert("artists", artistRow(ORG, "Nova", "404-555-0134")));
    await t.mutation(internal.sms._handleInbound, { from: "+14045550134", body: "Deals" });
    const a = await t.run(async (ctx) => (await ctx.db.query("artists").collect())[0]);
    expect(a.dealsOptInSource).toBe("sms_keyword");
    const sends = await scheduledSends(t);
    expect(sends.some((s) => /deals list/.test(s.body ?? "") && /Reply STOP/.test(s.body ?? ""))).toBe(true);
  });

  it("DEALS does nothing for a number that sent STOP", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", artistRow(ORG, "Nova", "404-555-0135"));
      await ctx.db.insert("smsOptOuts", { phone: "+14045550135", optedOut: true, updatedAt: Date.now() });
    });
    await t.mutation(internal.sms._handleInbound, { from: "+14045550135", body: "DEALS" });
    const a = await t.run(async (ctx) => (await ctx.db.query("artists").collect())[0]);
    expect(a.dealsOptInAt).toBeUndefined();
  });

  for (const rating of ["5", "2"]) {
    it(`a ${rating}-star reply gets the Google link too (no review gating)`, async () => {
      await t.run(async (ctx) => {
        const artistId = await ctx.db.insert("artists", artistRow(ORG, "Nova", "404-555-0136"));
        await ctx.db.insert("smsPrompts", {
          orgId: ORG, phone: "+14045550136", kind: "review_rating", artistId,
          status: "open", sentAt: Date.now(), expiresAt: Date.now() + DAY,
        });
      });
      await t.mutation(internal.sms._handleInbound, { from: "+14045550136", body: rating });
      const sends = await scheduledSends(t);
      const toClient = sends.filter((s) => s.to === "+14045550136");
      expect(toClient.some((s) => (s.body ?? "").includes("https://g.page/r/skyline/review"))).toBe(true);
    });
  }
});

describe("Growth settings", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  beforeEach(async () => {
    t = convexTest(schema);
    room = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active" });
      return ctx.db.insert("rooms", { orgId: ORG, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000 });
    });
  });

  it("saves a Google link and refuses a non-Google one", async () => {
    await t.mutation(api.growth.set, { googleReviewUrl: "https://g.page/r/abc/review" });
    await expect(t.mutation(api.growth.set, { googleReviewUrl: "https://evil.com/review" })).rejects.toThrow();
    const g = await t.query(api.growth.get, {});
    expect(g.googleReviewUrl).toBe("https://g.page/r/abc/review");
  });

  it("flips off-peak and deal texts, and stores a room's windows", async () => {
    await t.mutation(api.growth.set, { offPeakEnabled: true, dealTexts: { enabled: true, mode: "auto" } });
    await t.mutation(api.growth.setRoomWindows, { roomId: room, windows: [{ days: [4, 1, 1], startHour: 9, endHour: 14, pct: 20 }] });
    const g = await t.query(api.growth.get, {});
    expect(g.offPeakEnabled).toBe(true);
    expect(g.dealTexts).toEqual({ enabled: true, mode: "auto", live: true });
    expect(g.rooms[0].offPeakWindows).toEqual([{ days: [1, 4], startHour: 9, endHour: 14, pct: 20 }]);
  });

  it("refuses a broken window", async () => {
    await expect(
      t.mutation(api.growth.setRoomWindows, { roomId: room, windows: [{ days: [1], startHour: 14, endHour: 9, pct: 20 }] }),
    ).rejects.toThrow();
  });
});

beforeEach(() => {
  vi.stubEnv("DEAL_TEXTS_LIVE", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fill-the-gap deal texts", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let nova: Id<"artists">;
  let ray: Id<"artists">;
  // 9:05am today, studio time.
  const [y, m, d] = localDayKey(Date.now(), TZ).split("-").map(Number);
  const nineAm = localMidnight(y, m, d, TZ) + 9 * HOUR + 5 * 60_000;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active", timezone: TZ,
        dealTexts: { enabled: true, mode: "approve" },
      });
      const room = await ctx.db.insert("rooms", { orgId: ORG, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000 });
      const nova = await ctx.db.insert("artists", artistRow(ORG, "Nova", "404-555-0201", { dealsOptInAt: 1 }));
      const ray = await ctx.db.insert("artists", artistRow(ORG, "Ray", "404-555-0202", { dealsOptInAt: 1 }));
      await ctx.db.insert("artists", artistRow(ORG, "Quiet", "404-555-0203")); // never opted in
      await ctx.db.insert("smsOptOuts", { phone: "+14045550202", optedOut: true, updatedAt: Date.now() });
      return { room, nova, ray };
    });
    room = ids.room;
    nova = ids.nova;
    ray = ids.ray;
  });
  afterEach(() => vi.useRealTimers());

  it("picks tomorrow's free block at 9am, for opted-in clients who did not STOP", async () => {
    const pick = await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm });
    expect(pick).not.toBeNull();
    expect(pick!.roomId).toBe(room);
    expect(pick!.artistIds).toEqual([nova]);
    expect(pick!.gapEnd - pick!.gapStart).toBe(13 * HOUR);
    expect(await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm + 2 * HOUR })).toBeNull();
  });

  it("does nothing until the platform switch is live", async () => {
    vi.stubEnv("DEAL_TEXTS_LIVE", "");
    expect(await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm })).toBeNull();
  });

  it("does nothing while deal texts are off", async () => {
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect())[0];
      await ctx.db.patch(org._id, { dealTexts: { enabled: false, mode: "approve" } });
    });
    expect(await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm })).toBeNull();
  });

  async function propose(auto: boolean) {
    const pick = (await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm }))!;
    return t.mutation(internal.gapDeals._propose, {
      orgId: ORG, roomId: pick.roomId, roomName: pick.roomName, gapStart: pick.gapStart, gapEnd: pick.gapEnd,
      dayKey: pick.dayKey, when: pick.when, body: pick.body, artistIds: [nova, ray], auto,
      verdict: { choice: "send", confidence: 0.8 },
    });
  }

  it("Approve each: the draft waits, once per room per day", async () => {
    const pick = (await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm }))!;
    const args = {
      orgId: ORG, roomId: pick.roomId, roomName: pick.roomName, gapStart: pick.gapStart, gapEnd: pick.gapEnd,
      dayKey: pick.dayKey, when: pick.when, body: pick.body, artistIds: pick.artistIds, auto: false,
    };
    const id = await t.mutation(internal.gapDeals._propose, args);
    const row = await t.run((ctx) => ctx.db.get(id!));
    expect(row?.status).toBe("proposed");
    expect(row?.type).toBe("gap_deal_text");
    expect(await t.mutation(internal.gapDeals._propose, args)).toBeNull();
    // The sweep will not offer the same room and day again either.
    expect(await t.query(internal.gapDeals._pick, { orgId: ORG, now: nineAm })).toBeNull();
  });

  it("approving sends inside the window, re-checking STOP, and stamps the cap", async () => {
    vi.setSystemTime(nineAm + 2 * HOUR); // 11am
    const id = (await propose(false))!;
    await t.mutation(api.opsActions.approve, { id, editedBody: "Room A is open tomorrow afternoon." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.status).toBe("executed");
    expect(row?.result).toBe("Deal text sent to 1 client");
    const [n, r] = await t.run(async (ctx) => [await ctx.db.get(nova), await ctx.db.get(ray)]);
    expect(n?.lastDealTextAt).toBeGreaterThan(0);
    expect(r?.lastDealTextAt).toBeUndefined();
    const thread = await t.run(async (ctx) =>
      (await ctx.db.query("clientMessages").collect()).filter((m) => m.artistId === nova),
    );
    expect(thread[0].body).toContain("Room A is open tomorrow afternoon.");
    expect(thread[0].body).toContain("Reply STOP");
    // Nova was never confirmed, so the confirmation went first.
    expect(n?.dealsConfirmSentAt).toBeGreaterThan(0);
  });

  it("approved after 7pm waits for 10am instead of texting at night", async () => {
    vi.setSystemTime(nineAm + 11 * HOUR); // 8:05pm
    const id = (await propose(false))!;
    await t.mutation(api.opsActions.approve, { id });
    // Run only what is due now: the 10am retry stays queued.
    await t.finishInProgressScheduledFunctions();
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.status).toBe("approved");
    const n = await t.run((ctx) => ctx.db.get(nova));
    expect(n?.lastDealTextAt).toBeUndefined();
  });

  it("does not text about time that got booked meanwhile", async () => {
    vi.setSystemTime(nineAm + 2 * HOUR);
    const id = (await propose(false))!;
    const row = (await t.run((ctx) => ctx.db.get(id)))!;
    if (row.payload.kind !== "sms_blast") throw new Error("wrong payload");
    const { gapStart } = row.payload;
    await t.run((ctx) =>
      ctx.db.insert("sessions", {
        orgId: ORG, roomId: room, title: "Lockout", artistId: nova, serviceType: "recording",
        startTime: gapStart + HOUR, endTime: gapStart + 12 * HOUR,
        status: "confirmed", rateCents: 0, depositCents: 0, depositPaid: true, intakeCompleted: true,
      }),
    );
    await t.mutation(api.opsActions.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.result).toBe("Not sent: the time got booked");
  });
});

describe("gap sweep without the agent", () => {
  it("puts the draft in the inbox when TypeSafe is not reachable", async () => {
    const t = convexTest(schema);
    const [y, m, d] = localDayKey(Date.now(), TZ).split("-").map(Number);
    vi.useFakeTimers();
    vi.setSystemTime(localMidnight(y, m, d, TZ) + 9 * HOUR + 60_000);
    try {
      await t.run(async (ctx) => {
        await ctx.db.insert("orgs", {
          orgId: "org1", name: "North", slug: "north", tier: "growth", status: "active", timezone: TZ,
          dealTexts: { enabled: true, mode: "auto" },
        });
        await ctx.db.insert("rooms", { orgId: "org1", name: "B", status: "available", bookable: true, hourlyRateCents: 8000 });
        await ctx.db.insert("artists", artistRow("org1", "Nova", "404-555-0301", { dealsOptInAt: 1 }));
      });
      await t.action(internal.gapDeals.sweep, {});
      const rows = await t.run((ctx) => ctx.db.query("opsActions").collect());
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("proposed"); // Auto mode, but no verdict: a person decides
      expect(rows[0].autonomy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
