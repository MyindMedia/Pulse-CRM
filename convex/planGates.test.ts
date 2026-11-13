import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* truth-plan-gates: the AI receptionist and visitor check-in follow the plan
   and the operator's module switch on the server, not only in the screens. */

const CORE = "org_core";
const GROWTH = "org_growth";

async function setup() {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: CORE, name: "Core", slug: "core-studio", tier: "core", status: "active" });
    await ctx.db.insert("orgs", { orgId: GROWTH, name: "Growth", slug: "growth-studio", tier: "growth", status: "active" });
    for (const [orgId, u] of [[CORE, "u_core"], [GROWTH, "u_growth"]] as const) {
      await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", skills: [], clerkUserId: u });
    }
    await ctx.db.insert("members", { orgId: GROWTH, name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" });
  });
  return {
    t,
    coreOwner: t.withIdentity({ subject: "u_core", orgId: CORE, name: "Core owner" }),
    growthOwner: t.withIdentity({ subject: "u_growth", orgId: GROWTH, name: "Growth owner" }),
    growthEng: t.withIdentity({ subject: "u_eng", orgId: GROWTH, name: "Eng" }),
  };
}
type T = Awaited<ReturnType<typeof setup>>["t"];

const patchOrg = (t: T, orgId: string, patch: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const o = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first())!;
    await ctx.db.patch(o._id, patch);
  });

