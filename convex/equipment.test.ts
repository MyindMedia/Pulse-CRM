import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const ORG = "pulse-demo";

describe("equipment.importBulk", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("inserts rows, maps a room name to its room, defaults the rest", async () => {
    const roomId = await t.run(async (ctx) =>
      ctx.db.insert("rooms", {
        orgId: ORG, name: "Studio A", status: "available", hourlyRateCents: 10000,
      }),
    );

    const res = await t.mutation(api.equipment.importBulk, {
      items: [
        { name: "Neumann U87", category: "mic", purchaseCents: 320000, currentValueCents: 240000, roomName: "studio a", status: "available" },
        { name: "SSL Desk", category: "console", purchaseCents: 4800000, currentValueCents: 3200000 },
      ],
    });
    expect(res).toEqual({ inserted: 2, skipped: 0 });

    const items = await t.run(async (ctx) => ctx.db.query("equipment").collect());
    expect(items).toHaveLength(2);
    const mic = items.find((i) => i.name === "Neumann U87");
    expect(mic?.installedInRoomId).toBe(roomId); // case-insensitive room match
    const desk = items.find((i) => i.name === "SSL Desk");
    expect(desk?.installedInRoomId).toBeUndefined(); // unknown/blank room -> storage
    expect(desk?.status).toBe("available");
  });

  it("skips serial-number duplicates when asked", async () => {
    await t.run(async (ctx) =>
      ctx.db.insert("equipment", {
        orgId: ORG, name: "Existing", category: "mic", status: "available",
        purchaseCents: 1000, currentValueCents: 1000, serialNumber: "SN-1",
      }),
    );

    const res = await t.mutation(api.equipment.importBulk, {
      items: [
        { name: "Dup", category: "mic", purchaseCents: 0, currentValueCents: 0, serialNumber: "sn-1" },
        { name: "New", category: "mic", purchaseCents: 0, currentValueCents: 0, serialNumber: "SN-2" },
        { name: "DupInBatch", category: "mic", purchaseCents: 0, currentValueCents: 0, serialNumber: "SN-2" },
      ],
      skipDuplicateSerials: true,
    });
    expect(res).toEqual({ inserted: 1, skipped: 2 });
  });

  it("keeps prices only from someone who may see money (an engineer granted inventory edit does not)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "growth", status: "active" });
      await ctx.db.insert("members", {
        orgId: ORG, name: "Eng Ellis", role: "engineer", clerkUserId: "u_eng",
        capabilityOverrides: ["+equipment.edit"], skills: [],
      });
      await ctx.db.insert("members", { orgId: ORG, name: "Mo Manager", role: "manager", clerkUserId: "u_mgr", skills: [] });
    });
    const row = (name: string) => ({ name, category: "mic" as const, purchaseCents: 320000, currentValueCents: 240000 });

    await t.withIdentity({ subject: "u_eng", orgId: ORG }).mutation(api.equipment.importBulk, { items: [row("From engineer")] });
    await t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.equipment.importBulk, { items: [row("From manager")] });

    const items = await t.run(async (ctx) => ctx.db.query("equipment").collect());
    expect(items.find((i) => i.name === "From engineer")).toMatchObject({ purchaseCents: 0, currentValueCents: 0 });
    expect(items.find((i) => i.name === "From manager")).toMatchObject({ purchaseCents: 320000, currentValueCents: 240000 });
  });

  it("logs a single summary activity row, not one per item", async () => {
    await t.mutation(api.equipment.importBulk, {
      items: [
        { name: "A", category: "other", purchaseCents: 0, currentValueCents: 0 },
        { name: "B", category: "other", purchaseCents: 0, currentValueCents: 0 },
      ],
    });
    const activity = await t.run(async (ctx) => ctx.db.query("activity").collect());
    const imports = activity.filter((a) => a.summary.includes("imported"));
    expect(imports).toHaveLength(1);
    expect(imports[0].summary).toContain("2 items");
  });
});
