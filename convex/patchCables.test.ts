import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo";

type T = ReturnType<typeof convexTest>;

async function seedSpace(t: T) {
  return await t.mutation(api.patchManager.createSpace, { name: "Control Room" });
}

/** A mic into a preamp: one XLR run needing one XLR cable. */
async function seedRun(t: T, spaceId: Id<"patchSpaces">, micName = "Shure SM57") {
  const mic = await t.run(async (ctx) =>
    ctx.db.insert("equipment", {
      orgId: ORG,
      name: micName,
      category: "mic" as const,
      status: "available" as const,
      purchaseCents: 9900,
      currentValueCents: 9900,
    }),
  );
  const pre = await t.run(async (ctx) =>
    ctx.db.insert("equipment", {
      orgId: ORG,
      name: "AMS Neve 1073SPX",
      category: "preamp" as const,
      status: "available" as const,
      purchaseCents: 249500,
      currentValueCents: 249500,
    }),
  );
  const micDeviceId = await t.mutation(api.patchManager.placeDevice, {
    patchSpaceId: spaceId,
    equipmentId: mic,
    position: { x: 0, y: 0 },
  });
  const preDeviceId = await t.mutation(api.patchManager.placeDevice, {
    patchSpaceId: spaceId,
    equipmentId: pre,
    position: { x: 200, y: 0 },
  });

  // Bind to the two devices this call created. Matching on category would
  // pick the first mic and the first preamp every time, so repeat calls
  // would all land on one input and silently replace each other.
  const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
  const micDevice = graph!.devices.find((d) => d._id === micDeviceId)!;
  const preDevice = graph!.devices.find((d) => d._id === preDeviceId)!;
  const from = micDevice.ports.find((p) => p.direction === "output")!;
  const to = preDevice.ports.find((p) => p.label === "Mic In")!;

  return await t.mutation(api.patchManager.connect, {
    fromPortId: from._id,
    toPortId: to._id,
  });
}

async function seedCable(
  t: T,
  overrides: Partial<{ name: string; quantity: number; lengthFt: number; connectorB: string }> = {},
) {
  return await t.mutation(api.patchCables.createStock, {
    name: overrides.name ?? "XLR 25ft",
    quantity: overrides.quantity ?? 6,
    purchaseCents: 2500,
    connectorA: "xlr",
    connectorB: (overrides.connectorB ?? "xlr") as "xlr",
    lengthFt: overrides.lengthFt ?? 25,
    color: "black",
  });
}

describe("cable stock", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("creates a real inventory row, not a parallel list", async () => {
    const id = await seedCable(t);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.category).toBe("cable");
    expect(row!.quantity).toBe(6);
    expect(row!.cableSpec?.connectorA).toBe("xlr");
    // It shows up in the ordinary equipment list like everything else owned.
    const inventory = await t.query(api.equipment.list, {});
    expect(inventory.some((i) => i._id === id)).toBe(true);
  });

  it("counts free versus in use as runs are patched", async () => {
    const spaceId = await seedSpace(t);
    const cableId = await seedCable(t, { quantity: 3 });

    let stock = await t.query(api.patchCables.stock, {});
    expect(stock[0]).toMatchObject({ quantity: 3, inUse: 0, free: 3 });

    const connectionId = await seedRun(t, spaceId);
    await t.mutation(api.patchManager.updateConnection, { id: connectionId, cableId });

    stock = await t.query(api.patchCables.stock, {});
    expect(stock[0]).toMatchObject({ inUse: 1, free: 2 });
  });

  it("describes an unspecified legacy row without hiding it", async () => {
    await t.run(async (ctx) =>
      ctx.db.insert("equipment", {
        orgId: ORG,
        name: "XLR Cable",
        category: "cable" as const,
        status: "available" as const,
        quantity: 12,
        purchaseCents: 1500,
        currentValueCents: 1500,
      }),
    );
    const stock = await t.query(api.patchCables.stock, {});
    expect(stock[0].specified).toBe(false);
    expect(stock[0].description).toBeNull();
    expect(stock[0].free).toBe(12);

    const summary = await t.query(api.patchCables.stockSummary, {});
    expect(summary.unspecified).toBe(1);
  });

  it("backfills a spec onto an existing row", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("equipment", {
        orgId: ORG,
        name: "XLR Cable",
        category: "cable" as const,
        status: "available" as const,
        quantity: 12,
        purchaseCents: 1500,
        currentValueCents: 1500,
      }),
    );
    await t.mutation(api.patchCables.setSpec, {
      id,
      connectorA: "xlr",
      connectorB: "xlr",
      lengthFt: 10,
    });
    const stock = await t.query(api.patchCables.stock, {});
    expect(stock[0].specified).toBe(true);
    expect(stock[0].description).toBe("XLR 10ft");
  });

  it("refuses a cable spec on gear that is not a cable", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("equipment", {
        orgId: ORG,
        name: "Shure SM57",
        category: "mic" as const,
        status: "available" as const,
        purchaseCents: 9900,
        currentValueCents: 9900,
      }),
    );
    await expect(
      t.mutation(api.patchCables.setSpec, { id, connectorA: "xlr", connectorB: "xlr" }),
    ).rejects.toThrow(/cable stock/);
  });

  it("refuses to hang a non-cable asset off a connection", async () => {
    const spaceId = await seedSpace(t);
    const connectionId = await seedRun(t, spaceId);
    const micId = await t.run(async (ctx) =>
      (await ctx.db.query("equipment").collect()).find((e) => e.category === "mic")!._id,
    );
    await expect(
      t.mutation(api.patchManager.updateConnection, { id: connectionId, cableId: micId }),
    ).rejects.toThrow(/not cable stock/);
  });
});

