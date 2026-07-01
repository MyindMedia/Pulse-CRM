import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const newT = () => convexTest(schema);
type TestConvex = ReturnType<typeof newT>;

const HOUR = 3_600_000;

/* Seed a studio with an owner + a cancellation policy, returning handles. */
async function seedStudio(
  t: TestConvex,
  org: string,
  policy: { windowHours?: number; feePct?: number } = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: org,
      name: "Shield Studio",
      slug: `shield-${org}`,
      plan: "studio",
      status: "active",
      cancellationWindowHours: policy.windowHours,
      cancellationFeePct: policy.feePct,
    });
    await ctx.db.insert("members", {
      orgId: org,
      name: "Owner",
      role: "owner",
      skills: [],
      clerkUserId: "u_own",
    });
  });
  return t.withIdentity({ subject: "u_own", orgId: org });
}

async function makeArtist(
  t: TestConvex,
  org: string,
  over: Record<string, unknown> = {},
): Promise<Id<"artists">> {
  return t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId: org,
      name: "Client",
      type: "artist",
      email: "client@example.com",
      genres: [],
      tags: [],
      status: "active",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
      ...over,
    }),
  );
}

async function makeSession(
  t: TestConvex,
  org: string,
  artistId: Id<"artists">,
  over: Record<string, unknown> = {},
): Promise<Id<"sessions">> {
  return t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId: org,
      title: "Client - Studio A",
      artistId,
      serviceType: "recording",
      startTime: Date.now() + 2 * HOUR,
      endTime: Date.now() + 4 * HOUR,
      status: "confirmed",
      rateCents: 20_000,
      depositCents: 6_000,
      depositPaid: false,
      intakeCompleted: false,
      ...over,
    }),
  );
}

const recoveryFor = (t: TestConvex, org: string) =>
  t.run((ctx) =>
    ctx.db.query("recoveryEvents").withIndex("by_org", (q) => q.eq("orgId", org)).collect(),
  );
const invoicesFor = (t: TestConvex, org: string) =>
  t.run((ctx) =>
    ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", org)).collect(),
  );

