import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Prepaid hour-block packages: product CRUD + authz, credit creation from a
   simulated purchase completion, redemption against a session (reduces the
   charge, decrements hours, no overdraw, no cross-org), and webhook
   idempotency (a repeat Stripe event never double-creates the credit). */

/** Seed an org + owner and return an identity-bound client for it. */
async function ownerOf(t: ReturnType<typeof convexTest>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, plan: "studio", status: "active" });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

/** Seed an engineer member (has sessions.* but NOT the finance caps). */
async function engineerOf(t: ReturnType<typeof convexTest>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { orgId, name: "Eng", role: "engineer", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Eng", orgId });
}

async function seedArtist(t: ReturnType<typeof convexTest>, orgId: string, name: string) {
  return t.run(async (ctx) =>
    ctx.db.insert("artists", {
      orgId, name, type: "artist",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    }),
  );
}

async function seedSession(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  artistId: Id<"artists">,
  rateCents: number,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("sessions", {
      orgId, title: "Tracking", artistId, serviceType: "recording",
      startTime: Date.now() + 3_600_000, endTime: Date.now() + 7_200_000,
      status: "confirmed", rateCents, depositCents: 6000,
      depositPaid: false, intakeCompleted: false,
    }),
  );
}

describe("packages - product CRUD + authz", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("create -> list returns it, active by default", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    await owner.mutation(api.packages.create, { name: "10-hour block", hours: 10, priceCents: 85000 });
    const rows = await owner.query(api.packages.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("10-hour block");
    expect(rows[0].hours).toBe(10);
    expect(rows[0].active).toBe(true);
  });

  it("rejects empty name and non-positive hours/price", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    await expect(owner.mutation(api.packages.create, { name: "  ", hours: 10, priceCents: 5000 })).rejects.toThrow();
    await expect(owner.mutation(api.packages.create, { name: "X", hours: 0, priceCents: 5000 })).rejects.toThrow();
    await expect(owner.mutation(api.packages.create, { name: "X", hours: 5, priceCents: 0 })).rejects.toThrow();
  });

  it("update + remove; active:false hides from activeOnly + listActivePublic", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const id = await owner.mutation(api.packages.create, { name: "Block", hours: 5, priceCents: 40000 });
    await owner.mutation(api.packages.update, { id, priceCents: 45000, active: false });
    const all = await owner.query(api.packages.list, {});
    expect(all[0].priceCents).toBe(45000);
    expect(all[0].active).toBe(false);
    expect(await owner.query(api.packages.list, { activeOnly: true })).toHaveLength(0);
    // Public list hides the inactive product.
    expect(await owner.query(api.packages.listActivePublic, { slug: "org_a" })).toHaveLength(0);
    await owner.mutation(api.packages.remove, { id });
    expect(await owner.query(api.packages.list, {})).toHaveLength(0);
  });

  it("non-finance role cannot create/list (finance-gated)", async () => {
    await ownerOf(t, "org_a", "u_a");
    const eng = await engineerOf(t, "org_a", "u_e");
    await expect(eng.mutation(api.packages.create, { name: "X", hours: 5, priceCents: 5000 })).rejects.toThrow();
    await expect(eng.query(api.packages.list, {})).rejects.toThrow();
  });

  it("tenant isolation: org B cannot see/mutate org A's package", async () => {
    const a = await ownerOf(t, "org_a", "u_a");
    const b = await ownerOf(t, "org_b", "u_b");
    const idA = await a.mutation(api.packages.create, { name: "A block", hours: 5, priceCents: 5000 });
    expect(await b.query(api.packages.list, {})).toHaveLength(0);
    await expect(b.mutation(api.packages.update, { id: idA, priceCents: 1 })).rejects.toThrow();
    await expect(b.mutation(api.packages.remove, { id: idA })).rejects.toThrow();
  });
});

describe("packages - credit creation from purchase", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("_applyPurchase creates an active credit sized to the product", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const productId = await owner.mutation(api.packages.create, { name: "10h", hours: 10, priceCents: 85000 });
    const artistId = await seedArtist(t, "org_a", "Nova");
    await t.mutation(internal.packages._applyPurchase, {
      orgId: "org_a", productId, artistId, stripeReference: "pi_1",
    });
    const credits = await owner.query(api.packages.creditsForArtist, { artistId });
    expect(credits).toHaveLength(1);
    expect(credits[0].hoursTotal).toBe(10);
    expect(credits[0].hoursRemaining).toBe(10);
    expect(credits[0].perHourCents).toBe(8500);
  });

  it("webhook checkout.session.completed (kind=package) creates the credit once", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const productId = await owner.mutation(api.packages.create, { name: "5h", hours: 5, priceCents: 50000 });
    const artistId = await seedArtist(t, "org_a", "Nova");
    const event = {
      id: "evt_pkg1", type: "checkout.session.completed" as const,
      data: { object: { metadata: { kind: "package", productId, artistId, orgId: "org_a" }, payment_intent: "pi_x" } },
    };
    await t.mutation(internal.billingWebhooks.handle, { event });
    // Repeat the SAME event: idempotency guard must prevent a second credit.
    await t.mutation(internal.billingWebhooks.handle, { event });
    const credits = await owner.query(api.packages.soldCredits, {});
    expect(credits).toHaveLength(1);
    expect(credits[0].hoursTotal).toBe(5);
    expect(credits[0].artistName).toBe("Nova");
  });
});