describe("run list", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("renders source to destination with the cable named", async () => {
    const spaceId = await seedSpace(t);
    const cableId = await seedCable(t);
    const connectionId = await seedRun(t, spaceId);
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableId,
      cableTag: "A-014",
    });

    const rows = await t.query(api.patchCables.runList, { patchSpaceId: spaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "Shure SM57",
      sourcePort: "Out",
      destination: "AMS Neve 1073SPX",
      destinationPort: "Mic In",
      cableName: "XLR 25ft",
      cableTag: "A-014",
      color: "black",
      lengthFt: 25,
      unassigned: false,
    });
  });

  it("flags a run with no cable assigned", async () => {
    const spaceId = await seedSpace(t);
    await seedRun(t, spaceId);
    const rows = await t.query(api.patchCables.runList, { patchSpaceId: spaceId });
    expect(rows[0].unassigned).toBe(true);
    expect(rows[0].cableName).toBeNull();
  });
});

describe("pull list and auto assign", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("reports what the patch needs against what is free", async () => {
    const spaceId = await seedSpace(t);
    await seedRun(t, spaceId);
    await seedCable(t, { quantity: 2 });

    const pull = await t.query(api.patchCables.pullList, { patchSpaceId: spaceId });
    expect(pull).toHaveLength(1);
    expect(pull[0]).toMatchObject({
      // The pull list describes the jacks that need joining, so it reports
      // the port connectors rather than whatever the stock happens to say.
      connectorA: "xlr3",
      connectorB: "xlr3",
      needed: 1,
      available: 2,
      short: 0,
    });
  });

  it("reports a shortfall rather than quietly covering half the job", async () => {
    const spaceId = await seedSpace(t);
    await seedRun(t, spaceId, "Shure SM57");
    await seedRun(t, spaceId, "Shure SM58");
    // Only one XLR in the locker for two runs.
    await seedCable(t, { quantity: 1 });

    const pull = await t.query(api.patchCables.pullList, { patchSpaceId: spaceId });
    expect(pull[0]).toMatchObject({ needed: 2, available: 1, short: 1 });

    const result = await t.mutation(api.patchCables.autoAssign, { patchSpaceId: spaceId });
    expect(result).toEqual({ assigned: 1, short: 1 });
  });

  it("reaches for the shortest cable that works", async () => {
    const spaceId = await seedSpace(t);
    await seedRun(t, spaceId);
    await seedCable(t, { name: "XLR 50ft", lengthFt: 50, quantity: 4 });
    const short = await seedCable(t, { name: "XLR 10ft", lengthFt: 10, quantity: 4 });

    await t.mutation(api.patchCables.autoAssign, { patchSpaceId: spaceId });
    const rows = await t.query(api.patchCables.runList, { patchSpaceId: spaceId });
    expect(rows[0].cableId).toBe(short);
  });

  it("never hands the same run out twice in one pass", async () => {
    const spaceId = await seedSpace(t);
    await seedRun(t, spaceId, "Shure SM57");
    await seedRun(t, spaceId, "Shure SM58");
    await seedRun(t, spaceId, "Shure Beta 52A");
    await seedCable(t, { quantity: 2 });

    const result = await t.mutation(api.patchCables.autoAssign, { patchSpaceId: spaceId });
    expect(result.assigned).toBe(2);

    const stock = await t.query(api.patchCables.stock, {});
    expect(stock[0].inUse).toBe(2);
    expect(stock[0].free).toBe(0);
    expect(stock[0].overCommitted).toBe(false);
  });

  it("suggests only stock whose ends match and that has a spare", async () => {
    const spaceId = await seedSpace(t);
    const connectionId = await seedRun(t, spaceId);
    await seedCable(t, { name: "XLR 25ft", quantity: 1 });
    await seedCable(t, { name: "TRS 10ft", connectorB: "trs", quantity: 5 });

    const suggestions = await t.query(api.patchCables.suggestFor, { connectionId });
    expect(suggestions.map((s) => s.name)).toEqual(["XLR 25ft"]);

    // Once that single cable is spoken for it stops being suggested.
    await t.mutation(api.patchCables.autoAssign, { patchSpaceId: spaceId });
    const another = await seedRun(t, spaceId, "Shure SM58");
    expect(await t.query(api.patchCables.suggestFor, { connectionId: another })).toEqual([]);
  });

  it("releases a cable without pulling the connection", async () => {
    const spaceId = await seedSpace(t);
    const connectionId = await seedRun(t, spaceId);
    await seedCable(t, { quantity: 2 });
    await t.mutation(api.patchCables.autoAssign, { patchSpaceId: spaceId });

    expect((await t.query(api.patchCables.stock, {}))[0].free).toBe(1);
    await t.mutation(api.patchCables.unassign, { connectionId });

    expect((await t.query(api.patchCables.stock, {}))[0].free).toBe(2);
    const rows = await t.query(api.patchCables.runList, { patchSpaceId: spaceId });
    // The patch is still documented, it just has no cable against it.
    expect(rows).toHaveLength(1);
    expect(rows[0].unassigned).toBe(true);
  });
});

