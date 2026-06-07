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

  it("quantity multiplies value in the summary", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    await o.mutation(api.equipment.create, { name: "XLR Cable", category: "cable", quantity: 6, purchaseCents: 1200, currentValueCents: 1000 });
    const s = await o.query(api.equipment.summary, {});
    expect(s.count).toBe(1);
    expect(s.units).toBe(6);
    expect(s.currentTotal).toBe(6000); // 1000 * 6
    expect(s.furnitureCurrent).toBe(6000);
  });

  it("assigning to a room flips status to in use; storage restores available", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    const roomId = await o.mutation(api.rooms.create, { name: "Studio A" });
    const eqId = await o.mutation(api.equipment.create, { name: "SSL Console", category: "console", purchaseCents: 100000, currentValueCents: 100000 });
    await o.mutation(api.equipment.install, { id: eqId, roomId });
    let rows = await o.query(api.equipment.list, {});
    expect(rows[0].effectiveStatus).toBe("in_use");
    expect(rows[0].status).toBe("in_use");
    await o.mutation(api.equipment.moveToStorage, { id: eqId });
    rows = await o.query(api.equipment.list, {});
    expect(rows[0].effectiveStatus).toBe("available");
    expect(rows[0].status).toBe("available");
  });

  it("bulk assign / update / remove operate only on own items", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    const room = await o.mutation(api.rooms.create, { name: "Live Room" });
    const a = await o.mutation(api.equipment.create, { name: "Mic A", category: "mic", purchaseCents: 10000, currentValueCents: 10000 });
    const b = await o.mutation(api.equipment.create, { name: "Mic B", category: "mic", purchaseCents: 10000, currentValueCents: 10000 });

    // bulk assign to room => both in use + installed
    await o.mutation(api.equipment.bulkAssign, { ids: [a, b], roomId: room });
    let rows = await o.query(api.equipment.list, {});
    expect(rows.every((r) => r.effectiveStatus === "in_use")).toBe(true);

    // bulk update category
    await o.mutation(api.equipment.bulkUpdate, { ids: [a, b], category: "instrument" });
    rows = await o.query(api.equipment.list, {});
    expect(rows.every((r) => r.category === "instrument")).toBe(true);

    // tenant isolation: another org cannot touch them
    const b2 = await ownerOf(t, "org_b", "u_b");
    const res = await b2.mutation(api.equipment.bulkRemove, { ids: [a, b] });
    expect(res.removed).toBe(0);
    expect(await o.query(api.equipment.list, {})).toHaveLength(2);

    // owner bulk remove
    const rm = await o.mutation(api.equipment.bulkRemove, { ids: [a, b] });
    expect(rm.removed).toBe(2);
    expect(await o.query(api.equipment.list, {})).toHaveLength(0);
  });
});
