/* Money reaches the people allowed to see it, and nobody else.
 *
 * The rule the studio set: engineers and the rest of the floor never see a
 * figure, managers do unless the owner says otherwise, owners always do. These
 * tests go through the real functions with real identities, because the leaks
 * this suite exists for were in reads that ignored who was asking, not in the
 * capability table itself. */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { MONEY_FIELDS, BOOKS_FIELDS, PROCESSOR_FIELDS, MIRROR_PLACEHOLDERS, redactMoney } from "./lib/money";

type TableDef = { validator: { fields: Record<string, unknown> } };
const tables = schema.tables as unknown as Record<string, TableDef>;

describe("the money field lists agree with the schema", () => {
  // A misspelt name here is not a type error. It is a figure that ships.
  for (const [label, map] of [
    ["money", MONEY_FIELDS],
    ["books", BOOKS_FIELDS],
    ["processor", PROCESSOR_FIELDS],
  ] as const) {
    for (const [table, fields] of Object.entries(map)) {
      it(`${label}: ${table} has every field named`, () => {
        const def = tables[table];
        expect(def, `${table} is not a table`).toBeDefined();
        for (const field of fields) {
          expect(Object.keys(def.validator.fields), `${table}.${field}`).toContain(field);
        }
      });
    }
  }

  it("strips an add-on's price but keeps the add-on", () => {
    const out = redactMoney(
      "sessions",
      { title: "Mix", rateCents: 20000, addOns: [{ name: "Neve", priceCents: 5000, equipmentId: "e1" }] },
      { money: false, books: false },
    ) as Record<string, unknown>;
    expect(out.rateCents).toBeUndefined();
    expect(out.addOns).toEqual([{ name: "Neve", equipmentId: "e1" }]);
  });

  it("gives a device a placeholder for every required figure, and only those", () => {
    // Every iPhone build already installed decodes rows against the schema; a
    // required column that vanishes fails the row and empties the screen.
    for (const map of [MONEY_FIELDS, BOOKS_FIELDS]) {
      for (const [table, fields] of Object.entries(map)) {
        for (const field of fields) {
          const validator = tables[table].validator.fields[field] as { isOptional?: string };
          const required = validator.isOptional !== "optional";
          const has = MIRROR_PLACEHOLDERS[table]?.[field] !== undefined;
          expect(has, `${table}.${field} is ${required ? "required" : "optional"}`).toBe(required);
        }
      }
    }
  });

  it("keeps an add-on's price column on a device, zeroed", () => {
    const out = redactMoney(
      "sessions",
      { rateCents: 20000, depositPaid: true, addOns: [{ name: "Neve", priceCents: 5000 }] },
      { money: false, books: false },
      "placeholder",
    ) as Record<string, unknown>;
    expect(out.rateCents).toBe(0);
    expect(out.depositPaid).toBe(false);
    expect(out.addOns).toEqual([{ name: "Neve", priceCents: 0 }]);
  });

  it("leaves a row whole for someone who may see everything", () => {
    const row = { title: "Mix", rateCents: 20000 };
    expect(redactMoney("sessions", row, { money: true, books: true })).toBe(row);
  });
});

async function studio() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
    });
    for (const [name, role, subject] of [
      ["Olu", "owner", "user_owner"],
      ["Mo", "manager", "user_manager"],
      ["Ellis", "engineer", "user_engineer"],
    ] as const) {
      await ctx.db.insert("members", {
        orgId: "pulse-demo", name, role, email: `${subject}@demo.com`, skills: [],
        clerkUserId: subject, payType: "hourly", payRateCents: 4500,
      });
    }
  });
  const owner = t.withIdentity({ subject: "user_owner", name: "Olu" });
  const manager = t.withIdentity({ subject: "user_manager", name: "Mo" });
  const engineer = t.withIdentity({ subject: "user_engineer", name: "Ellis" });

  const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
  const start = Date.now() + 86_400_000;
  await owner.mutation(api.sessions.create, {
    title: "Mix day", clientName: "Nova Reign", serviceType: "mixing", roomId,
    startTime: start, endTime: start + 2 * 3_600_000, rateCents: 20000,
  });
  return { t, owner, manager, engineer, roomId, start };
}

