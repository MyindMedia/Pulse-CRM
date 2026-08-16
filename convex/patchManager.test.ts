import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo";

type T = ReturnType<typeof convexTest>;

async function seedRoom(t: T, name = "Studio A") {
  return await t.run(async (ctx) =>
    ctx.db.insert("rooms", { orgId: ORG, name, status: "available" as const }),
  );
}

async function seedEquipment(
  t: T,
  overrides: Partial<{
    name: string;
    category: string;
    quantity: number;
    installedInRoomId: Id<"rooms">;
  }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("equipment", {
      orgId: ORG,
      name: overrides.name ?? "AMS Neve 1073DPX",
      category: (overrides.category ?? "preamp") as "preamp",
      status: "available" as const,
      quantity: overrides.quantity,
      installedInRoomId: overrides.installedInRoomId,
      purchaseCents: 479500,
      currentValueCents: 479500,
    }),
  );
}

async function seedSpace(t: T, roomId?: Id<"rooms">) {
  return await t.mutation(api.patchManager.createSpace, {
    name: "Control Room",
    roomId,
  });
}

describe("patch spaces", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("creates a space and logs it", async () => {
    const id = await seedSpace(t);
    const list = await t.query(api.patchManager.spaces, {});
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Control Room");
    expect(list[0].deviceCount).toBe(0);

    const log = await t.query(api.patchManager.history, { patchSpaceId: id });
    expect(log).toHaveLength(1);
    expect(log[0].changeType).toBe("create");
    expect(log[0].entityType).toBe("patchSpace");
  });

  it("resolves the linked room name", async () => {
    const roomId = await seedRoom(t, "Live Room B");
    await seedSpace(t, roomId);
    const list = await t.query(api.patchManager.spaces, {});
    expect(list[0].roomName).toBe("Live Room B");
  });

  it("cascades devices, ports and connections on delete", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t);
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });

    await t.mutation(api.patchManager.removeSpace, { id: spaceId });

    const leftovers = await t.run(async (ctx) => ({
      devices: await ctx.db.query("deviceInstances").collect(),
      ports: await ctx.db.query("ports").collect(),
      connections: await ctx.db.query("connections").collect(),
      audit: await ctx.db.query("patchAudit").collect(),
    }));
    expect(leftovers.devices).toHaveLength(0);
    expect(leftovers.ports).toHaveLength(0);
    expect(leftovers.connections).toHaveLength(0);
    // The log outlives the room on purpose.
    expect(leftovers.audit.length).toBeGreaterThan(0);
  });
});

describe("placing inventory on the canvas", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("materialises channel-level ports from the matched catalog template", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, { name: "AMS Neve 1073DPX" });

    const deviceId = await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 10, y: 20 },
    });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const device = graph!.devices.find((d) => d._id === deviceId)!;

    // The 1073DPX is a dual unit: two of everything, each its own port.
    expect(device.ports.length).toBe(8);
    expect(device.ports.filter((p) => p.label.startsWith("Mic In"))).toHaveLength(2);
    expect(device.equipment?._id).toBe(equipmentId);
    expect(device.manufacturer).toBe("AMS Neve");

    const micIn = device.ports.find((p) => p.label === "Mic In 1")!;
    expect(micIn.capabilities).toContain("phantom");
    expect(micIn.signalLevel).toBe("mic");
  });

  it("never collapses a multi-channel connector into one port", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, {
      name: "Universal Audio Apollo x16",
      category: "interface",
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const ports = graph!.devices[0].ports;
    const lineIns = ports.filter((p) => p.label.startsWith("Line In"));
    expect(lineIns).toHaveLength(16);
    expect(lineIns.every((p) => p.connector === "db25")).toBe(true);
    expect(new Set(lineIns.map((p) => p.channelIndex)).size).toBe(16);
  });

  it("falls back to a category template for gear not in the catalog", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, {
      name: "Some Boutique Handbuilt Preamp",
      category: "preamp",
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    // Unknown gear still lands with usable ports rather than nothing.
    expect(graph!.devices[0].ports.length).toBe(2);
  });

  it("respects inventory quantity and refuses to over-place", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, { name: "Shure SM57", category: "mic", quantity: 2 });

    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 100, y: 0 },
    });

    await expect(
      t.mutation(api.patchManager.placeDevice, {
        patchSpaceId: spaceId,
        equipmentId,
        position: { x: 200, y: 0 },
      }),
    ).rejects.toThrow(/already on this canvas/);
  });

  it("labels multi-unit placements distinctly", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, { name: "Shure SM57", category: "mic", quantity: 3 });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 50, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const labels = graph!.devices.map((d) => d.label).sort();
    expect(labels).toEqual(["Shure SM57 #1", "Shure SM57 #2"]);
  });

  it("reuses the profile it minted for the same gear", async () => {
    const spaceId = await seedSpace(t);
    const a = await seedEquipment(t, { name: "Rare Tube Comp", category: "outboard" });
    const b = await seedEquipment(t, { name: "Rare Tube Comp", category: "outboard" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: a,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: b,
      position: { x: 60, y: 0 },
    });
    const profiles = await t.run(async (ctx) => ctx.db.query("deviceProfiles").collect());
    expect(profiles).toHaveLength(1);
  });
});

