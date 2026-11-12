/* ============================================================
   STOP is final (truth audit B3: bookings-clients-comms-stop,
   bookings-clients-feat-instant-text).

   Texts that go through notify() (booking hold text, booking request
   texts, staff pay-link texts) and the agent's approved send_sms used
   to ignore smsOptOuts. A number that replied STOP must get none.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { notify } from "./lib/notify";

const ORG = "pulse-demo";

describe("SMS opt-out is honored everywhere", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    await t.run(async (ctx) => {
      // Stored the way the STOP handler stores it: E.164.
      await ctx.db.insert("smsOptOuts", { phone: "+15551234567", optedOut: true, updatedAt: Date.now() });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notify() does not queue a text to a number that replied STOP, however it is typed", async () => {
    await t.run(async (ctx) => {
      for (const recipient of ["+15551234567", "(555) 123-4567", "555.123.4567"]) {
        await notify(ctx, { orgId: ORG, channel: "sms", recipient, subject: "Held", body: "Your room is held", kind: "booking.hold" });
      }
    });
    // Owner decision: a blocked text leaves a "skipped" row so staff can see
    // why it did not go out, and nothing is scheduled to deliver it.
    const rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "skipped")).toBe(true);
    const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(0);
  });

  it("notify() still texts numbers that did not opt out, and still emails", async () => {
    await t.run(async (ctx) => {
      await notify(ctx, { orgId: ORG, channel: "sms", recipient: "+15559876543", subject: "Held", body: "x", kind: "booking.hold" });
      await notify(ctx, { orgId: ORG, channel: "email", recipient: "a@b.com", subject: "Held", body: "x", kind: "booking.hold" });
    });
    const rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "sms"]);
  });

  it("a number that texted START again is texted", async () => {
    await t.run(async (ctx) => {
      const row = await ctx.db.query("smsOptOuts").first();
      await ctx.db.patch(row!._id, { optedOut: false });
      await notify(ctx, { orgId: ORG, channel: "sms", recipient: "+15551234567", subject: "Held", body: "x", kind: "booking.hold" });
    });
    expect(await t.run(async (ctx) => ctx.db.query("notifications").collect())).toHaveLength(1);
  });

  it("an approved agent send_sms to an opted-out number is not sent", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("agentApprovals", {
        orgId: ORG, actionType: "send_sms", title: "Nudge", explanation: "x",
        proposedPayload: { to: "555-123-4567", body: "Come back!" },
        riskLevel: "low", status: "approved", createdAt: Date.now(),
      }));
    await t.action(internal.agent.executeApproval, { id });
    const ap = await t.run(async (ctx) => ctx.db.get(id));
    expect(ap?.status).toBe("failed");
    expect(ap?.result).toMatch(/STOP/);
  });
});
