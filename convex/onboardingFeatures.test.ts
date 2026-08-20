import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* The last onboarding step is the only place most owners will ever be shown
   the patch bay, the phone clock-in or the receptionist. These tests hold the
   two rules that make it trustworthy: a switch writes real configuration, and
   a switch on a locked card cannot grant anything. */

const OWNER = "u_own";

async function studio(t: ReturnType<typeof convexTest>, tier: "studio" | "pro" | "label") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Vault", slug: "vault", plan: "solo", tier, status: "setup",
    });
    await ctx.db.insert("members", {
      orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
  });
  return t.withIdentity({ subject: OWNER, orgId: "org1" });
}

describe("what the step offers", () => {
  it("shows client reminders as already on, because the crons treat unset as on", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "pro");
    const setup = await as.query(api.onboarding.featureSetup, {});
    // A switch that shows off while reminders are actually sending would be a
    // lie about the studio's own behaviour.
    expect(setup.clientReminders).toBe(true);
  });

  it("marks what the plan does not include, rather than hiding it", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "studio");
    const setup = await as.query(api.onboarding.featureSetup, {});
    expect(setup.patch.owned).toBe(false);
    expect(setup.patch.tierLabel).toBe("Label");
    expect(setup.timeClock.owned).toBe(false);
    expect(setup.timeClock.tierLabel).toBe("Studio Pro");
  });
});

describe("the switches write real configuration", () => {
  it("switching the clock on also switches on the surface it lives in", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "pro");
    await as.mutation(api.onboarding.setFeaturePrefs, { timeClock: true });
    const setup = await as.query(api.onboarding.featureSetup, {});
    expect(setup.timeClock.enabled).toBe(true);
    // Enabling the clock without Schedule would leave it with nowhere to appear.
    expect(setup.schedule.enabled).toBe(true);
  });

  it("switching a module off lands in the list the access engine enforces", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "label");
    await as.mutation(api.onboarding.setFeaturePrefs, { patch: false });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.disabledFeatures).toContain("patch");
    expect((await as.query(api.onboarding.featureSetup, {})).patch.enabled).toBe(false);
  });

  it("client reminders write the field the cron actually reads", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "pro");
    await as.mutation(api.onboarding.setFeaturePrefs, { clientReminders: false });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.smsRemindersEnabled).toBe(false);
  });

  it("the receptionist needs its own opt-in, not just the module", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "pro");
    await as.mutation(api.onboarding.setFeaturePrefs, { receptionist: true });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    // It answers clients unprompted, so the explicit flag has to be set too.
    expect(org.aiReceptionistEnabled).toBe(true);
  });
});

describe("a locked switch cannot grant anything", () => {
  it("ignores a module the plan excludes", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "studio");
    await as.mutation(api.onboarding.setFeaturePrefs, { patch: true, timeClock: true });
    const setup = await as.query(api.onboarding.featureSetup, {});
    expect(setup.patch.enabled).toBe(false);
    expect(setup.timeClock.enabled).toBe(false);
  });

  it("does not set the receptionist flag on a plan without it", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "studio");
    await as.mutation(api.onboarding.setFeaturePrefs, { receptionist: true });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.aiReceptionistEnabled).toBeUndefined();
  });

  it("writes only real, toggleable keys, never a core module", async () => {
    const t = convexTest(schema);
    const as = await studio(t, "label");
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect())[0];
      await ctx.db.patch(org._id, { disabledFeatures: ["bookings", "junk", "patch"] });
    });
    await as.mutation(api.onboarding.setFeaturePrefs, { clientReminders: true });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.disabledFeatures).not.toContain("bookings");
    expect(org.disabledFeatures).not.toContain("junk");
    expect(org.disabledFeatures).toContain("patch");
  });
});
