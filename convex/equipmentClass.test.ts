import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

async function ownerOf(t: ReturnType<typeof convexTest>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, plan: "studio", status: "active" });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

describe("inventory gear/furniture cost separation", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("summary splits gear vs furniture; list filters by class", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    await o.mutation(api.equipment.create, { name: "Neumann U87", category: "mic", purchaseCents: 320000, currentValueCents: 300000 });
    await o.mutation(api.equipment.create, { name: "Studio Sofa", category: "furniture", purchaseCents: 50000, currentValueCents: 35000 });
    await o.mutation(api.equipment.create, { name: "Bass Traps", category: "acoustic", purchaseCents: 40000, currentValueCents: 40000 });
    await o.mutation(api.equipment.create, { name: "XLR Cables", category: "cable", purchaseCents: 10000, currentValueCents: 10000 });

    const s = await o.query(api.equipment.summary, {});
    expect(s.count).toBe(4);
    expect(s.gearCount).toBe(1);
    expect(s.gearCurrent).toBe(300000);
    expect(s.furnitureCount).toBe(3);
    expect(s.furnitureCurrent).toBe(35000 + 40000 + 10000);

    const gear = await o.query(api.equipment.list, { assetClass: "gear" });
    expect(gear.map((r) => r.name)).toEqual(["Neumann U87"]);
    const furn = await o.query(api.equipment.list, { assetClass: "furniture" });
    expect(furn.length).toBe(3);
  });
});