describe("No-Show Shield", () => {
  it("computes the fee for a cancel INSIDE the window", async () => {
    const t = convexTest(schema);
    const org = "shield_in";
    const asOwner = await seedStudio(t, org, { windowHours: 24, feePct: 50 });
    const artistId = await makeArtist(t, org);
    const id = await makeSession(t, org, artistId); // start +2h (inside 24h)

    await asOwner.mutation(api.sessions.setStatus, { id, status: "cancelled" });

    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s!.cancellationFeeCents).toBe(10_000); // 50% of 20_000
    expect(s!.depositForfeited).toBe(false); // no deposit paid

    const inv = await invoicesFor(t, org);
    expect(inv).toHaveLength(1);
    expect(inv[0].amountCents).toBe(10_000);

    const rec = await recoveryFor(t, org);
    expect(rec).toHaveLength(1);
    expect(rec[0].kind).toBe("cancellation_fee");
    expect(rec[0].amountCents).toBe(10_000);
  });

  it("charges NO fee for a cancel OUTSIDE the window", async () => {
    const t = convexTest(schema);
    const org = "shield_out";
    const asOwner = await seedStudio(t, org, { windowHours: 24, feePct: 50 });
    const artistId = await makeArtist(t, org);
    // Start 48h out - well outside the 24h notice window.
    const id = await makeSession(t, org, artistId, { startTime: Date.now() + 48 * HOUR, endTime: Date.now() + 50 * HOUR });

    await asOwner.mutation(api.sessions.setStatus, { id, status: "cancelled" });

    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s!.cancellationFeeCents).toBeUndefined();
    expect(await invoicesFor(t, org)).toHaveLength(0);
    expect(await recoveryFor(t, org)).toHaveLength(0);
  });

  it("forfeits a paid deposit and invoices only the remainder, recording both", async () => {
    const t = convexTest(schema);
    const org = "shield_dep";
    const asOwner = await seedStudio(t, org, { windowHours: 24, feePct: 50 });
    const artistId = await makeArtist(t, org);
    const id = await makeSession(t, org, artistId, { depositPaid: true, depositCents: 6_000 });

    await asOwner.mutation(api.sessions.setStatus, { id, status: "cancelled" });

    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s!.cancellationFeeCents).toBe(10_000);
    expect(s!.depositForfeited).toBe(true);

    const rec = await recoveryFor(t, org);
    const byKind = Object.fromEntries(rec.map((r) => [r.kind, r.amountCents]));
    expect(byKind.deposit_forfeited).toBe(6_000);
    expect(byKind.cancellation_fee).toBe(4_000); // 10_000 fee - 6_000 deposit

    const inv = await invoicesFor(t, org);
    expect(inv).toHaveLength(1);
    expect(inv[0].amountCents).toBe(4_000);
  });

  it("a no-show assesses the fee EVEN outside the window and forfeits the deposit", async () => {
    const t = convexTest(schema);
    const org = "shield_noshow";
    const asOwner = await seedStudio(t, org, { windowHours: 2, feePct: 100 });
    const artistId = await makeArtist(t, org);
    // Start 10h out - outside the 2h window, but a no-show always charges.
    const id = await makeSession(t, org, artistId, {
      startTime: Date.now() + 10 * HOUR,
      endTime: Date.now() + 12 * HOUR,
      depositPaid: true,
      depositCents: 5_000,
    });

    await asOwner.mutation(api.sessions.setStatus, { id, status: "no_show" });

    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s!.cancellationFeeCents).toBe(20_000); // 100% of rate
    expect(s!.depositForfeited).toBe(true);

    const rec = await recoveryFor(t, org);
    const byKind = Object.fromEntries(rec.map((r) => [r.kind, r.amountCents]));
    expect(byKind.deposit_forfeited).toBe(5_000);
    expect(byKind.no_show_fee).toBe(15_000);
  });

  it("a no-show also proposes a waitlist fill for the freed slot", async () => {
    const t = convexTest(schema);
    const org = "shield_wait";
    const asOwner = await seedStudio(t, org, { windowHours: 24, feePct: 0 });
    const bookedArtist = await makeArtist(t, org, { email: "booked@example.com" });
    const waitArtist = await makeArtist(t, org, { name: "Waiter", email: "waiter@example.com" });
    // Future session so the freed slot is fillable.
    const id = await makeSession(t, org, bookedArtist, {
      startTime: Date.now() + 5 * HOUR,
      endTime: Date.now() + 7 * HOUR,
    });
    const entryId = await t.run((ctx) =>
      ctx.db.insert("waitlistEntries", {
        orgId: org,
        artistId: waitArtist,
        priority: "standard",
        status: "waiting",
        createdAt: Date.now(),
      }),
    );

    await asOwner.mutation(api.sessions.setStatus, { id, status: "no_show" });

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry!.status).toBe("notified"); // proposeWaitlistFill fired
  });

  it("is idempotent: re-setting the same status never double-bills or double-records", async () => {
    const t = convexTest(schema);
    const org = "shield_idem";
    const asOwner = await seedStudio(t, org, { windowHours: 24, feePct: 50 });
    const artistId = await makeArtist(t, org);
    const id = await makeSession(t, org, artistId, { depositPaid: true, depositCents: 6_000 });

    await asOwner.mutation(api.sessions.setStatus, { id, status: "cancelled" });
    await asOwner.mutation(api.sessions.setStatus, { id, status: "cancelled" });

    expect(await invoicesFor(t, org)).toHaveLength(1);
    expect(await recoveryFor(t, org)).toHaveLength(2); // one deposit_forfeited + one fee
  });

  it("policy setter is gated: owner can set, engineer cannot", async () => {
    const t = convexTest(schema);
    const org = "shield_authz";
    const asOwner = await seedStudio(t, org);
    await t.run((ctx) =>
      ctx.db.insert("members", {
        orgId: org,
        name: "Eng",
        role: "engineer",
        skills: [],
        clerkUserId: "u_eng",
      }),
    );
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });

    await expect(
      asEng.mutation(api.sessions.setCancellationPolicy, { cancellationWindowHours: 24, cancellationFeePct: 50 }),
    ).rejects.toThrow();

    await asOwner.mutation(api.sessions.setCancellationPolicy, {
      cancellationWindowHours: 24,
      cancellationFeePct: 50,
    });
    const policy = await asOwner.query(api.sessions.getCancellationPolicy, {});
    expect(policy.cancellationWindowHours).toBe(24);
    expect(policy.cancellationFeePct).toBe(50);
  });

  it("clamps out-of-range policy values", async () => {
    const t = convexTest(schema);
    const org = "shield_clamp";
    const asOwner = await seedStudio(t, org);
    await asOwner.mutation(api.sessions.setCancellationPolicy, {
      cancellationWindowHours: -5,
      cancellationFeePct: 150,
    });
    const policy = await asOwner.query(api.sessions.getCancellationPolicy, {});
    expect(policy.cancellationWindowHours).toBe(0);
    expect(policy.cancellationFeePct).toBe(100);
  });
});