describe("who sees what a session is worth", () => {
  it("strips a session's figures for an engineer and keeps them for a manager", async () => {
    const { engineer, manager } = await studio();

    const [floor] = (await engineer.query(api.sync.snapshot, { table: "sessions" })).docs as Record<string, unknown>[];
    expect(floor.title).toBe("Mix day");
    // The device keeps the column, not the figure.
    expect(floor.rateCents).toBe(0);
    expect(floor.depositCents).toBe(0);

    const [books] = (await manager.query(api.sync.snapshot, { table: "sessions" })).docs as Record<string, unknown>[];
    expect(books.rateCents).toBe(20000);

    const listed = (await engineer.query(api.sessions.list, {})) as Record<string, unknown>[];
    expect(listed[0].rateCents).toBeUndefined();
  });

  it("prices an engineer's booking from the room, whatever figure they send", async () => {
    const { t, engineer, roomId, start } = await studio();
    const later = start + 4 * 3_600_000;
    await engineer.mutation(api.sessions.create, {
      title: "Tracking", clientName: "Ye West", serviceType: "recording", roomId,
      startTime: later, endTime: later + 3 * 3_600_000, rateCents: 1, depositCents: 1,
    });
    const row = await t.run(async (ctx) =>
      (await ctx.db.query("sessions").collect()).find((s) => s.title === "Tracking"),
    );
    expect(row?.rateCents).toBe(7500 * 3);
    expect(row?.depositCents).not.toBe(1);
  });

  it("gives an engineer a client without their worth or their invoices", async () => {
    const { t, engineer } = await studio();
    const artistId = await t.run(async (ctx) => (await ctx.db.query("artists").first())!._id);
    const client = (await engineer.query(api.artists.get, { id: artistId })) as Record<string, unknown>;
    expect(client.name).toBe("Nova Reign");
    expect(client.lifetimeValueCents).toBeUndefined();
    expect(client.invoices).toEqual([]);
    expect(client.outstandingCents).toBeNull();
  });

  it("keeps pay rates off an engineer's view of the team", async () => {
    const { engineer, owner } = await studio();
    const floor = (await engineer.query(api.members.list, {})) as Record<string, unknown>[];
    expect(floor.every((m) => m.payRateCents === undefined)).toBe(true);
    const books = (await owner.query(api.members.list, {})) as Record<string, unknown>[];
    expect(books.some((m) => m.payRateCents === 4500)).toBe(true);
  });

  it("refuses an engineer the money actions on a booking", async () => {
    const { t, engineer } = await studio();
    const id = await t.run(async (ctx) => (await ctx.db.query("sessions").first())!._id);
    await expect(engineer.mutation(api.sessions.payDeposit, { id })).rejects.toThrow();
    await expect(engineer.mutation(api.sessions.setComp, { id, compType: "comped" })).rejects.toThrow();
  });
});

describe("the owner's switch for managers", () => {
  it("only an owner can flip it", async () => {
    const { manager, engineer } = await studio();
    await expect(manager.mutation(api.orgs.setManagersSeeMoney, { enabled: false })).rejects.toThrow(/owner/i);
    await expect(engineer.mutation(api.orgs.setManagersSeeMoney, { enabled: false })).rejects.toThrow(/owner/i);
  });

  it("takes every figure from managers, and nothing from the owner", async () => {
    const { owner, manager } = await studio();
    await owner.mutation(api.orgs.setManagersSeeMoney, { enabled: false });

    const session = await manager.query(api.session.current, {});
    expect(session.capabilities).not.toContain("invoices.read");
    expect(session.capabilities).not.toContain("insights.read");
    // Still running the studio.
    expect(session.capabilities).toContain("sessions.edit");
    expect(session.capabilities).toContain("schedule.manage");

    const tables = await manager.query(api.sync.mirroredTables, {});
    expect(tables).not.toContain("invoices");
    expect(tables).not.toContain("payments");
    // Who is on shift is the rota, not the books.
    expect(tables).toContain("timeEntries");

    const [row] = (await manager.query(api.sync.snapshot, { table: "sessions" })).docs as Record<string, unknown>[];
    expect(row.rateCents).toBe(0);

    const ownerSession = await owner.query(api.session.current, {});
    expect(ownerSession.capabilities).toContain("invoices.read");

    await owner.mutation(api.orgs.setManagersSeeMoney, { enabled: true });
    const back = await manager.query(api.session.current, {});
    expect(back.capabilities).toContain("invoices.read");
  });

  it("makes a manager's phone re-fetch the moment it flips", async () => {
    const { owner, manager } = await studio();
    const feed = await manager.query(api.sync.pullChanges, {});
    expect(feed.cursor).toBeTruthy();
    expect((await manager.query(api.sync.cursorIsUsable, { cursor: feed.cursor })).usable).toBe(true);

    await owner.mutation(api.orgs.setManagersSeeMoney, { enabled: false });
    const after = await manager.query(api.sync.cursorIsUsable, { cursor: feed.cursor });
    expect(after.usable).toBe(false);
  });

  it("re-fetches once for a cursor issued before the tag existed", async () => {
    const { manager } = await studio();
    const legacy = await manager.query(api.sync.cursorIsUsable, { cursor: `${Date.now()}:1` });
    expect(legacy.usable).toBe(false);
  });
});