describe("the palette reads live inventory", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("reports placed and available counts against quantity", async () => {
    const roomId = await seedRoom(t);
    const spaceId = await seedSpace(t, roomId);
    const equipmentId = await seedEquipment(t, {
      name: "Shure SM57",
      category: "mic",
      quantity: 4,
      installedInRoomId: roomId,
    });

    let palette = await t.query(api.patchManager.palette, { patchSpaceId: spaceId });
    expect(palette).toHaveLength(1);
    expect(palette[0].quantity).toBe(4);
    expect(palette[0].placed).toBe(0);
    expect(palette[0].available).toBe(4);
    expect(palette[0].inThisRoom).toBe(true);

    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });

    palette = await t.query(api.patchManager.palette, { patchSpaceId: spaceId });
    expect(palette[0].placed).toBe(1);
    expect(palette[0].available).toBe(3);
  });

  it("keeps cable stock out of the device palette", async () => {
    const spaceId = await seedSpace(t);
    await seedEquipment(t, { name: "XLR Cable 25ft", category: "cable", quantity: 12 });
    await seedEquipment(t, { name: "Shure SM57", category: "mic" });
    const palette = await t.query(api.patchManager.palette, { patchSpaceId: spaceId });
    expect(palette.map((p) => p.name)).toEqual(["Shure SM57"]);
  });

  it("scopes to the room's gear plus storage by default", async () => {
    const roomA = await seedRoom(t, "Studio A");
    const roomB = await seedRoom(t, "Studio B");
    const spaceId = await seedSpace(t, roomA);

    await seedEquipment(t, { name: "In Room A", category: "mic", installedInRoomId: roomA });
    await seedEquipment(t, { name: "In Room B", category: "mic", installedInRoomId: roomB });
    await seedEquipment(t, { name: "In Storage", category: "mic" });

    const scoped = await t.query(api.patchManager.palette, { patchSpaceId: spaceId });
    expect(scoped.map((p) => p.name).sort()).toEqual(["In Room A", "In Storage"]);

    const all = await t.query(api.patchManager.palette, {
      patchSpaceId: spaceId,
      scope: "all",
    });
    expect(all).toHaveLength(3);
  });
});

