import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* Converting an EXISTING studio onto the beta programme.

   The rule this exists to protect: nothing is created. The owner already has
   a login, a slug and a booking page people have already been sent. A second
   workspace would be a choice they should never have to make. */

const ORG = "org_kamiza";

async function existingStudio(t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) {
  await t.run((ctx) =>
    ctx.db.insert("orgs", {
      orgId: ORG,
      name: "Kamiza Private Recording House",
      slug: "kamiza-private-recording-house",
      plan: "studio",
      tier: "studio",
      status: "active",
      billingStatus: "comped",
      ownerEmail: "dnment859@gmail.com",
      ownerName: "Steve White",
      agencyId: "ag1",
      ...over,
    } as never),
  );
}

describe("granting the licence", () => {
  it("badges the studio but does NOT start the year", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    const res = await t.mutation(internal.betaLicense._grant, { orgId: ORG, tier: "pro" });
    expect(res.changed).toBe(true);

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.betaCohort).toBe(true);
    expect(org.tier).toBe("pro");
    expect(org.billingStatus).toBe("trialing");

    /* The clock starts on their first sign-in after signing, not here.
       Dating it at grant time spent the licence on the days between the
       agency deciding to let them in and the owner reading the agreement -
       for a studio that took three weeks to reply, three weeks of a year
       they never had. */
    expect(org.betaLicenseUntil).toBeUndefined();
    expect(org.betaStartedAt).toBeUndefined();
    expect(res.until).toBeNull();
  });

  it("creates no second workspace", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    const orgs = await t.run((ctx) => ctx.db.query("orgs").collect());
    expect(orgs).toHaveLength(1);
    expect(orgs[0].slug).toBe("kamiza-private-recording-house");
  });

  it("is idempotent, so a second run cannot hand out another year", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    const first = await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    const again = await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    expect(again.changed).toBe(false);
    expect(again.until).toBe(first.until);
  });

  it("puts them in the beta queue as well as badging the workspace", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });

    const invites = await t.run((ctx) => ctx.db.query("betaInvites").collect());
    expect(invites).toHaveLength(1);
    // Without this they would carry the Beta badge on the sub-account list and
    // be missing from the cohort you actually manage.
    expect(invites[0]).toMatchObject({
      status: "claimed",
      claimedOrgId: ORG,
      claimedSlug: "kamiza-private-recording-house",
      email: "dnment859@gmail.com",
    });
    expect(invites[0].note).toContain("converted");
  });

  it("issues a real signing code, because they still owe the agreement", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    const invite = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    // Everyone on the beta signs, converted studios included - they are about
    // to be shown an unreleased roadmap like everybody else.
    expect(invite.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(invite.ndaVersion).not.toBe("converted");
    expect(invite.signedAt).toBeUndefined();
  });

  it("the code cannot produce a duplicate studio", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    const invite = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    // claimedOrgId is what makes the preview offer "go to my studio" rather
    // than "build one", so a real code is safe to hand out here.
    expect(invite.claimedOrgId).toBe(ORG);
    expect(invite.status).toBe("claimed");
  });

  it("signing does not walk a claimed studio backwards", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    const code = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0].code;

    const { NDA_TERMS_HASH } = await import("./lib/betaNda");
    await t.mutation(api.betaAccess.sign, {
      code, signedName: "Steve White", termsHash: NDA_TERMS_HASH,
    });

    const invite = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    // Still claimed - they have a real workspace - and now signed.
    expect(invite.status).toBe("claimed");
    expect(invite.signedAt).toBeTruthy();
    expect(invite.signedName).toBe("Steve White");

    // And the gate agrees: signed means signed, regardless of status.
    const check = await t.query(api.betaAccess.check, { code });
    expect(check.signed).toBe(true);
    expect(check.claimed).toBe(true);
  });

  it("reissues a placeholder code from an earlier conversion", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.run((ctx) =>
      ctx.db.insert("betaInvites", {
        agencyId: "ag1", email: "dnment859@gmail.com", company: "Kamiza",
        code: "CONVERTED-ABCD1234", status: "claimed", ndaVersion: "converted",
        viewCount: 0, claimedOrgId: ORG, claimedSlug: "kamiza", createdAt: Date.now(),
      } as never),
    );
    const res = await t.mutation(internal.betaLicense._ensureSigningCode, { orgId: ORG });
    expect(res.reissued).toBe(true);
    expect(res.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const invite = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    expect(invite.ndaVersion).not.toBe("converted");
  });

  it("does not queue them twice on a re-run", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    await t.mutation(internal.betaLicense._grant, { orgId: ORG, force: true });
    expect(await t.run((ctx) => ctx.db.query("betaInvites").collect())).toHaveLength(1);
  });

  it("finds the studio by owner email", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    const found = await t.query(internal.betaLicense._orgByEmail, {
      email: "  DNMENT859@Gmail.com ",
    });
    expect(found?.orgId).toBe(ORG);
  });

  it("refuses an org that does not exist rather than inventing one", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.betaLicense._grant, { orgId: "nope" }),
    ).rejects.toThrow();
  });
});

