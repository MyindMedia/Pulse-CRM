import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { MIN_COHORT } from "./benchmark";

/* A benchmark built from other people's businesses only works if it cannot be
   read backwards. These tests hold the suppression rule and the no-identifiers
   rule, which are the two ways this feature could do harm. */

const DAY = 86_400_000;
const OWNER = "u_own";

async function makeStudio(
  t: ReturnType<typeof convexTest>,
  i: number,
  opts: { rate?: number; region?: string; sessions?: number; noShows?: number } = {},
) {
  const orgId = `org${i}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name: `Studio ${i}`, slug: `studio-${i}`, plan: "studio",
      tier: "pro", status: "active", directoryRegion: opts.region ?? "GA",
      ownerEmail: `owner${i}@example.com`,
    });
    const room = await ctx.db.insert("rooms", {
      orgId, name: "A", roomType: "Live room",
      hourlyRateCents: opts.rate ?? 10_000, status: "available",
    });
    const artist = await ctx.db.insert("artists", {
      orgId, name: `Client ${i}`, type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const total = opts.sessions ?? 6;
    for (let n = 0; n < total; n++) {
      const start = Date.now() - (n + 1) * DAY;
      await ctx.db.insert("sessions", {
        orgId, title: `S${n}`, artistId: artist, roomId: room,
        serviceType: "recording", startTime: start, endTime: start + 4 * 3_600_000,
        status: n < (opts.noShows ?? 0) ? "no_show" : "completed",
        rateCents: 40_000, depositCents: 0, depositPaid: true,
        amountPaidCents: 40_000, intakeCompleted: true,
      });
    }
  });
  return orgId;
}

async function asOwnerOf(t: ReturnType<typeof convexTest>, orgId: string) {
  await t.run((ctx) =>
    ctx.db.insert("members", {
      orgId, name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    }),
  );
  return t.withIdentity({ subject: OWNER, orgId });
}

describe("suppression", () => {
  it("publishes nothing below the minimum cohort", async () => {
    const t = convexTest(schema);
    // Three studios, under the floor of five.
    for (let i = 1; i <= 3; i++) await makeStudio(t, i);
    const asOwner = await asOwnerOf(t, "org1");

    const r = await asOwner.query(api.benchmark.report, {});
    expect(r.contributingStudios).toBe(3);
    expect(r.publishable).toBe(false);
    expect(r.overall.suppressed).toBe(true);
    // Suppressed means null, not rounded and not estimated.
    expect(r.overall.medianHourlyCents).toBeNull();
    expect(r.overall.medianNoShowPct).toBeNull();
    expect(r.comparison).toBeNull();
  });

  it("publishes once enough studios contribute", async () => {
    const t = convexTest(schema);
    for (let i = 1; i <= MIN_COHORT; i++) await makeStudio(t, i, { rate: 10_000 + i * 1_000 });
    const asOwner = await asOwnerOf(t, "org1");

    const r = await asOwner.query(api.benchmark.report, {});
    expect(r.publishable).toBe(true);
    expect(r.overall.suppressed).toBe(false);
    expect(r.overall.medianHourlyCents).toBe(13_000);
    expect(r.overall.p25HourlyCents).toBeLessThanOrEqual(r.overall.medianHourlyCents!);
    expect(r.overall.p75HourlyCents).toBeGreaterThanOrEqual(r.overall.medianHourlyCents!);
  });

  it("suppresses a thin region even when the overall set is publishable", async () => {
    const t = convexTest(schema);
    for (let i = 1; i <= MIN_COHORT; i++) await makeStudio(t, i, { region: "GA" });
    await makeStudio(t, 99, { region: "NY" });   // a region of one
    const asOwner = await asOwnerOf(t, "org1");

    const r = await asOwner.query(api.benchmark.report, {});
    const ny = r.byRegion.find((x) => x.label === "NY")!;
    expect(ny.studios).toBe(1);
    expect(ny.suppressed).toBe(true);
    expect(ny.medianHourlyCents).toBeNull();
  });

  it("leaves out studios too quiet to be representative", async () => {
    const t = convexTest(schema);
    for (let i = 1; i <= MIN_COHORT; i++) await makeStudio(t, i);
    await makeStudio(t, 50, { sessions: 1 });  // one session in the window
    const asOwner = await asOwnerOf(t, "org1");
    expect((await asOwner.query(api.benchmark.report, {})).contributingStudios).toBe(MIN_COHORT);
  });
});

describe("what it never returns", () => {
  it("carries no studio identifier, name or contact anywhere in the payload", async () => {
    const t = convexTest(schema);
    for (let i = 1; i <= MIN_COHORT; i++) await makeStudio(t, i);
    const asOwner = await asOwnerOf(t, "org1");

    const r = await asOwner.query(api.benchmark.report, {});
    const json = JSON.stringify(r);
    expect(json).not.toContain("owner2@example.com");
    expect(json).not.toContain("Studio 2");
    expect(json).not.toContain("studio-2");
    expect(json).not.toContain("org2");
    expect(json).not.toContain("Client 1");
  });

  it("reports medians rather than totals, which cannot be read backwards", async () => {
    const t = convexTest(schema);
    for (let i = 1; i <= MIN_COHORT; i++) await makeStudio(t, i);
    const asOwner = await asOwnerOf(t, "org1");
    const r = await asOwner.query(api.benchmark.report, {});
    const json = JSON.stringify(r.overall);
    expect(json).toContain("median");
    expect(json).not.toContain("total");
    expect(json).not.toContain("sum");
  });
});

describe("your own numbers", () => {
  it("puts the caller beside the market", async () => {
    const t = convexTest(schema);
    // A market at $100/hr, and a caller charging $200.
    for (let i = 1; i <= MIN_COHORT; i++) await makeStudio(t, i, { rate: 10_000 });
    await makeStudio(t, 90, { rate: 20_000, noShows: 2, sessions: 10 });
    const asOwner = await asOwnerOf(t, "org90");

    const r = await asOwner.query(api.benchmark.report, {});
    expect(r.you.medianHourlyCents).toBe(20_000);
    expect(r.you.sessions).toBe(10);
    expect(r.comparison).not.toBeNull();
    expect(r.comparison!.rateDeltaPct).toBeGreaterThan(0);
    expect(r.you.noShowPct).toBe(20);
  });

  it("is gated behind Reports", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "lite", name: "Lite", slug: "lite", plan: "solo", tier: "studio",
      });
      await ctx.db.insert("members", {
        orgId: "lite", name: "O", role: "owner", skills: [], clerkUserId: "u_lite",
      });
    });
    const asOwner = t.withIdentity({ subject: "u_lite", orgId: "lite" });
    await expect(asOwner.query(api.benchmark.report, {})).rejects.toMatchObject({
      data: { code: "UPGRADE_REQUIRED", capability: "reports" },
    });
  });
});