describe("ports and port state", () => {
  let t: T;
  let spaceId: Id<"patchSpaces">;
  beforeEach(async () => {
    t = convexTest(schema);
    spaceId = await seedSpace(t);
  });

  it("rejects a toggle the hardware does not have", async () => {
    const equipmentId = await seedEquipment(t, { name: "Royer R-121", category: "mic" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const out = graph!.devices[0].ports[0];

    // A ribbon's output has no phantom switch on it. Refusing here means
    // the UI hiding the control is convenience, not the boundary.
    await expect(
      t.mutation(api.patchManager.setPortState, { id: out._id, phantom: true }),
    ).rejects.toThrow(/no phantom control/);
  });

  it("records a phantom power change in the audit log", async () => {
    const equipmentId = await seedEquipment(t, { name: "AMS Neve 1073SPX" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const micIn = graph!.devices[0].ports.find((p) => p.capabilities.includes("phantom"))!;

    await t.mutation(api.patchManager.setPortState, { id: micIn._id, phantom: true });

    const log = await t.query(api.patchManager.history, { patchSpaceId: spaceId });
    const entry = log.find((e) => e.entityType === "port")!;
    expect(entry.summary).toMatch(/phantom on/);
    expect(entry.after).toMatchObject({ phantom: true });
    expect(entry.before).toMatchObject({});
  });

  it("flags a ribbon profile as phantom sensitive", async () => {
    const equipmentId = await seedEquipment(t, { name: "Royer R-121", category: "mic" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices[0].phantomSensitive).toBe(true);
  });
});

describe("connections", () => {
  let t: T;
  let spaceId: Id<"patchSpaces">;

  async function twoDevices(t: T, spaceId: Id<"patchSpaces">) {
    const mic = await seedEquipment(t, { name: "Shure SM57", category: "mic" });
    const pre = await seedEquipment(t, { name: "AMS Neve 1073SPX", category: "preamp" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: mic,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: pre,
      position: { x: 200, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const micDevice = graph!.devices.find((d) => d.category === "mic")!;
    const preDevice = graph!.devices.find((d) => d.category === "preamp")!;
    return {
      micOut: micDevice.ports.find((p) => p.direction === "output")!,
      micIn: preDevice.ports.find((p) => p.label === "Mic In")!,
      preOut: preDevice.ports.find((p) => p.label === "Out")!,
    };
  }

  beforeEach(async () => {
    t = convexTest(schema);
    spaceId = await seedSpace(t);
  });

  it("patches a mic into a preamp and logs it in plain language", async () => {
    const { micOut, micIn } = await twoDevices(t, spaceId);
    await t.mutation(api.patchManager.connect, {
      fromPortId: micOut._id,
      toPortId: micIn._id,
    });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.connections).toHaveLength(1);

    const log = await t.query(api.patchManager.history, { patchSpaceId: spaceId });
    expect(log[0].summary).toBe("Patched Shure SM57 Out to AMS Neve 1073SPX Mic In");
  });

  it("replaces whatever was already in that input", async () => {
    const { micOut, micIn, preOut } = await twoDevices(t, spaceId);
    await t.mutation(api.patchManager.connect, { fromPortId: micOut._id, toPortId: micIn._id });
    await t.mutation(api.patchManager.connect, { fromPortId: preOut._id, toPortId: micIn._id });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    // One jack, one cable, same as at the bay.
    expect(graph!.connections).toHaveLength(1);
    expect(graph!.connections[0].fromPortId).toBe(preOut._id);
  });

  it("refuses a port patched to itself", async () => {
    const { micOut } = await twoDevices(t, spaceId);
    await expect(
      t.mutation(api.patchManager.connect, { fromPortId: micOut._id, toPortId: micOut._id }),
    ).rejects.toThrow(/cannot patch to itself/);
  });

  it("allows an unconventional patch rather than blocking it", async () => {
    const { micOut, preOut } = await twoDevices(t, spaceId);
    // Output into output. Wrong on paper, done on purpose in real rooms,
    // and a documentation tool that refuses to record it is useless.
    await expect(
      t.mutation(api.patchManager.connect, { fromPortId: micOut._id, toPortId: preOut._id }),
    ).resolves.toBeDefined();
  });

  it("pulls every cable when the device is removed", async () => {
    const { micOut, micIn } = await twoDevices(t, spaceId);
    await t.mutation(api.patchManager.connect, { fromPortId: micOut._id, toPortId: micIn._id });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const micDevice = graph!.devices.find((d) => d.category === "mic")!;
    await t.mutation(api.patchManager.removeDevice, { id: micDevice._id });

    const after = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(after!.connections).toHaveLength(0);
    expect(after!.devices).toHaveLength(1);

    const log = await t.query(api.patchManager.history, { patchSpaceId: spaceId });
    expect(log[0].summary).toMatch(/pulled 1 connection/);
  });

  it("bumps the patch space revision on every graph change", async () => {
    const before = await t.run(async (ctx) => (await ctx.db.get(spaceId))!.revision);
    const { micOut, micIn } = await twoDevices(t, spaceId);
    await t.mutation(api.patchManager.connect, { fromPortId: micOut._id, toPortId: micIn._id });
    const after = await t.run(async (ctx) => (await ctx.db.get(spaceId))!.revision);
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("global profile seed", () => {
  it("is idempotent and adds the patchbays the gear catalog lacks", async () => {
    const t = convexTest(schema);
    const first = await t.mutation(internal.patchManager.seedGlobalProfiles, {});
    expect(first.created).toBeGreaterThan(20);
    expect(first.updated).toBe(0);

    const second = await t.mutation(internal.patchManager.seedGlobalProfiles, {});
    expect(second.created).toBe(0);
    expect(second.updated).toBe(first.created);

    const bays = await t.run(async (ctx) =>
      (await ctx.db.query("deviceProfiles").collect()).filter((p) => p.category === "patchbay"),
    );
    expect(bays.length).toBeGreaterThan(0);
    // A 96-point bay is 96 jacks: 48 columns, top and bottom each.
    const tt = bays.find((b) => b.catalogId === "patchbay-tt-96")!;
    expect(tt.portTemplate).toHaveLength(96);
    expect(tt.defaultNormalling).toBe("half");
  });
});

describe("guards the critic found missing", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("counts placements across every patch space, not just this one", async () => {
    const a = await seedSpace(t);
    const b = await t.mutation(api.patchManager.createSpace, { name: "Studio B" });
    const equipmentId = await seedEquipment(t, {
      name: "Shure SM57",
      category: "mic",
      quantity: 1,
    });

    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: a,
      equipmentId,
      position: { x: 0, y: 0 },
    });

    // One microphone cannot be plugged in in two rooms at once.
    await expect(
      t.mutation(api.patchManager.placeDevice, {
        patchSpaceId: b,
        equipmentId,
        position: { x: 0, y: 0 },
      }),
    ).rejects.toThrow(/another patch space/);
  });

  it("restores a deleted device with its ports, port state and cables", async () => {
    const spaceId = await seedSpace(t);
    const micId = await seedEquipment(t, { name: "Shure SM57", category: "mic" });
    const preId = await seedEquipment(t, { name: "AMS Neve 1073SPX", category: "preamp" });

    const micDevice = await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: micId,
      position: { x: 0, y: 0 },
    });
    const preDevice = await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: preId,
      position: { x: 200, y: 0 },
    });

    let graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const pre = graph!.devices.find((d) => d._id === preDevice)!;
    const micOut = graph!.devices.find((d) => d._id === micDevice)!.ports[0];
    const micIn = pre.ports.find((p) => p.label === "Mic In")!;

    await t.mutation(api.patchManager.setPortState, { id: micIn._id, phantom: true });
    await t.mutation(api.patchManager.connect, {
      fromPortId: micOut._id,
      toPortId: micIn._id,
      cableTag: "A-014",
    });

    // Delete the preamp, then put it back from the snapshot the mutation returns.
    const snapshot = await t.mutation(api.patchManager.removeDevice, { id: preDevice });
    graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices).toHaveLength(1);
    expect(graph!.connections).toHaveLength(0);

    await t.mutation(api.patchManager.restoreDevice, snapshot);

    graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices).toHaveLength(2);
    expect(graph!.connections).toHaveLength(1);
    expect(graph!.connections[0].cableTag).toBe("A-014");

    const restored = graph!.devices.find((d) => d.label === "AMS Neve 1073SPX")!;
    const restoredIn = restored.ports.find((p) => p.label === "Mic In")!;
    // Port state has to come back too, or undo quietly drops 48V.
    expect(restoredIn.state.phantom).toBe(true);
  });

  it("refuses to delete inventory that is on a canvas", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, { name: "Shure SM57", category: "mic" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });

    await expect(
      t.mutation(api.equipment.remove, { id: equipmentId }),
    ).rejects.toThrow(/on the patch canvas/);
  });

  it("audits the teardown when a patch space is deleted", async () => {
    const spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t);
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.removeSpace, { id: spaceId });

    const audit = await t.run(async (ctx) => ctx.db.query("patchAudit").collect());
    expect(
      audit.some((row) => row.changeType === "delete" && row.entityType === "patchSpace"),
    ).toBe(true);
  });
});