describe("packages - redeem against a session", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("reduces the session charge + decrements hours", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const productId = await owner.mutation(api.packages.create, { name: "10h", hours: 10, priceCents: 100000 });
    const artistId = await seedArtist(t, "org_a", "Nova");
    await t.mutation(internal.packages._applyPurchase, { orgId: "org_a", productId, artistId });
    const [credit] = await owner.query(api.packages.creditsForArtist, { artistId });
    const sessionId = await seedSession(t, "org_a", artistId, 30000);

    const res = await owner.mutation(api.packages.redeem, {
      sessionId, creditId: credit._id as Id<"packageCredits">, hours: 2,
    });
    expect(res.hoursApplied).toBe(2);
    expect(res.valueCents).toBe(20000); // 2h * $100/hr
    expect(res.rateCents).toBe(10000); // 30000 - 20000
    expect(res.hoursRemaining).toBe(8);

    const session = await t.run(async (ctx) => ctx.db.get(sessionId)) as { rateCents: number };
    expect(session.rateCents).toBe(10000);
  });

  it("cannot overdraw: applies only remaining hours, marks depleted, never negative rate", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const productId = await owner.mutation(api.packages.create, { name: "2h", hours: 2, priceCents: 20000 });
    const artistId = await seedArtist(t, "org_a", "Nova");
    await t.mutation(internal.packages._applyPurchase, { orgId: "org_a", productId, artistId });
    const [credit] = await owner.query(api.packages.creditsForArtist, { artistId });
    const sessionId = await seedSession(t, "org_a", artistId, 5000);

    // Ask for 10 hours against a 2-hour credit and a $50 session.
    const res = await owner.mutation(api.packages.redeem, {
      sessionId, creditId: credit._id as Id<"packageCredits">, hours: 10,
    });
    expect(res.hoursApplied).toBe(2); // capped at remaining
    expect(res.hoursRemaining).toBe(0);
    expect(res.rateCents).toBe(0); // floored at 0, not negative

    // Credit is now depleted and no longer offered.
    expect(await owner.query(api.packages.creditsForArtist, { artistId })).toHaveLength(0);
    // A second redeem attempt fails - no hours left.
    await expect(owner.mutation(api.packages.redeem, {
      sessionId, creditId: credit._id as Id<"packageCredits">, hours: 1,
    })).rejects.toThrow();
  });

  it("cannot redeem across orgs", async () => {
    const a = await ownerOf(t, "org_a", "u_a");
    const b = await ownerOf(t, "org_b", "u_b");
    const productA = await a.mutation(api.packages.create, { name: "A", hours: 5, priceCents: 50000 });
    const artistA = await seedArtist(t, "org_a", "NovaA");
    await t.mutation(internal.packages._applyPurchase, { orgId: "org_a", productId: productA, artistId: artistA });
    const [creditA] = await a.query(api.packages.creditsForArtist, { artistId: artistA });

    const artistB = await seedArtist(t, "org_b", "NovaB");
    const sessionB = await seedSession(t, "org_b", artistB, 30000);

    // Org B tries to redeem org A's credit against its own session.
    await expect(b.mutation(api.packages.redeem, {
      sessionId: sessionB, creditId: creditA._id as Id<"packageCredits">, hours: 1,
    })).rejects.toThrow();
  });

  it("cannot redeem a credit belonging to a different client", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const productId = await owner.mutation(api.packages.create, { name: "5h", hours: 5, priceCents: 50000 });
    const artist1 = await seedArtist(t, "org_a", "Nova");
    const artist2 = await seedArtist(t, "org_a", "Kilo");
    await t.mutation(internal.packages._applyPurchase, { orgId: "org_a", productId, artistId: artist1 });
    const [credit] = await owner.query(api.packages.creditsForArtist, { artistId: artist1 });
    const otherSession = await seedSession(t, "org_a", artist2, 30000);
    await expect(owner.mutation(api.packages.redeem, {
      sessionId: otherSession, creditId: credit._id as Id<"packageCredits">, hours: 1,
    })).rejects.toThrow();
  });
});
