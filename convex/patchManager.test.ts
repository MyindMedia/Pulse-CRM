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
    /* Cable stock is an equipment row carrying its ends. Without this the
       helper silently dropped the spec and every fit graded "vague". */
    cableSpec: {
      connectorA: string;
      connectorB: string;
      channels: number;
      lengthFt?: number;
      genderA?: string;
      genderB?: string;
      color?: string;
    };
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
      cableSpec: overrides.cableSpec as never,
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

describe("where a device's I/O came from", () => {
  let t: T;
  let spaceId: Id<"patchSpaces">;

  beforeEach(async () => {
    t = convexTest(schema);
    spaceId = await seedSpace(t);
  });

  async function place(name: string, category: string) {
    const equipmentId = await seedEquipment(t, { name, category });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId,
      position: { x: 0, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    return graph!.devices.find((d) => d.label.startsWith(name))!;
  }

  // A hand-written port map was authored against the manufacturer's own
  // panel. Asking a human to re-confirm it would be theatre.
  it("trusts a curated map on sight", async () => {
    const device = await place("Shure SM57", "mic");
    expect(device.specSource).toBe("curated");
    expect(device.specVerified).toBe(true);
  });

  it("marks a category fallback as an unconfirmed guess", async () => {
    const device = await place("Some Obscure Box 9000", "preamp");
    expect(device.specSource).toBe("category");
    expect(device.specVerified).toBe(false);
  });

  it("stops asking once someone confirms the ports", async () => {
    const device = await place("Some Obscure Box 9000", "preamp");
    expect(device.specVerified).toBe(false);

    await t.mutation(api.patchSpecs.verifySpec, { profileId: device.profileId });

    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    expect(graph!.devices[0].specVerified).toBe(true);
  });

  it("lists only the profiles still waiting on a human", async () => {
    await place("Shure SM57", "mic");
    const guess = await place("Some Obscure Box 9000", "preamp");

    let waiting = await t.query(api.patchSpecs.unverified, {});
    expect(waiting.map((w) => w.name)).toEqual(["Some Obscure Box 9000"]);

    await t.mutation(api.patchSpecs.verifySpec, { profileId: guess.profileId });
    waiting = await t.query(api.patchSpecs.unverified, {});
    expect(waiting).toHaveLength(0);
  });

  // Someone who has seen the hardware outranks anything a lookup finds
  // later, or the correction would be silently undone on the next pass.
  it("locks the ports once they are edited by hand", async () => {
    const device = await place("Some Obscure Box 9000", "preamp");
    await t.mutation(api.patchSpecs.setPorts, {
      profileId: device.profileId,
      ports: [
        {
          label: "The one real input",
          direction: "input",
          signalLevel: "line",
          connector: "trs",
          capabilities: [],
        },
      ],
    });

    const profile = await t.run(async (ctx) => ctx.db.get(device.profileId));
    expect(profile!.specSource).toBe("manual");
    expect(profile!.specVerifiedAt).toBeTruthy();

    // A late lookup landing afterwards must not overwrite the human. This
    // calls the internal writer directly, which is exactly the race the
    // guard exists for: the action was already in flight when they edited.
    await t.mutation(internal.patchSpecs.storeSpec, {
      profileId: device.profileId,
      ports: [
        {
          label: "Invented by a robot",
          direction: "input",
          signalLevel: "mic",
          connector: "xlr3",
          capabilities: [],
        },
      ],
      source: "ai",
    });

    const after = await t.run(async (ctx) => ctx.db.get(device.profileId));
    expect(after!.portTemplate[0].label).toBe("The one real input");
  });

  it("refuses an empty port list", async () => {
    const device = await place("Some Obscure Box 9000", "preamp");
    await expect(
      t.mutation(api.patchSpecs.setPorts, { profileId: device.profileId, ports: [] }),
    ).rejects.toThrow(/at least one port/);
  });
});

describe("adding and correcting a device's I/O by hand", () => {
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

  async function portsOf() {
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    return graph!.devices[0].ports;
  }

  it("adds a jack that was missing from the guess", async () => {
    const before = (await portsOf()).length;
    await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: deviceId,
      label: "Line In 1",
      direction: "input",
      signalLevel: "line",
      connector: "trs",
    });

    const after = await portsOf();
    expect(after).toHaveLength(before + 1);
    expect(after.find((p) => p.label === "Line In 1")).toBeTruthy();
  });

  // An XLR output is male, an XLR input female. Flipping a jack's direction
  // has to flip its gender or the two-males check silently stops working.
  it("re-stamps gender when the jack changes shape", async () => {
    const id = await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: deviceId,
      label: "Panel jack",
      direction: "input",
      signalLevel: "mic",
      connector: "xlr3",
    });
    expect((await portsOf()).find((p) => p._id === id)!.gender).toBe("female");

    await t.mutation(api.patchManager.updatePort, { id, direction: "output" });
    expect((await portsOf()).find((p) => p._id === id)!.gender).toBe("male");
  });

  it("lets an explicit gender override the convention", async () => {
    const id = await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: deviceId,
      label: "Odd jack",
      direction: "output",
      signalLevel: "line",
      connector: "xlr3",
    });
    await t.mutation(api.patchManager.updatePort, {
      id,
      connector: "xlr3",
      gender: "female",
    });
    expect((await portsOf()).find((p) => p._id === id)!.gender).toBe("female");
  });

  it("corrects the connector, not just the name", async () => {
    const id = await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: deviceId,
      label: "Wrongly guessed",
      direction: "output",
      signalLevel: "line",
      connector: "xlr3",
    });
    await t.mutation(api.patchManager.updatePort, { id, connector: "trs", label: "Line Out" });

    const port = (await portsOf()).find((p) => p._id === id)!;
    expect(port.connector).toBe("trs");
    expect(port.label).toBe("Line Out");
  });

  // A run graded against an XLR jack is not still clean once that jack
  // becomes a TRS. Leaving the old verdict makes the canvas lie in exactly
  // the situation the connector checks exist to catch.
  it("re-grades a patched cable when the jack underneath it changes", async () => {
    // Ports added here rather than borrowed from a template, so the test
    // pins the re-grade mechanism and not a curated map's spelling.
    const outId = await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: deviceId,
      label: "Clean Out",
      direction: "output",
      signalLevel: "line",
      connector: "xlr3",
    });

    const preId = await seedEquipment(t, { name: "AMS Neve 1073SPX", category: "preamp" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: preId,
      position: { x: 300, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const preDevice = graph!.devices.find((d) => d.category === "preamp")!;
    const inId = await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: preDevice._id,
      label: "Clean In",
      direction: "input",
      signalLevel: "line",
      connector: "xlr3",
    });

    const cableId = await seedEquipment(t, {
      name: "XLR 10ft",
      category: "cable",
      cableSpec: { connectorA: "xlr3", connectorB: "xlr3", channels: 1, lengthFt: 10 },
    });
    const connectionId = await t.mutation(api.patchManager.connect, {
      fromPortId: outId,
      toPortId: inId,
      cableId,
    });

    expect((await t.run(async (ctx) => ctx.db.get(connectionId)))!.cableFit).toBe("exact");

    // Someone realises that input is actually a TRS jack.
    await t.mutation(api.patchManager.updatePort, { id: inId, connector: "trs" });

    // The write itself must land before the re-grade can mean anything.
    expect((await t.run(async (ctx) => ctx.db.get(inId)))!.connector).toBe("trs");

    expect((await t.run(async (ctx) => ctx.db.get(connectionId)))!.cableFit).toBe("mismatch");
  });

  it("pulls the cables when a jack is removed", async () => {
    const id = await t.mutation(api.patchManager.addPort, {
      deviceInstanceId: deviceId,
      label: "Doomed",
      direction: "output",
      signalLevel: "line",
      connector: "trs",
    });
    await t.mutation(api.patchManager.removePort, { id });
    expect((await portsOf()).find((p) => p._id === id)).toBeUndefined();
  });
});

