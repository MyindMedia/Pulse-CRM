import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { requireRoyalties, royaltiesAvailable } from "./lib/royaltiesGate";
import type { TierKey } from "./lib/pricing";

/* Royalties ship dark: tier (Max) AND the agency switch, both required. */

async function setup(t: ReturnType<typeof convexTest>, tier: TierKey, enabled?: boolean) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "ag", name: "Ag", slug: "ag", plan: "max", status: "active",
      ownerClerkUserId: "u_ag", ownerEmail: "o@x",
      ...(enabled === undefined ? {} : { royaltiesEnabled: enabled }),
    });
    await ctx.db.insert("agencyMembers", { agencyId: "ag", clerkUserId: "u_ag", email: "o@x", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
    await ctx.db.insert("orgs", { orgId: "o1", name: "S", slug: "s", tier, status: "active", agencyId: "ag" });
    await ctx.db.insert("members", { orgId: "o1", name: "Studio Owner", role: "owner", skills: [], clerkUserId: "u_studio" });
  });
}

async function gate(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    try {
      await requireRoyalties(ctx, "o1");
      return { ok: true, available: await royaltiesAvailable(ctx, "o1") };
    } catch (e) {
      return { ok: false, code: (e as { data?: { code?: string } }).data?.code, available: await royaltiesAvailable(ctx, "o1") };
    }
  });
}

describe("requireRoyalties: tier x agency switch", () => {
  const cases: [TierKey, boolean | undefined, string | true][] = [
    ["max", true, true],
    ["max", false, "ROYALTIES_OFF"],
    ["max", undefined, "ROYALTIES_OFF"], // absent means off
    ["growth", true, "UPGRADE_REQUIRED"],
    ["core", true, "UPGRADE_REQUIRED"],
    ["growth", false, "ROYALTIES_OFF"],
  ];
  for (const [tier, enabled, want] of cases) {
    it(`${tier} with switch ${String(enabled)} -> ${String(want)}`, async () => {
      const t = convexTest(schema);
      await setup(t, tier, enabled);
      const r = await gate(t);
      if (want === true) {
        expect(r).toEqual({ ok: true, available: true });
      } else {
        expect(r.ok).toBe(false);
        expect(r.code).toBe(want);
        expect(r.available).toBe(false);
      }
    });
  }
});

describe("agency Royalties switch", () => {
  it("an agency owner turns it on and off; summary reports it", async () => {
    const t = convexTest(schema);
    await setup(t, "max");
    const agency = t.withIdentity({ subject: "u_ag", name: "Owner" });
    expect((await agency.query(api.agencySettings.summary, {}))?.royaltiesEnabled).toBe(false);
    await agency.mutation(api.agencySettings.setRoyaltiesEnabled, { enabled: true });
    expect((await agency.query(api.agencySettings.summary, {}))?.royaltiesEnabled).toBe(true);
    expect((await gate(t)).ok).toBe(true);
    await agency.mutation(api.agencySettings.setRoyaltiesEnabled, { enabled: false });
    expect((await gate(t)).code).toBe("ROYALTIES_OFF");
  });

  it("a studio owner cannot flip it", async () => {
    const t = convexTest(schema);
    await setup(t, "max");
    const studioOwner = t.withIdentity({ subject: "u_studio", name: "Studio Owner", orgId: "o1" });
    await expect(studioOwner.mutation(api.agencySettings.setRoyaltiesEnabled, { enabled: true })).rejects.toThrow();
    expect((await gate(t)).code).toBe("ROYALTIES_OFF");
  });
});
