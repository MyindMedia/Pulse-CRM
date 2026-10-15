/* Studio gear and a teammate's own gear: who may change which, what the
 * studio's figures count, and that personal gear is never rented out. */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

async function studio() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "pulse-demo", name: "Demo", slug: "demo", tier: "growth", status: "active",
    });
    const out: Record<string, Id<"members">> = {};
    for (const [name, role, subject] of [
      ["Olu", "owner", "user_owner"],
      ["Dre", "producer", "user_dre"],
      ["Kai", "producer", "user_kai"],
    ] as const) {
      out[subject] = await ctx.db.insert("members", {
        orgId: "pulse-demo", name, role, email: `${subject}@demo.com`, skills: [], clerkUserId: subject,
      });
    }
    return out;
  });
  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "user_owner", name: "Olu" }),
    dre: t.withIdentity({ subject: "user_dre", name: "Dre" }),
    kai: t.withIdentity({ subject: "user_kai", name: "Kai" }),
  };
}

const mic = { name: "U87", category: "mic" as const, purchaseCents: 300_000, currentValueCents: 250_000 };

describe("personal gear", () => {
  it("a producer adds gear as their own, without inventory rights", async () => {
    const { t, ids, dre } = await studio();
    const id = await dre.mutation(api.equipment.create, { ...mic, name: "Dre's laptop", category: "computer" });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.ownerMemberId).toBe(ids.user_dre);
  });

  it("a producer can't name someone else as the owner", async () => {
    const { t, ids, dre } = await studio();
    const id = await dre.mutation(api.equipment.create, { ...mic, ownerMemberId: ids.user_kai });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.ownerMemberId).toBe(ids.user_dre);
  });

  it("only the owner or a manager changes a piece", async () => {
    const { owner, dre, kai } = await studio();
    const studioMic = await owner.mutation(api.equipment.create, mic);
    const dresMic = await dre.mutation(api.equipment.create, { ...mic, name: "SM7B" });

    await expect(dre.mutation(api.equipment.update, { id: studioMic, name: "Mine now" })).rejects.toThrow(/manager/);
    await expect(kai.mutation(api.equipment.update, { id: dresMic, name: "Kai's" })).rejects.toThrow(/manager/);
    await expect(kai.mutation(api.equipment.remove, { id: dresMic })).rejects.toThrow(/manager/);

    await dre.mutation(api.equipment.update, { id: dresMic, condition: "Mint" });
    await owner.mutation(api.equipment.update, { id: dresMic, notes: "Lives in B" });
    await dre.mutation(api.equipment.remove, { id: dresMic });
  });

  it("only a manager moves a piece between the studio and a person", async () => {
    const { t, ids, owner, dre } = await studio();
    const dresMic = await dre.mutation(api.equipment.create, mic);
    await expect(
      dre.mutation(api.equipment.update, { id: dresMic, ownerMemberId: null }),
    ).rejects.toThrow(/Only a manager/);

    const studioMic = await owner.mutation(api.equipment.create, { ...mic, rentable: true, rentalPriceCents: 5000 });
    await owner.mutation(api.equipment.update, { id: studioMic, ownerMemberId: ids.user_kai });
    const handed = await t.run((ctx) => ctx.db.get(studioMic));
    expect(handed?.ownerMemberId).toBe(ids.user_kai);
    // Handing it to a person takes it off the rentals list.
    expect(handed?.rentable).toBe(false);

    await owner.mutation(api.equipment.update, { id: studioMic, ownerMemberId: null });
    expect((await t.run((ctx) => ctx.db.get(studioMic)))?.ownerMemberId).toBeUndefined();
  });

  it("is never rented out", async () => {
    const { ids, owner, dre } = await studio();
    await expect(
      owner.mutation(api.equipment.create, { ...mic, ownerMemberId: ids.user_dre, rentable: true }),
    ).rejects.toThrow(/can't be rented/);
    const dresMic = await dre.mutation(api.equipment.create, mic);
    await expect(owner.mutation(api.equipment.setRentable, { id: dresMic, rentable: true })).rejects.toThrow(/can't be rented/);
    await expect(owner.mutation(api.equipment.update, { id: dresMic, rentable: true })).rejects.toThrow(/can't be rented/);

    const board = await owner.query(api.equipment.rentableBoard, {});
    expect(board.candidates.map((c) => c._id)).not.toContain(dresMic);
  });

  it("stays out of the studio's value, and is counted beside it", async () => {
    const { ids, owner, dre } = await studio();
    await owner.mutation(api.equipment.create, mic);
    // A manager records the value: what gear is worth is money, and a
    // producer without money sight saves none.
    await owner.mutation(api.equipment.create, { ...mic, name: "SM7B", ownerMemberId: ids.user_dre });
    const summary = await owner.query(api.equipment.summary, {});
    expect(summary.count).toBe(1);
    expect(summary.currentTotal).toBe(250_000);
    expect(summary.personalCount).toBe(1);
    expect(summary.personalCurrent).toBe(250_000);
    expect((await dre.query(api.equipment.summary, {})).mineCount).toBe(1);
  });

  it("lists by owner, with the owner's name and who has it out", async () => {
    const { t, owner, dre } = await studio();
    await owner.mutation(api.equipment.create, mic);
    const dresMic = await dre.mutation(api.equipment.create, { ...mic, name: "SM7B" });
    await t.run(async (ctx) => {
      await ctx.db.insert("gearCheckouts", {
        orgId: "pulse-demo", equipmentId: dresMic, equipmentName: "SM7B", holderKind: "member",
        holderLabel: "Kai", outAt: Date.now(), outBy: "Olu",
      });
    });

    const mine = await dre.query(api.equipment.list, { owner: "mine" });
    expect(mine.map((r) => r.name)).toEqual(["SM7B"]);
    expect(mine[0].ownedByMe).toBe(true);
    expect(mine[0].checkedOutTo).toBe("Kai");

    const all = await owner.query(api.equipment.list, {});
    expect(all.find((r) => r.name === "SM7B")?.ownerName).toBe("Dre");
    expect(all.find((r) => r.name === "U87")?.ownerName).toBeNull();
    expect((await owner.query(api.equipment.list, { owner: "studio" })).map((r) => r.name)).toEqual(["U87"]);
    expect((await owner.query(api.equipment.list, { owner: "personal" })).map((r) => r.name)).toEqual(["SM7B"]);
  });

  it("reads 'Former teammate' when the owner has left", async () => {
    const { t, ids, owner, dre } = await studio();
    await dre.mutation(api.equipment.create, mic);
    await t.run((ctx) => ctx.db.delete(ids.user_dre));
    const all = await owner.query(api.equipment.list, {});
    expect(all[0].ownerName).toBe("Former teammate");
  });
});