describe("where a cable is being used", () => {
  it("names the space and both ends", async () => {
    const t = convexTest(schema);
    const spaceId = await seedSpace(t);
    const cableId = await seedCable(t, { quantity: 2 });
    await seedRun(t, spaceId);
    await t.mutation(api.patchCables.autoAssign, { patchSpaceId: spaceId });

    const used = await t.query(api.patchCables.whereUsed, { cableId });
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      patchSpaceName: "Control Room",
      source: "Shure SM57 Out",
      destination: "AMS Neve 1073SPX Mic In",
    });
  });
});

describe("stock cannot be over-committed", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("refuses to assign a cable that has no spare left", async () => {
    const spaceId = await seedSpace(t);
    const cableId = await seedCable(t, { quantity: 1 });

    const first = await seedRun(t, spaceId, "Shure SM57");
    const second = await seedRun(t, spaceId, "Shure SM58");

    await t.mutation(api.patchManager.updateConnection, { id: first, cableId });

    // The picker filters to free stock, but the guard has to live in the
    // mutation: two people looking at the same reactive list both see it free.
    await expect(
      t.mutation(api.patchManager.updateConnection, { id: second, cableId }),
    ).rejects.toThrow(/already patched/);

    const stock = await t.query(api.patchCables.stock, {});
    expect(stock[0]).toMatchObject({ inUse: 1, free: 0, overCommitted: false });
  });

  it("lets a run keep the cable it already holds", async () => {
    const spaceId = await seedSpace(t);
    const cableId = await seedCable(t, { quantity: 1 });
    const run = await seedRun(t, spaceId);

    await t.mutation(api.patchManager.updateConnection, { id: run, cableId });
    // Re-selecting the same cable must not read as a second draw on stock.
    await expect(
      t.mutation(api.patchManager.updateConnection, { id: run, cableId, cableTag: "A-001" }),
    ).resolves.toBeNull();
  });

  it("refuses to delete cable stock that is still patched", async () => {
    const spaceId = await seedSpace(t);
    const cableId = await seedCable(t, { quantity: 2 });
    const run = await seedRun(t, spaceId);
    await t.mutation(api.patchManager.updateConnection, { id: run, cableId });

    await expect(t.mutation(api.equipment.remove, { id: cableId })).rejects.toThrow(
      /cable run/,
    );

    // Release it and the delete goes through.
    await t.mutation(api.patchCables.unassign, { connectionId: run });
    await expect(t.mutation(api.equipment.remove, { id: cableId })).resolves.toBeNull();
  });
});


