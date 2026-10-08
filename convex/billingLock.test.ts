import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { DAY_MS } from "./lib/billingGate";
import { BETA_PLAN_NAME } from "./lib/plans";

/* The paywall is enforced by the server, not only by the overlay in the
   browser. A locked studio (card needed to start, trial lapsed without one,
   beta over, paid plan canceled, past due beyond the grace) is refused on
   every studio function except a short allowlist: its billing, its own
   profile, the session read and the CSV export. Agency operators acting as
   the studio, comped studios, the demo workspace and beta studios inside
   their term are never locked. */

const initT = () => convexTest(schema);
type TestT = ReturnType<typeof initT>;

async function seed(t: TestT, org: Record<string, unknown>, opts: { plan?: "paid" | "beta" } = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "org_ag", name: "AG", slug: "ag", plan: "max", status: "active",
      ownerClerkUserId: "u_agency", ownerEmail: "a@x",
    });
    await ctx.db.insert("agencyMembers", {
      agencyId: "org_ag", clerkUserId: "u_agency", email: "a@x", name: "A", role: "owner", status: "active", invitedAt: 0,
    });
    const planId = opts.plan === "beta"
      ? await ctx.db.insert("agencyPlans", {
          agencyId: "org_ag", name: BETA_PLAN_NAME, priceCents: 0, billingInterval: "month",
          trialDays: 365, requireCardAfterTrial: false, isBeta: true, isPromo: true, isDefault: true,
          active: true, createdAt: 0,
        })
      : await ctx.db.insert("agencyPlans", {
          agencyId: "org_ag", name: "Studio Monthly", priceCents: 9900, billingInterval: "month",
          trialDays: 14, requireCardAfterTrial: true, isPromo: false, isDefault: false,
          active: true, createdAt: 0,
        });
    await ctx.db.insert("orgs", {
      orgId: "org_s", name: "Studio S", slug: "s", tier: "growth", status: "active",
      agencyId: "org_ag", ownerEmail: "owner@s.com", agencyPlanId: planId,
      ...org,
    });
    await ctx.db.insert("members", {
      orgId: "org_s", name: "Sam", email: "owner@s.com", role: "owner", skills: [], clerkUserId: "u_s",
    });
    await ctx.db.insert("members", {
      orgId: "org_s", name: "Mo", email: "mo@s.com", role: "manager", skills: [], clerkUserId: "u_m",
    });
    return planId;
  });
}

const owner = (t: TestT) => t.withIdentity({ subject: "u_s", name: "Sam", email: "owner@s.com" });
const manager = (t: TestT) => t.withIdentity({ subject: "u_m", name: "Mo", email: "mo@s.com" });
const agency = (t: TestT) => t.withIdentity({ subject: "u_agency", name: "A", email: "a@x" });

const LOCKED = /BILLING_LOCKED|billing/i;