const addClient = (t: T, orgId: string, phone: string) =>
  t.run((ctx) => ctx.db.insert("artists", { orgId, name: "Nova", type: "artist", phone, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" }));

/** Was the receptionist scheduled for this inbound text? */
async function receptionistScheduled(t: T) {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs.some((j) => j.name.includes("receptionist"));
}

async function inbound(t: T, from: string, body = "Hi, can I book a session this weekend?") {
  await t.mutation(internal.sms._handleInbound, { from, body });
  return receptionistScheduled(t);
}

const visitor = { name: "Guest", email: "guest@example.com" };

describe("plan gates: AI receptionist", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("U-01: a Core studio cannot switch the receptionist on", async () => {
    const { t, coreOwner } = await setup();
    await expect(coreOwner.mutation(api.orgs.setAiReceptionist, { enabled: true })).rejects.toThrow(/Growth|UPGRADE|unlocks/);
    const org = await t.run(async (ctx) => ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", CORE)).first());
    expect(org?.aiReceptionistEnabled).toBeUndefined();
    // Turning it off is always allowed.
    await coreOwner.mutation(api.orgs.setAiReceptionist, { enabled: false });
  });

  it("U-02: a Core studio with the flag already on gets no reply once its notice date passes", async () => {
    const { t } = await setup();
    await patchOrg(t, CORE, { aiReceptionistEnabled: true, planGraceUntil: Date.now() - 1000 });
    await addClient(t, CORE, "(404) 555-0101");
    expect(await inbound(t, "+14045550101")).toBe(false);
    const cx = await t.query(internal.receptionist._context, { orgId: CORE, from: "+14045550101" });
    expect(cx.enabled).toBe(false);
  });

  it("U-02b: during the notice period an existing Core user keeps it; a new Core studio never gets it", async () => {
    const { t } = await setup();
    await patchOrg(t, CORE, { aiReceptionistEnabled: true, planGraceUntil: Date.now() + 86_400_000 });
    await addClient(t, CORE, "(404) 555-0102");
    expect(await inbound(t, "+14045550102")).toBe(true);
    // Without a notice date the existing user is unchanged too (owner decision 2b).
    await patchOrg(t, CORE, { planGraceUntil: undefined });
    expect((await t.query(internal.receptionist._context, { orgId: CORE, from: "+14045550102" })).enabled).toBe(true);
  });

  it("U-03: the operator switching the module off stops the receptionist on Growth", async () => {
    const { t } = await setup();
    await patchOrg(t, GROWTH, { aiReceptionistEnabled: true, disabledFeatures: ["aiReceptionist"] });
    await addClient(t, GROWTH, "(404) 555-0103");
    expect(await inbound(t, "+14045550103")).toBe(false);
    expect((await t.query(internal.receptionist._context, { orgId: GROWTH, from: "+14045550103" })).enabled).toBe(false);
  });

  it("U-04: a Growth studio with it on still gets replies; per-thread AI-off still holds", async () => {
    const { t, growthOwner } = await setup();
    await growthOwner.mutation(api.orgs.setAiReceptionist, { enabled: true });
    const artistId = await addClient(t, GROWTH, "(404) 555-0104");
    expect(await inbound(t, "+14045550104")).toBe(true);
    expect((await t.query(internal.receptionist._context, { orgId: GROWTH, from: "+14045550104" })).enabled).toBe(true);

    const t2 = (await setup()).t;
    await patchOrg(t2, GROWTH, { aiReceptionistEnabled: true });
    const a2 = await addClient(t2, GROWTH, "(404) 555-0105");
    await t2.run(async (ctx) => { await ctx.db.insert("messageThreads", { orgId: GROWTH, artistId: a2, aiRepliesOff: true } as never); });
    expect(await inbound(t2, "+14045550105")).toBe(false);
    expect(artistId).toBeTruthy();
  });

  it("U-12: STOP still works on Core while the receptionist is gated, and the text is still logged", async () => {
    const { t } = await setup();
    await patchOrg(t, CORE, { aiReceptionistEnabled: true, planGraceUntil: Date.now() - 1 });
    const artistId = await addClient(t, CORE, "(404) 555-0106");
    await t.mutation(internal.sms._handleInbound, { from: "+14045550106", body: "What time is my session?" });
    const msgs = await t.run(async (ctx) => (await ctx.db.query("clientMessages").collect()).filter((m) => m.artistId === artistId));
    expect(msgs.map((m) => m.direction)).toEqual(["in"]);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550106", body: "STOP" });
    const opt = await t.run(async (ctx) => ctx.db.query("smsOptOuts").withIndex("by_phone", (q) => q.eq("phone", "+14045550106")).first());
    expect(opt?.optedOut).toBe(true);
    expect(await receptionistScheduled(t)).toBe(false);
  });
});

describe("plan gates: visitor check-in", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("U-06: public check-in is refused on Core and works on Growth", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.visitors.register, { slug: "core-studio", termsAccepted: true, ...visitor })).rejects.toThrow(/not available/);
    expect(await t.query(api.visitors.checkInAvailable, { slug: "core-studio" })).toBe(false);
    const res = await t.mutation(api.visitors.register, { slug: "growth-studio", termsAccepted: true, ...visitor });
    expect(res).toBeTruthy();
    expect(await t.query(api.visitors.checkInAvailable, { slug: "growth-studio" })).toBe(true);
    const rows = await t.run((ctx) => ctx.db.query("visitors").collect());
    expect(rows.map((r) => r.orgId)).toEqual([GROWTH]);
  });

  it("U-06b: an operator switch-off refuses check-in on Growth too", async () => {
    const { t, growthOwner } = await setup();
    await patchOrg(t, GROWTH, { disabledFeatures: ["visitors"] });
    await expect(t.mutation(api.visitors.register, { slug: "growth-studio", termsAccepted: true, ...visitor })).rejects.toThrow(/not available/);
    await expect(growthOwner.query(api.visitors.list, {})).rejects.toThrow();
  });

  it("U-06c: a Core studio that already had visits keeps check-in until its notice date passes", async () => {
    const { t, coreOwner } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("visitors", { orgId: CORE, name: "Old", email: "old@example.com", checkInAt: Date.now() - 1000, source: "qr" } as never); });
    expect(await t.query(api.visitors.checkInAvailable, { slug: "core-studio" })).toBe(true);
    await t.mutation(api.visitors.register, { slug: "core-studio", termsAccepted: true, ...visitor });
    expect((await coreOwner.query(api.visitors.list, {})).length).toBe(2);
    await patchOrg(t, CORE, { planGraceUntil: Date.now() - 1 });
    await expect(t.mutation(api.visitors.register, { slug: "core-studio", termsAccepted: true, ...visitor })).rejects.toThrow(/not available/);
    await expect(coreOwner.query(api.visitors.list, {})).rejects.toThrow(/Growth|unlocks/);
    await expect(coreOwner.query(api.visitors.directory, {})).rejects.toThrow();
    await expect(coreOwner.mutation(api.visitors.registerManual, visitor)).rejects.toThrow();
  });

  it("U-07: an unknown slug gives a plain error", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.visitors.register, { slug: "nope", termsAccepted: true, ...visitor })).rejects.toThrow(/isn't active/);
    expect(await t.query(api.visitors.checkInAvailable, { slug: "nope" })).toBe(false);
  });

  it("staff screens on Core are refused; on Growth they work", async () => {
    const { coreOwner, growthOwner } = await setup();
    await expect(coreOwner.query(api.visitors.list, {})).rejects.toThrow();
    await expect(coreOwner.mutation(api.visitors.registerManual, visitor)).rejects.toThrow();
    await growthOwner.mutation(api.visitors.registerManual, visitor);
    expect((await growthOwner.query(api.visitors.list, {})).length).toBe(1);
    expect((await growthOwner.query(api.visitors.directory, {})).length).toBe(1);
  });

  it("U-09: a signed-out caller cannot list visitors", async () => {
    const { t, growthOwner } = await setup();
    await growthOwner.mutation(api.visitors.registerManual, visitor);
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example.test");
    vi.stubEnv("PULSE_DEMO_MODE", "");
    await expect(t.query(api.visitors.list, {})).rejects.toThrow();
    await expect(t.query(api.visitors.directory, {})).rejects.toThrow();
  });

  it("U-10: a member of studio A cannot read or check out studio B's visitors", async () => {
    const { t, growthOwner } = await setup();
    await patchOrg(t, CORE, { tier: "growth" });
    const coreNowGrowth = t.withIdentity({ subject: "u_core", orgId: CORE, name: "Core owner" });
    await growthOwner.mutation(api.visitors.registerManual, visitor);
    expect(await coreNowGrowth.query(api.visitors.list, {})).toEqual([]);
    expect(await coreNowGrowth.query(api.visitors.directory, {})).toEqual([]);
    const [row] = await t.run((ctx) => ctx.db.query("visitors").collect());
    await expect(coreNowGrowth.mutation(api.visitors.checkOut, { id: row._id as Id<"visitors"> })).rejects.toThrow(/Not found/);
  });
});

