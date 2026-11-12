import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { notify } from "./lib/notify";

const ORG = "pulse-demo";

/* "Reply STOP to opt out" must be true for every text that goes through
   notify(): booking holds, request received/approved/declined, staff pay
   links. A number in smsOptOuts gets nothing handed to the provider. */
describe("notify honors STOP", () => {
  async function send(t: ReturnType<typeof convexTest>, recipient: string, channel: "sms" | "email" = "sms") {
    await t.run(async (ctx) => {
      await notify(ctx, { orgId: ORG, channel, recipient, subject: "Hold", body: "Your session is held.", kind: "booking.held" });
    });
    return await t.run(async (ctx) => ctx.db.query("notifications").collect());
  }

  it("skips a text to a number that replied STOP, even when typed without +1", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("smsOptOuts", { phone: "+15551234567", optedOut: true, updatedAt: Date.now() });
    });
    const rows = await send(t, "(555) 123-4567");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("skipped");
    const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(0);
  });

  it("still texts a number that opted back in with START", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("smsOptOuts", { phone: "+15551234567", optedOut: false, updatedAt: Date.now() });
    });
    const rows = await send(t, "+15551234567");
    expect(rows[0].status).toBe("simulated");
    const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
  });

  it("does not block email", async () => {
    const t = convexTest(schema);
    const rows = await send(t, "client@example.com", "email");
    expect(rows[0].status).toBe("simulated");
  });
});
