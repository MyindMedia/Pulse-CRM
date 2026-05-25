import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

describe("invoice pay link + settle", () => {
  let t: ReturnType<typeof convexTest>;
  let invoiceId: string;
  beforeEach(async () => {
    t = convexTest(schema);
    invoiceId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Skyline", slug: "demo", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", { orgId: "pulse-demo", name: "Nova", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      return ctx.db.insert("invoices", { orgId: "pulse-demo", number: "PLS-100390", artistId, status: "sent", amountCents: 50000, dueDate: Date.now() - 86400000, lineItems: [{ label: "Podcast editing", amountCents: 50000 }] });
    });
  });

  it("public get returns sanitized invoice + payability", async () => {
    const inv = await t.query(api.invoicePay.get, { invoiceId: invoiceId as never });
    expect(inv?.number).toBe("PLS-100390");
    expect(inv?.amountCents).toBe(50000);
    expect(inv?.status).toBe("overdue"); // past due
    expect(inv?.payable).toBe(false); // no Stripe in test env
  });

  it("payViaStripe returns {url:null} without a connected Stripe", async () => {
    const res = await t.action(api.invoicePay.payViaStripe, { invoiceId: invoiceId as never });
    expect(res.url).toBeNull();
  });

  it("checkout.session.completed with invoiceId marks the invoice paid", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: { id: "evt_inv1", type: "checkout.session.completed", data: { object: { metadata: { invoiceId }, payment_intent: "pi_x" } } },
    });
    const inv = await t.query(api.invoicePay.get, { invoiceId: invoiceId as never });
    expect(inv?.status).toBe("paid");
  });
});
