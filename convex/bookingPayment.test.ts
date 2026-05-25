import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* Public booking payment via Stripe Connect: action falls back when no
   connected Stripe; webhook settles the payment + confirms the session. */
describe("public booking — stripe deposit", () => {
  let t: ReturnType<typeof convexTest>;
  let sessionId: string;
  beforeEach(async () => {
    t = convexTest(schema);
    delete process.env.STRIPE_SECRET_KEY;
    sessionId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", email: "nova@x.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Tracking", artistId, serviceType: "recording",
        startTime: Date.now() + 3_600_000, endTime: Date.now() + 7_200_000,
        status: "tentative", rateCents: 20000, depositCents: 6000,
        depositPaid: false, intakeCompleted: false,
      });
    });
  });

  it("payViaStripe returns {url:null} when the studio has no connected Stripe (fallback path)", async () => {
    const res = await t.action(api.booking.payViaStripe, { sessionId: sessionId as never, kind: "deposit" });
    expect(res.url).toBeNull();
  });

  it("webhook checkout.session.completed settles the deposit + confirms the session", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_pay1", type: "checkout.session.completed",
        data: { object: { metadata: { sessionId, kind: "deposit" }, payment_intent: "pi_abc" } },
      },
    });
    const session = await t.run(async (ctx) => ctx.db.get(sessionId as never)) as { status: string; depositPaid: boolean; amountPaidCents?: number };
    expect(session.status).toBe("confirmed");
    expect(session.depositPaid).toBe(true);
    const pay = await t.run(async (ctx) =>
      (await ctx.db.query("payments").collect()).find((p) => p.sessionId === sessionId));
    expect(pay?.provider).toBe("stripe");
    expect(pay?.amountCents).toBe(6000);
  });
});
