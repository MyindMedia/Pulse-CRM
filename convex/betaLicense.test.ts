import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

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
  it("dates the licence a year out and shows an honest countdown", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    const res = await t.mutation(internal.betaLicense._grant, { orgId: ORG, tier: "pro" });
    expect(res.changed).toBe(true);

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.betaCohort).toBe(true);
    expect(org.tier).toBe("pro");
    expect(org.billingStatus).toBe("trialing");
    // Both the commitment and the countdown, so converting them later cannot
    // erase what they were promised.
    expect(org.betaLicenseUntil).toBe(org.trialEndsAt);
    const days = Math.round((org.betaLicenseUntil! - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThanOrEqual(365);
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

  it("issues no usable access code - they already have a login", async () => {
    const t = convexTest(schema);
    await existingStudio(t);
    await t.mutation(internal.betaLicense._grant, { orgId: ORG });
    const invite = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    // A real code would invite exactly the duplicate this path avoids.
    expect(invite.code.startsWith("CONVERTED-")).toBe(true);
    expect(invite.ndaVersion).toBe("converted");
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