describe("plan gates: one-time notice functions", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports Core studios using a Growth feature, and the notice setter is a dry run unless told otherwise", async () => {
    const { t } = await setup();
    await patchOrg(t, CORE, { aiReceptionistEnabled: true });
    await patchOrg(t, GROWTH, { aiReceptionistEnabled: true });
    const r = await t.query(internal.planGates.reportPlanGateUsers, {});
    expect(r.isDone).toBe(true);
    expect(r.studios).toEqual([{ orgId: CORE, name: "Core", tier: "core", using: ["aiReceptionist"], planGraceUntil: null }]);

    const dry = await t.mutation(internal.planGates.setPlanGateGrace, { orgIds: [CORE] });
    expect(dry.dryRun).toBe(true);
    let org = await t.run(async (ctx) => ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", CORE)).first());
    expect(org?.planGraceUntil).toBeUndefined();

    const wet = await t.mutation(internal.planGates.setPlanGateGrace, { orgIds: [CORE], dryRun: false, days: 30 });
    expect(wet.dryRun).toBe(false);
    org = await t.run(async (ctx) => ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", CORE)).first());
    expect(org?.planGraceUntil).toBe(wet.until);
  });
});

describe("plan gates: exports (decision 1a, open on every plan)", () => {
  it("U-11: Core, Growth and a billing-locked studio can all export", async () => {
    const { t, coreOwner, growthOwner } = await setup();
    const all = [api.exports.clientsCsv, api.exports.songsCsv, api.exports.bookingsCsv, api.exports.invoicesCsv, api.exports.splitSheetsCsv, api.exports.activityCsv];
    for (const fn of all) {
      expect((await coreOwner.mutation(fn, {})).csv).toBeTypeOf("string");
      expect((await growthOwner.mutation(fn, {})).csv).toBeTypeOf("string");
    }
    // Billing-locked (a beta year that ended with no subscription): the
    // studio's other screens refuse, exports still work.
    await patchOrg(t, CORE, { billingStatus: "trialing", betaCohort: true, betaLicenseUntil: Date.now() - 86_400_000 });
    await expect(coreOwner.query(api.members.list, {})).rejects.toThrow(/BILLING_LOCKED|billing/i);
    for (const fn of all) expect((await coreOwner.mutation(fn, {})).csv).toBeTypeOf("string");
  });

  it("exports still need the role permission: an engineer cannot export clients", async () => {
    const { growthEng } = await setup();
    await expect(growthEng.mutation(api.exports.clientsCsv, {})).rejects.toThrow();
  });
});