/* Every beta studio runs on Label and bills against the Beta plan. Pro was
   the old default, and a studio with no plan row at all reads as "no_plan" at
   the billing gate: no countdown, no end-of-beta warning, nothing to convert. */
describe("the cohort is Label on the Beta plan", () => {
  async function betaPlan(t: ReturnType<typeof convexTest>) {
    return await t.run((ctx) =>
      ctx.db.insert("agencyPlans", {
        agencyId: "ag1",
        name: "Beta - free for a year",
        description: "The beta programme.",
        priceCents: 0,
        billingInterval: "month",
        trialDays: 365,
        requireCardAfterTrial: false,
        isPromo: true,
        isDefault: true,
        active: true,
        createdAt: 0,
      } as never),
    );
  }

  it("grants Label and the Beta plan without being asked", async () => {
    const t = convexTest(schema);
    const planId = await betaPlan(t);
    await existingStudio(t);

    await t.mutation(internal.betaLicense._grant, { orgId: ORG });

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.tier).toBe("label");
    expect(org.agencyPlanId).toBe(planId);
    expect(org.billingStatus).toBe("trialing");
    // Still no clock: the year begins at their first sign-in after signing.
    expect(org.betaLicenseUntil).toBeUndefined();
  });

  it("still honours a tier the agency picked on purpose", async () => {
    const t = convexTest(schema);
    await betaPlan(t);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG, tier: "pro" });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.tier).toBe("pro");
  });

  it("normalizes studios granted before the rule, dates untouched", async () => {
    const t = convexTest(schema);
    const planId = await betaPlan(t);
    const started = 1_700_000_000_000;
    await existingStudio(t, {
      tier: "pro",
      betaCohort: true,
      betaStartedAt: started,
      betaLicenseUntil: started + 365 * 86_400_000,
      billingStatus: "comped",
    });

    const dry = await t.mutation(internal.betaLicense._normalizeCohort, {});
    expect(dry.applied).toBe(false);
    expect(dry.changes).toHaveLength(1);

    let org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.tier).toBe("pro"); // a dry run changes nothing

    await t.mutation(internal.betaLicense._normalizeCohort, { apply: true });
    org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.tier).toBe("label");
    expect(org.agencyPlanId).toBe(planId);
    expect(org.betaStartedAt).toBe(started);          // the year it already had
    expect(org.betaLicenseUntil).toBe(started + 365 * 86_400_000);

    // Idempotent: a second pass has nothing left to say.
    const again = await t.mutation(internal.betaLicense._normalizeCohort, {});
    expect(again.changes).toHaveLength(0);
  });

  it("leaves a graduated studio on the tier it is paying for", async () => {
    const t = convexTest(schema);
    await betaPlan(t);
    await existingStudio(t, {
      tier: "studio",
      betaCohort: true,
      graduatedAt: Date.now(),
      billingStatus: "active",
    });
    await t.mutation(internal.betaLicense._normalizeCohort, { apply: true });
    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.tier).toBe("studio");
  });
});