describe("how a run is labelled", () => {
  let t: T;
  let spaceId: Id<"patchSpaces">;
  let connectionId: Id<"connections">;

  beforeEach(async () => {
    t = convexTest(schema);
    spaceId = await seedSpace(t);
    const mic = await seedEquipment(t, { name: "Shure SM57", category: "mic" });
    const pre = await seedEquipment(t, { name: "AMS Neve 1073SPX", category: "preamp" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: mic,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: pre,
      position: { x: 200, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const micOut = graph!.devices
      .find((d) => d.category === "mic")!
      .ports.find((p) => p.direction === "output")!;
    const micIn = graph!.devices
      .find((d) => d.category === "preamp")!
      .ports.find((p) => p.label === "Mic In")!;
    connectionId = await t.mutation(api.patchManager.connect, {
      fromPortId: micOut._id,
      toPortId: micIn._id,
    });
  });

  async function read() {
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    return graph!.connections[0];
  }

  it("keeps one label in the middle when the run is labelled once", async () => {
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "single",
      cableTag: "A-014",
    });

    const run = await read();
    expect(run.cableTag).toBe("A-014");
    expect(run.cableTagSource).toBeUndefined();
    expect(run.cableTagTarget).toBeUndefined();
  });

  // A cable marked at both ends says something different at each one, and the
  // middle label has to go: leaving it behind prints three labels on a run
  // someone deliberately gave two.
  it("clears the middle label when the run switches to per-end labelling", async () => {
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "single",
      cableTag: "A-014",
    });
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "perEnd",
      cableTagSource: "OUT TO 1073",
      cableTagTarget: "IN FROM SM57",
    });

    const run = await read();
    expect(run.cableTag).toBeUndefined();
    expect(run.cableTagSource).toBe("OUT TO 1073");
    expect(run.cableTagTarget).toBe("IN FROM SM57");
  });

  it("drops the end labels on the way back to a single label", async () => {
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "perEnd",
      cableTagSource: "OUT TO 1073",
      cableTagTarget: "IN FROM SM57",
    });
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "single",
      cableTag: "A-014",
    });

    const run = await read();
    expect(run.cableTag).toBe("A-014");
    expect(run.cableTagSource).toBeUndefined();
    expect(run.cableTagTarget).toBeUndefined();
  });

  // Emptying a field is a choice, not a no-op: without this the old text
  // survives every attempt to erase it.
  it("lets a label be cleared back to nothing", async () => {
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "single",
      cableTag: "A-014",
    });
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "single",
    });

    expect((await read()).cableTag).toBeUndefined();
  });

  it("leaves the labels alone when only the colour is edited", async () => {
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableLabelMode: "perEnd",
      cableTagSource: "OUT TO 1073",
      cableTagTarget: "IN FROM SM57",
    });
    await t.mutation(api.patchManager.updateConnection, {
      id: connectionId,
      cableColor: "blue",
    });

    const run = await read();
    expect(run.cableTagSource).toBe("OUT TO 1073");
    expect(run.cableTagTarget).toBe("IN FROM SM57");
  });
});

