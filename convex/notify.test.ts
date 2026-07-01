import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { notifyTeam } from "./lib/notify";

const ORG = "pulse-demo";

/* notifyTeam writes an email row to the `notifications` table (delivery is a
   separate scheduled action - we don't run it here). We assert on the inserted
   row's recipient to prove routing + owner fallback + backward compatibility. */
describe("notifyTeam routing", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  async function seedOrg(ownerEmail?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG,
        name: "Demo Studio",
        slug: "demo",
        plan: "studio",
        ...(ownerEmail ? { ownerEmail } : {}),
      });
    });
  }

  async function seedMember(name: string, email?: string) {
    return await t.run(async (ctx) =>
      ctx.db.insert("members", {
        orgId: ORG,
        name,
        role: "engineer",
        skills: [],
        ...(email ? { email } : {}),
      }),
    );
  }

  async function recipients() {
    return await t.run(async (ctx) => {
      const rows = await ctx.db.query("notifications").collect();
      return rows.map((r) => r.recipient);
    });
  }

  it("routes to a targeted member's email when toMemberId is given", async () => {
    await seedOrg("owner@studio.com");
    const engineerId = await seedMember("Jae", "jae@studio.com");

    await t.run(async (ctx) => {
      await notifyTeam(ctx, {
        orgId: ORG,
        subject: "New booking assigned",
        body: "You have a session Friday.",
        kind: "session.assigned",
        toMemberId: engineerId,
      });
    });

    expect(await recipients()).toEqual(["jae@studio.com"]);
  });

  it("routes to an explicit toEmail when given", async () => {
    await seedOrg("owner@studio.com");

    await t.run(async (ctx) => {
      await notifyTeam(ctx, {
        orgId: ORG,
        subject: "Heads up",
        body: "Payment landed.",
        kind: "payment.received",
        toEmail: "finance@studio.com",
      });
    });

    expect(await recipients()).toEqual(["finance@studio.com"]);
  });

  it("falls back to the owner when the targeted member has no email", async () => {
    await seedOrg("owner@studio.com");
    const memberId = await seedMember("No Email"); // no email on file

    await t.run(async (ctx) => {
      await notifyTeam(ctx, {
        orgId: ORG,
        subject: "New booking",
        body: "A booking came in.",
        kind: "booking.created",
        toMemberId: memberId,
      });
    });

    expect(await recipients()).toEqual(["owner@studio.com"]);
  });

  it("delivers to the owner for an old-style call (backward compatible)", async () => {
    await seedOrg("owner@studio.com");

    await t.run(async (ctx) => {
      await notifyTeam(ctx, {
        orgId: ORG,
        subject: "Invoice paid",
        body: "An invoice was paid.",
        kind: "invoice.paid",
      });
    });

    expect(await recipients()).toEqual(["owner@studio.com"]);
  });

  it("is a no-op when neither a target nor an owner email resolves", async () => {
    await seedOrg(); // org with no ownerEmail

    await t.run(async (ctx) => {
      await notifyTeam(ctx, {
        orgId: ORG,
        subject: "Nowhere to send",
        body: "This should not create a row.",
        kind: "booking.created",
      });
    });

    expect(await recipients()).toEqual([]);
  });
});
