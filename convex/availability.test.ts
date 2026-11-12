import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* Self-service availability + time-off. The demo viewer (no Clerk identity)
   resolves to clerkUserId "demo-user", so we seed a member with that id. */
describe("availability + time-off", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", tier: "growth", status: "active" });
      await ctx.db.insert("members", {
        orgId: "pulse-demo", name: "Eng Ellis", role: "engineer",
        email: "ellis@demo.com", clerkUserId: "demo-user", skills: [],
      });
    });
  });

  it("setMyAvailability replaces the caller's weekly slots", async () => {
    await t.mutation(api.availability.setMyAvailability, {
      slots: [
        { weekday: 1, startMinutes: 540, endMinutes: 1020 },
        { weekday: 3, startMinutes: 600, endMinutes: 960 },
      ],
    });
    const a = await t.query(api.availability.myAvailability, {});
    expect(a.slots.length).toBe(2);
    expect(a.slots[0].weekday).toBe(1);
    // Replacing again overwrites (no accumulation).
    await t.mutation(api.availability.setMyAvailability, { slots: [{ weekday: 5, startMinutes: 540, endMinutes: 720 }] });
    const b = await t.query(api.availability.myAvailability, {});
    expect(b.slots.length).toBe(1);
    expect(b.slots[0].weekday).toBe(5);
  });

  it("a time-off request alerts the studio's manager inbox", async () => {
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "pulse-demo");
      await ctx.db.patch(org!._id, { ownerEmail: "owner@demo.com" });
    });
    const now = Date.now();
    await t.mutation(api.availability.requestTimeOff, { startTime: now + 86400000, endTime: now + 2 * 86400000, reason: "Trip" });
    const sent = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "timeoff.requested"));
    expect(sent).toHaveLength(1);
    expect(sent[0].recipient).toBe("owner@demo.com");
    expect(sent[0].body).toMatch(/Eng Ellis/);
  });

  it("request → pending → approve flow notifies the staff member", async () => {
    const now = Date.now();
    await t.mutation(api.availability.requestTimeOff, { startTime: now + 86400000, endTime: now + 2 * 86400000, reason: "Trip" });
    const mine = await t.query(api.availability.myTimeOff, {});
    expect(mine.length).toBe(1);
    expect(mine[0].status).toBe("pending");

    const pending = await t.query(api.availability.pendingTimeOff, {});
    expect(pending.length).toBe(1);
    expect(pending[0].memberName).toBe("Eng Ellis");

    await t.mutation(api.availability.decideTimeOff, { id: pending[0]._id, decision: "approved" });
    const after = await t.query(api.availability.myTimeOff, {});
    expect(after[0].status).toBe("approved");
    const notif = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).find((n) => n.kind === "timeoff.decided"));
    expect(notif?.recipient).toBe("ellis@demo.com");
  });
});