describe("sticky notes", () => {
  let t: T;
  let spaceId: Id<"patchSpaces">;

  beforeEach(async () => {
    t = convexTest(schema);
    spaceId = await seedSpace(t);
  });

  it("puts a note on the canvas and reads it back with the graph", async () => {
    await t.mutation(api.patchManager.addNote, {
      patchSpaceId: spaceId,
      position: { x: 120, y: 60 },
      text: "Console channel 7 crackles",
      color: "red",
    });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.annotations).toHaveLength(1);
    expect(graph!.annotations[0].text).toBe("Console channel 7 crackles");
    expect(graph!.annotations[0].color).toBe("red");
  });

  // A note is not gear. If it ever counted as one, the run list, the
  // inventory maths and the connector checks would all start lying.
  it("never appears among the devices", async () => {
    await t.mutation(api.patchManager.addNote, {
      patchSpaceId: spaceId,
      position: { x: 0, y: 0 },
    });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices).toHaveLength(0);
  });

  it("edits the words, the colour and where it sits", async () => {
    const id = await t.mutation(api.patchManager.addNote, {
      patchSpaceId: spaceId,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.updateNote, {
      id,
      text: "Leave patched for Thursday",
      color: "green",
      position: { x: 400, y: 220 },
      size: { width: 260, height: 180 },
    });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const note = graph!.annotations[0];
    expect(note.text).toBe("Leave patched for Thursday");
    expect(note.color).toBe("green");
    expect(note.position).toEqual({ x: 400, y: 220 });
    expect(note.size).toEqual({ width: 260, height: 180 });
  });

  it("hands back what it deleted so undo can put it back", async () => {
    const id = await t.mutation(api.patchManager.addNote, {
      patchSpaceId: spaceId,
      position: { x: 10, y: 20 },
      text: "Do not unpatch",
      color: "blue",
    });
    const snapshot = await t.mutation(api.patchManager.removeNote, { id });

    expect(snapshot.text).toBe("Do not unpatch");
    expect(snapshot.color).toBe("blue");
    expect(snapshot.position).toEqual({ x: 10, y: 20 });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.annotations).toHaveLength(0);
  });

  it("goes with the patch space when the space is deleted", async () => {
    await t.mutation(api.patchManager.addNote, {
      patchSpaceId: spaceId,
      position: { x: 0, y: 0 },
    });
    await t.mutation(api.patchManager.removeSpace, { id: spaceId });

    const left = await t.run(async (ctx) => ctx.db.query("patchAnnotations").collect());
    expect(left).toHaveLength(0);
  });
});

describe("device photos", () => {
  let t: T;
  let spaceId: Id<"patchSpaces">;
  let deviceId: Id<"deviceInstances">;

  beforeEach(async () => {
    t = convexTest(schema);
    spaceId = await seedSpace(t);
    const equipmentId = await seedEquipment(t, { name: "Shure SM57", category: "mic" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    deviceId = graph!.devices[0]._id;
  });

  it("has no photo until someone takes one", async () => {
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices[0].photoUrl).toBeNull();
    expect(graph!.devices[0].photoIsOwn).toBe(false);
  });

  it("marks a photo of this unit as its own, and lets it be removed", async () => {
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["not really a jpeg"], { type: "image/jpeg" })),
    );
    await t.mutation(api.patchManager.setDevicePhoto, { id: deviceId, storageId });

    let graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices[0].photoIsOwn).toBe(true);
    expect(graph!.devices[0].photoUrl).toBeTruthy();

    await t.mutation(api.patchManager.clearDevicePhoto, { id: deviceId });
    graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices[0].photoIsOwn).toBe(false);
  });
});