describe("connector validation", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("refuses a cable whose ends cannot seat in these jacks", async () => {
    const spaceId = await seedSpace(t);
    const run = await seedRun(t, spaceId);

    // A USB-C lead does not go into an XLR socket.
    const usbId = await t.mutation(api.patchCables.createStock, {
      name: "USB-C 1m",
      quantity: 4,
      purchaseCents: 900,
      connectorA: "usb_c",
      connectorB: "usb_c",
    });

    await expect(
      t.mutation(api.patchManager.updateConnection, { id: run, cableId: usbId }),
    ).rejects.toThrow(/does not fit/);
  });

  it("records a mismatched cable when told to, because adapters exist", async () => {
    const spaceId = await seedSpace(t);
    const run = await seedRun(t, spaceId);
    const usbId = await t.mutation(api.patchCables.createStock, {
      name: "USB-C 1m",
      quantity: 4,
      purchaseCents: 900,
      connectorA: "usb_c",
      connectorB: "usb_c",
    });

    await t.mutation(api.patchManager.updateConnection, {
      id: run,
      cableId: usbId,
      allowMismatch: true,
    });

    const edge = await t.run(async (ctx) => ctx.db.get(run));
    expect(edge!.cableFit).toBe("mismatch");
  });

  it("treats Thunderbolt and USB-C as mating", async () => {
    const spaceId = await seedSpace(t);
    const run = await seedRun(t, spaceId);

    // Point the run at two USB-C jacks, then offer a Thunderbolt lead.
    await t.run(async (ctx) => {
      const edge = (await ctx.db.get(run))!;
      await ctx.db.patch(edge.fromPortId, { connector: "usb_c", gender: "female" });
      await ctx.db.patch(edge.toPortId, { connector: "usb_c", gender: "female" });
    });

    const tbId = await t.mutation(api.patchCables.createStock, {
      name: "Thunderbolt 4 0.8m",
      quantity: 2,
      purchaseCents: 4900,
      connectorA: "thunderbolt",
      connectorB: "thunderbolt",
    });

    const options = await t.query(api.patchCables.suggestFor, { connectionId: run });
    expect(options.map((o) => o.name)).toContain("Thunderbolt 4 0.8m");

    await expect(
      t.mutation(api.patchManager.updateConnection, { id: run, cableId: tbId }),
    ).resolves.toBeNull();
  });

  it("refuses two male ends on the same pair", async () => {
    const spaceId = await seedSpace(t);
    const run = await seedRun(t, spaceId);

    // Both jacks male: a male-to-male cable cannot join them.
    await t.run(async (ctx) => {
      const edge = (await ctx.db.get(run))!;
      await ctx.db.patch(edge.fromPortId, { connector: "xlr3", gender: "male" });
      await ctx.db.patch(edge.toPortId, { connector: "xlr3", gender: "male" });
    });

    const maleId = await t.mutation(api.patchCables.createStock, {
      name: "XLR male to male 3ft",
      quantity: 1,
      purchaseCents: 1200,
      connectorA: "xlr3",
      connectorB: "xlr3",
      genderA: "male",
      genderB: "male",
    });

    await expect(
      t.mutation(api.patchManager.updateConnection, { id: run, cableId: maleId }),
    ).rejects.toThrow(/male/);
  });

  it("still matches a legacy cable recorded only as XLR", async () => {
    const spaceId = await seedSpace(t);
    const run = await seedRun(t, spaceId);
    await seedCable(t, { quantity: 2 });

    // seedCable writes connectorA/B as "xlr", from before the split.
    const options = await t.query(api.patchCables.suggestFor, { connectionId: run });
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].fit).toBe("vague");
  });
});
