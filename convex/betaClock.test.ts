import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { evaluateBillingGate } from "./lib/billingGate";

const initT = () => convexTest(schema);
const DAY = 86_400_000;

/* The beta year runs from the studio's first sign-in AFTER signing, not from
   the moment the agency granted it. A studio that took three weeks to read
   the agreement should still get twelve months. */

async function betaStudio(
  t: ReturnType<typeof initT>,
  opts: { signed?: boolean; started?: boolean } = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org_beta", name: "Beta Studio", slug: "beta", plan: "studio",
      status: "active", agencyId: "org_ag", betaCohort: true,
      ownerEmail: "owner@studio.com",
      ...(opts.started ? { betaLicenseUntil: Date.now() + 300 * DAY, betaStartedAt: Date.now() } : {}),
    });
    await ctx.db.insert("members", {
      orgId: "org_beta", name: "Owner", email: "owner@studio.com",
      role: "owner", skills: [], clerkUserId: "u_owner",
    });
    await ctx.db.insert("betaInvites", {
      email: "owner@studio.com", code: "AAAA-BBBB-CCCC", status: "claimed",
      ndaVersion: "v1", viewCount: 0, claimedOrgId: "org_beta",
      createdAt: Date.now(),
      ...(opts.signed ? { signedAt: Date.now() - DAY } : {}),
    });
  });
  return t.withIdentity({ subject: "u_owner", name: "Owner" });
}

async function orgRow(t: ReturnType<typeof initT>) {
  return await t.run(async (ctx) =>
    await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_beta")).first(),
  );
}

describe("the beta clock starts at first sign-in after signing", () => {
  let t: ReturnType<typeof initT>;
  beforeEach(() => { t = initT(); });

  it("does not start for a studio that has not signed", async () => {
    const owner = await betaStudio(t, { signed: false });
    const r = await owner.mutation(api.betaClock.startIfNeeded, {});
    expect(r.started).toBe(false);
    expect(r.reason).toBe("not_signed");
    expect((await orgRow(t))?.betaLicenseUntil).toBeUndefined();
  });

  it("starts on the first call once they have signed", async () => {
    const owner = await betaStudio(t, { signed: true });
    const r = await owner.mutation(api.betaClock.startIfNeeded, {});
    expect(r.started).toBe(true);
    const org = await orgRow(t);
    expect(org?.betaStartedAt).toBeDefined();
    // ~12 months out, not "today".
    const days = Math.round(((org!.betaLicenseUntil! - org!.betaStartedAt!) / DAY));
    expect(days).toBe(360);
  });

  it("is written exactly once, however many page loads happen", async () => {
    const owner = await betaStudio(t, { signed: true });
    await owner.mutation(api.betaClock.startIfNeeded, {});
    const first = (await orgRow(t))!.betaLicenseUntil;
    const second = await owner.mutation(api.betaClock.startIfNeeded, {});
    expect(second.started).toBe(false);
    expect(second.reason).toBe("already_running");
    expect((await orgRow(t))!.betaLicenseUntil).toBe(first);
  });

  it("leaves a graduated studio alone", async () => {
    const owner = await betaStudio(t, { signed: true });
    await t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_beta")).first();
      await ctx.db.patch(org!._id, { graduatedAt: Date.now() });
    });
    const r = await owner.mutation(api.betaClock.startIfNeeded, {});
    expect(r.started).toBe(false);
    expect(r.reason).toBe("graduated");
  });
});

describe("a granted-but-unstarted beta is not an expired one", () => {
  it("does not lock, and shows no countdown", () => {
    const gate = evaluateBillingGate(
      { betaCohort: true, billingStatus: "trialing", agencyPlanId: "p" as never },
      { requireCardAfterTrial: false, priceCents: 0 },
      1_800_000_000_000,
    );
    expect(gate.locked).toBe(false);
    expect(gate.reason).toBe("beta_pending");
    expect(gate.trialDaysLeft).toBeNull();
  });
});

describe("end-of-beta warnings", () => {
  let t: ReturnType<typeof initT>;
  beforeEach(() => { t = initT(); });

  async function withDaysLeft(days: number, sent: number[] = []) {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_beta", name: "Beta Studio", slug: "beta", plan: "studio",
        status: "active", betaCohort: true, ownerEmail: "owner@studio.com",
        betaLicenseUntil: Date.now() + days * DAY, betaWarningsSent: sent,
      });
    });
    return await t.run(async (ctx) =>
      await ctx.runQuery(internal.betaClock._dueForWarning, {}),
    );
  }

  it("warns at 30 days out", async () => {
    const due = await withDaysLeft(29);
    expect(due).toHaveLength(1);
    expect(due[0].mark).toBe(30);
  });

  it("says nothing at 90 days out", async () => {
    expect(await withDaysLeft(90)).toHaveLength(0);
  });

  it("does not repeat a warning it already sent", async () => {
    expect(await withDaysLeft(29, [30])).toHaveLength(0);
  });

  it("escalates to the 7-day warning after the 30-day one", async () => {
    const due = await withDaysLeft(6, [30]);
    expect(due).toHaveLength(1);
    expect(due[0].mark).toBe(7);
  });

  it("stops warning a studio that already subscribed", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_paid", name: "Paid", slug: "paid", plan: "studio",
        status: "active", betaCohort: true, ownerEmail: "p@x.com",
        billingStatus: "active", betaLicenseUntil: Date.now() + 3 * DAY,
      });
    });
    const due = await t.run(async (ctx) =>
      await ctx.runQuery(internal.betaClock._dueForWarning, {}),
    );
    expect(due).toHaveLength(0);
  });
});
