import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Manual payment recording: the payment type is required, "credit" posts a
   single offsetting P&L adjustment, the online path stamps "card", and the
   P&L report rolls collected totals by method. */

const ORG = "pulse-demo"; // the no-identity demo viewer resolves here

describe("invoice payment methods", () => {
  let t: ReturnType<typeof convexTest>;
  let invoiceId: Id<"invoices">;

  beforeEach(async () => {
    t = convexTest(schema);
    invoiceId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Skyline", slug: "demo", plan: "studio", status: "active",
      });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("invoices", {
        orgId: ORG, number: "PLS-200100", artistId, status: "sent",
        amountCents: 40_000, dueDate: Date.now() + 86_400_000,
        lineItems: [{ label: "Mixing", amountCents: 40_000 }],
      });
    });
  });

  it("rejects manually recording a payment without a payment type", async () => {
    await expect(
      t.mutation(api.invoices.setStatus, { id: invoiceId, status: "paid" }),
    ).rejects.toThrow(/how the client paid/i);
    const inv = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv?.status).toBe("sent"); // untouched
  });

  it("stamps the chosen method; cash-like methods post no adjustment", async () => {
    await t.mutation(api.invoices.setStatus, {
      id: invoiceId, status: "paid", paymentMethod: "venmo",
    });
    const inv = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv?.status).toBe("paid");
    expect(inv?.paymentMethod).toBe("venmo");
    const expenses = await t.query(api.expenses.list, {});
    expect(expenses).toHaveLength(0);
  });

  it("credit posts exactly one P&L adjustment and never double-posts", async () => {
    await t.mutation(api.invoices.setStatus, {
      id: invoiceId, status: "paid", paymentMethod: "credit",
    });
    let expenses = await t.query(api.expenses.list, {});
    expect(expenses).toHaveLength(1);
    expect(expenses[0].category).toBe("adjustment");
    expect(expenses[0].amountCents).toBe(40_000);
    expect(expenses[0].vendor).toBe("Nova");
    expect(expenses[0].description).toContain("PLS-200100");

    // Re-saving an already-paid invoice must not post a second adjustment.
    await t.mutation(api.invoices.setStatus, {
      id: invoiceId, status: "paid", paymentMethod: "credit",
    });
    expenses = await t.query(api.expenses.list, {});
    expect(expenses).toHaveLength(1);
  });

  it("non-paid transitions still work without a method", async () => {
    await t.mutation(api.invoices.setStatus, { id: invoiceId, status: "void" });
    const inv = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv?.status).toBe("void");
    expect(inv?.paymentMethod).toBeUndefined();
  });

  it("the online Stripe settle stamps card", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_pm1",
        type: "checkout.session.completed",
        data: { object: { metadata: { invoiceId }, payment_intent: "pi_pm" } },
      },
    });
    const inv = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv?.status).toBe("paid");
    expect(inv?.paymentMethod).toBe("card");
  });

  it("plReport rolls collected totals by payment type", async () => {
    // Venmo via the manual path.
    await t.mutation(api.invoices.setStatus, {
      id: invoiceId, status: "paid", paymentMethod: "venmo",
    });
    await t.run(async (ctx) => {
      const artistId = (await ctx.db.get(invoiceId))!.artistId;
      // A legacy paid invoice from before the field existed.
      await ctx.db.insert("invoices", {
        orgId: ORG, number: "PLS-200101", artistId, status: "paid",
        amountCents: 10_000, dueDate: 1_000_000, paidAt: Date.now(),
        lineItems: [{ label: "Old", amountCents: 10_000 }],
      });
      // A session settled through Stripe checkout -> counts as card.
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Tracking", artistId, serviceType: "recording",
        startTime: 1_000_000, endTime: 1_010_000, status: "completed",
        rateCents: 25_000, depositCents: 0, depositPaid: false, intakeCompleted: true,
      } as never);
      await ctx.db.insert("payments", {
        orgId: ORG, sessionId, kind: "full", amountCents: 25_000,
        provider: "stripe", status: "paid", paidAt: Date.now(),
      });
    });

    const pl = await t.query(api.expenses.plReport, { start: 1, end: 9_999_999_999_999 });
    const byMethod = new Map(pl.paymentsByMethod.map((m) => [m.method, m.amountCents]));
    expect(byMethod.get("venmo")).toBe(40_000);
    expect(byMethod.get("unrecorded")).toBe(10_000);
    expect(byMethod.get("card")).toBe(25_000);
  });
});
