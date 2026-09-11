/* The change log records people, hides money, and is for owners and managers. */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

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
        orgId: "pulse-demo", name, role, email: `${subject}@demo.com`, skills: [], clerkUserId: subject,
      });
    }
  });
  return {
    t,
    owner: t.withIdentity({ subject: "user_owner", name: "Olu" }),
    manager: t.withIdentity({ subject: "user_manager", name: "Mo" }),
    engineer: t.withIdentity({ subject: "user_engineer", name: "Ellis" }),
  };
}

describe("the change log", () => {
  it("records who changed what, with the fields and their values", async () => {
    const { owner } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    await owner.mutation(api.rooms.update, { id: roomId, name: "Live Room" });

    const log = await owner.query(api.changeAudit.list, {});
    const renamed = log.find((e) => e.op === "update" && e.tableName === "rooms");
    expect(renamed?.actorName).toBe("Olu");
    expect(renamed?.fields).toEqual(["name"]);
    expect(renamed?.before).toEqual({ name: "Studio A" });
    expect(renamed?.after).toEqual({ name: "Live Room" });
    expect(renamed?.area).toBe("bookings");
    expect(log.some((e) => e.op === "insert" && e.tableName === "rooms")).toBe(true);
  });

  it("records an engineer's booking under their name", async () => {
    const { owner, engineer } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    const start = Date.now() + 86_400_000;
    await engineer.mutation(api.sessions.create, {
      title: "Tracking", clientName: "Ye West", serviceType: "recording", roomId,
      startTime: start, endTime: start + 3_600_000,
    });
    const log = await owner.query(api.changeAudit.list, { area: "bookings" });
    expect(log.some((e) => e.tableName === "sessions" && e.actorName === "Ellis")).toBe(true);
  });

  it("is for owners and managers only", async () => {
    const { engineer, manager } = await studio();
    await expect(engineer.query(api.changeAudit.list, {})).rejects.toThrow();
    await expect(manager.query(api.changeAudit.list, {})).resolves.toBeDefined();
  });

  it("shows a manager without money that a rate changed, never the figures", async () => {
    const { owner, manager } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    await owner.mutation(api.orgs.setManagersSeeMoney, { enabled: false });
    await owner.mutation(api.rooms.update, { id: roomId, hourlyRateCents: 9000 });

    const forManager = await manager.query(api.changeAudit.list, { area: "bookings" });
    const rate = forManager.find((e) => e.fields.includes("hourlyRateCents"));
    expect(rate?.actorName).toBe("Olu");
    expect(rate?.before).toBeNull();
    expect(rate?.after).toBeNull();

    const forOwner = await owner.query(api.changeAudit.list, { area: "bookings" });
    const same = forOwner.find((e) => e.fields.includes("hourlyRateCents"));
    expect(same?.after).toEqual({ hourlyRateCents: 9000 });
  });

  it("does not record the studio's own automation", async () => {
    const { t } = await studio();
    await t.mutation(api.rooms.create, { name: "Seeded" }).catch(() => undefined);
    const rows = await t.run(async (ctx) => ctx.db.query("changeAudit").collect());
    expect(rows.every((r) => r.actorClerkUserId)).toBe(true);
  });
});