describe("putting a device's jacks in panel order", () => {
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

  async function addThree() {
    const ids: Id<"ports">[] = [];
    for (const label of ["Alpha", "Bravo", "Charlie"]) {
      ids.push(
        await t.mutation(api.patchManager.addPort, {
          deviceInstanceId: deviceId,
          label,
          direction: "input",
          signalLevel: "line",
          connector: "trs",
        }),
      );
    }
    return ids;
  }

  async function labelsInOrder() {
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    return graph!.devices[0].ports.map((p) => p.label);
  }

  it("reorders the jacks and the graph reads them back that way", async () => {
    const all = await t
      .query(api.patchManager.graph, { patchSpaceId: spaceId })
      .then((g) => g!.devices[0].ports.map((p) => p._id as Id<"ports">));
    const [a, b, c] = await addThree();

    await t.mutation(api.patchManager.reorderPorts, {
      deviceInstanceId: deviceId,
      orderedIds: [c, a, b, ...all],
    });

    const labels = await labelsInOrder();
    expect(labels.slice(0, 3)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  // A partial list would leave the jacks it omitted holding stale indices
  // and silently jumbled, which is worse than refusing.
  it("refuses an ordering that does not name every port", async () => {
    const [a] = await addThree();
    await expect(
      t.mutation(api.patchManager.reorderPorts, {
        deviceInstanceId: deviceId,
        orderedIds: [a],
      }),
    ).rejects.toThrow(/does not match this device/);
  });

  it("refuses a port that belongs to another device", async () => {
    const otherEquipment = await seedEquipment(t, { name: "Telefunken U47", category: "mic" });
    await t.mutation(api.patchManager.placeDevice, {
      patchSpaceId: spaceId,
      equipmentId: otherEquipment,
      position: { x: 400, y: 0 },
    });
    const graph = await t.query(api.patchManager.graph, { patchSpaceId: spaceId });
    const stranger = graph!.devices.find((d) => d._id !== deviceId)!.ports[0]._id as Id<"ports">;

    const mine = graph!.devices
      .find((d) => d._id === deviceId)!
      .ports.map((p) => p._id as Id<"ports">);

    await expect(
      t.mutation(api.patchManager.reorderPorts, {
        deviceInstanceId: deviceId,
        orderedIds: [stranger, ...mine.slice(1)],
      }),
    ).rejects.toThrow(/does not match this device/);
  });

  // Dense, gap-free indices matter: a patchbay lays itself out by counting.
  it("leaves the indices dense and starting at one", async () => {
    const all = await t
      .query(api.patchManager.graph, { patchSpaceId: spaceId })
      .then((g) => g!.devices[0].ports.map((p) => p._id as Id<"ports">));
    const [a, b, c] = await addThree();

    await t.mutation(api.patchManager.reorderPorts, {
      deviceInstanceId: deviceId,
      orderedIds: [...all, c, b, a],
    });

    const indices = await t.run(async (ctx) => {
      const rows = await ctx.db.query("ports").collect();
      return rows
        .filter((r) => r.deviceInstanceId === deviceId)
        .map((r) => r.channelIndex)
        .sort((x, y) => (x ?? 0) - (y ?? 0));
    });
    expect(indices).toEqual([1, 2, 3, 4]);
  });
});