describe("server-side paywall", () => {
  let t: TestT;
  let savedGrace: string | undefined;
  beforeEach(() => {
    t = initT();
    savedGrace = process.env.PULSE_PAST_DUE_GRACE_DAYS;
    delete process.env.PULSE_PAST_DUE_GRACE_DAYS;
  });
  afterEach(() => {
    if (savedGrace === undefined) delete process.env.PULSE_PAST_DUE_GRACE_DAYS;
    else process.env.PULSE_PAST_DUE_GRACE_DAYS = savedGrace;
  });

  it("refuses studio queries and mutations while a paid trial waits on its card", async () => {
    await seed(t, { billingStatus: "pending_card" });
    await expect(owner(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
    await expect(owner(t).mutation(api.orgs.setManagersSeeMoney, { enabled: false })).rejects.toThrow(LOCKED);
    await expect(manager(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
  });

  it("refuses a trial that lapsed without a card and a canceled paid plan", async () => {
    await seed(t, { billingStatus: "trialing", trialEndsAt: Date.now() - DAY_MS });
    await expect(owner(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
    await t.run(async (ctx) => {
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { billingStatus: "canceled", billingSubscriptionId: "sub_gone" });
    });
    await expect(owner(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
  });

  it("refuses a beta cohort studio whose year is over", async () => {
    await seed(t, { billingStatus: "trialing", betaCohort: true, betaLicenseUntil: Date.now() - DAY_MS }, { plan: "beta" });
    await expect(owner(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
  });

  it("keeps the allowlist open: billing, profile, session and the CSV export", async () => {
    await seed(t, { billingStatus: "pending_card" });
    const billing = await owner(t).query(api.agencyBilling.myBilling, {});
    expect(billing?.locked).toBe(true);
    const r = await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect(r.simulated).toBe(true);
    expect((await owner(t).query(api.members.myProfile, {}))?.name).toBe("Sam");
    expect((await owner(t).query(api.session.current, {})).orgId).toBe("org_s");
    const csv = await owner(t).mutation(api.exports.clientsCsv, {});
    expect(csv.filename).toBe("pulse-clients.csv");
  });

  it("lets a studio waiting on its card finish the setup wizard, and nothing else", async () => {
    await seed(t, { billingStatus: "pending_card" });
    expect((await owner(t).query(api.onboarding.mine, {}))?.orgId).toBe("org_s");
    await owner(t).mutation(api.onboarding.saveBasics, { name: "Studio Sam", slug: "studio-sam" });
    await owner(t).mutation(api.orgs.update, { tagline: "Hi" });
    expect((await owner(t).query(api.clientEmail.emailStatus, {}))).toBeTruthy();
    await expect(owner(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
  });

  it("a lapsed studio cannot use the setup wizard as a way back in", async () => {
    await seed(t, { billingStatus: "trialing", trialEndsAt: Date.now() - DAY_MS });
    await expect(owner(t).query(api.onboarding.mine, {})).rejects.toThrow(LOCKED);
    await expect(
      owner(t).mutation(api.onboarding.saveBasics, { name: "Studio Sam", slug: "studio-sam" }),
    ).rejects.toThrow(LOCKED);
    await expect(owner(t).mutation(api.orgs.update, { tagline: "Hi" })).rejects.toThrow(LOCKED);
  });

  it("never locks an agency operator acting as the studio", async () => {
    await seed(t, { billingStatus: "pending_card" });
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyWorkspaceSelections", {
        agencyId: "org_ag", clerkUserId: "u_agency", orgId: "org_s", updatedAt: 0,
      });
    });
    const rows = await agency(t).query(api.members.list, {});
    expect(rows.length).toBe(2);
  });

  it("never locks comped, demo-mode, or in-term beta studios", async () => {
    await seed(t, { billingStatus: "comped" });
    expect((await owner(t).query(api.members.list, {})).length).toBe(2);

    const t2 = initT();
    await seed(t2, { billingStatus: "pending_card", demoMode: true });
    expect((await owner(t2).query(api.members.list, {})).length).toBe(2);

    const t3 = initT();
    await seed(t3, {
      billingStatus: "trialing", betaCohort: true,
      betaLicenseUntil: Date.now() + 30 * DAY_MS, trialEndsAt: Date.now() + 30 * DAY_MS,
    }, { plan: "beta" });
    expect((await owner(t3).query(api.members.list, {})).length).toBe(2);

    const t4 = initT();
    await seed(t4, { billingStatus: "trialing", betaCohort: true }, { plan: "beta" }); // granted, not started
    expect((await owner(t4).query(api.members.list, {})).length).toBe(2);
  });

  it("past due without a card locks only after the grace period", async () => {
    // Inside the default 3-day grace (the sweep flips to past_due at trial end).
    await seed(t, { billingStatus: "past_due", trialEndsAt: Date.now() - 2 * DAY_MS });
    expect((await owner(t).query(api.members.list, {})).length).toBe(2);
    // Past it.
    await t.run(async (ctx) => {
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { trialEndsAt: Date.now() - 4 * DAY_MS });
    });
    await expect(owner(t).query(api.members.list, {})).rejects.toThrow(LOCKED);
    // The grace is configurable.
    process.env.PULSE_PAST_DUE_GRACE_DAYS = "7";
    expect((await owner(t).query(api.members.list, {})).length).toBe(2);
  });

  it("past due with no known start date is not locked by the server", async () => {
    await seed(t, { billingStatus: "past_due" });
    expect((await owner(t).query(api.members.list, {})).length).toBe(2);
  });
});

describe("self-serve billing actions are the owner's", () => {
  let t: TestT;
  beforeEach(() => { t = initT(); });

  it("a manager cannot start a payment setup or open the billing portal", async () => {
    await seed(t, { billingStatus: "pending_card", billingCustomerId: "cus_s" });
    await expect(manager(t).action(api.agencyBilling.startMyPaymentSetup, {})).rejects.toThrow(/owner/i);
    await expect(manager(t).action(api.agencyBilling.openMyBillingPortal, {})).rejects.toThrow(/owner/i);
    await expect(
      manager(t).action(api.billing.beginBetaConversionCheckout, { tier: "growth" }),
    ).rejects.toThrow(/owner/i);
  });

  it("the owner still can", async () => {
    await seed(t, { billingStatus: "pending_card" });
    const r = await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect(r.simulated).toBe(true);
  });
});

describe("setup wizard uploads", () => {
  it("a studio waiting on its card can start its logo upload", async () => {
    const t = initT();
    await seed(t, { billingStatus: "pending_card" });
    const r = await owner(t)
      .mutation(api.media.prepareUpload, { purpose: "logo", fileName: "logo.png", mimeType: "image/png", size: 1000 })
      .catch((e: Error) => e);
    // Storage may not be configured in the test runtime; the lock must not be why it fails.
    if (r instanceof Error) expect(r.message).not.toMatch(LOCKED);
  });
});
