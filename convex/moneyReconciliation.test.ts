import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Money reconciliation - the completion invoice, the payments ledger, and
   the manual invoice reminder all have to agree on what was actually
   collected so a client can never be over-billed. */

const HOUR = 3_600_000;
const ORG = "pulse-demo"; // the no-identity demo viewer resolves here

type T = ReturnType<typeof convexTest>;

async function seedArtist(t: T, orgId = ORG, email?: string) {
  return t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId, name: "Nova", type: "artist", email,
      genres: [], tags: [], status: "active",
      lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    }),
  );
}

async function seedSession(
  t: T,
  artistId: Id<"artists">,
  overrides: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId: ORG, title: "Tracking", artistId, serviceType: "recording",
      startTime: Date.now() - 3 * HOUR, endTime: Date.now() - HOUR,
      status: "in_progress", rateCents: 50_000, depositCents: 15_000,
      depositPaid: false, intakeCompleted: false,
      ...overrides,
    } as never),
  );
}

async function invoicesFor(t: T, sessionId: Id<"sessions">) {
  return t.run(async (ctx) =>
    (await ctx.db.query("invoices").collect()).filter((i) => i.sessionId === sessionId),
  );
}

describe("completion invoice respects money collected", () => {
  it("bills only the unpaid balance when payments were collected", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { amountPaidCents: 20_000 });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    const invs = await invoicesFor(t, sessionId);
    expect(invs).toHaveLength(1);
    expect(invs[0].amountCents).toBe(30_000); // 50k rate - 20k collected
    expect(invs[0].status).toBe("draft");
    expect(invs[0].lineItems[0].amountCents).toBe(30_000);
  });

  it("creates NO invoice when the session is already paid in full", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { amountPaidCents: 50_000 });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    expect(await invoicesFor(t, sessionId)).toHaveLength(0);
  });

  it("never over-bills an overpaid session (balance clamps at zero)", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { amountPaidCents: 65_000 });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    expect(await invoicesFor(t, sessionId)).toHaveLength(0);
  });

  it("still credits a legacy depositPaid flag with no ledger total", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    // Pre-ledger row: depositPaid true but amountPaidCents never stamped.
    const sessionId = await seedSession(t, artistId, { depositPaid: true });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    const invs = await invoicesFor(t, sessionId);
    expect(invs).toHaveLength(1);
    expect(invs[0].amountCents).toBe(35_000); // 50k rate - 15k deposit, not double-credited
  });

  it("does not double-invoice a session that already has a live invoice", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { amountPaidCents: 20_000 });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    expect(await invoicesFor(t, sessionId)).toHaveLength(1);
  });
});

describe("cron auto-complete invoices the balance", () => {
  it("invoices exactly what is still owed when the cron completes a booking", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t, ORG, "nova@x.com");
    const sessionId = await seedSession(t, artistId, {
      source: "public_booking",
      rateCents: 40_000,
      depositCents: 10_000,
      depositPaid: true,
      amountPaidCents: 10_000,
      status: "in_progress",
    });

    await t.mutation(api.automation.runNow, {});

    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("completed");
    const invs = await invoicesFor(t, sessionId);
    expect(invs).toHaveLength(1);
    expect(invs[0].amountCents).toBe(30_000); // 40k rate - 10k deposit collected

    // A second sweep never duplicates the invoice.
    await t.mutation(api.automation.runNow, {});
    expect(await invoicesFor(t, sessionId)).toHaveLength(1);
  });

  it("skips the invoice when the cron completes a fully-paid booking", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t, ORG, "nova@x.com");
    const sessionId = await seedSession(t, artistId, {
      source: "public_booking",
      rateCents: 40_000,
      depositPaid: true,
      amountPaidCents: 40_000,
      status: "in_progress",
    });

    await t.mutation(api.automation.runNow, {});

    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("completed");
    expect(await invoicesFor(t, sessionId)).toHaveLength(0);
  });
});

describe("payDeposit writes the payments ledger", () => {
  it("inserts a simulated deposit row and reconciles amountPaidCents", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { status: "tentative" });

    await t.mutation(api.sessions.payDeposit, { id: sessionId });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("payments").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("deposit");
    expect(rows[0].provider).toBe("simulated");
    expect(rows[0].status).toBe("paid");
    expect(rows[0].amountCents).toBe(15_000);
    expect(rows[0].paidAt).toBeGreaterThan(0);

    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.depositPaid).toBe(true);
    expect(session!.status).toBe("confirmed");
    expect(session!.amountPaidCents).toBe(15_000);
  });

  it("a re-click never double-inserts the ledger row or double-credits", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { status: "tentative" });

    await t.mutation(api.sessions.payDeposit, { id: sessionId });
    await t.mutation(api.sessions.payDeposit, { id: sessionId });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("payments").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect(),
    );
    expect(rows).toHaveLength(1);
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.amountPaidCents).toBe(15_000);
  });

  it("skips the insert when a cleared deposit already exists on the ledger", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, {
      status: "tentative",
      amountPaidCents: 15_000,
    });
    await t.run((ctx) =>
      ctx.db.insert("payments", {
        orgId: ORG, sessionId, kind: "deposit", amountCents: 15_000,
        provider: "stripe", status: "paid", paidAt: Date.now(),
      }),
    );

    await t.mutation(api.sessions.payDeposit, { id: sessionId });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("payments").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect(),
    );
    expect(rows).toHaveLength(1); // the pre-existing Stripe row, nothing added
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.amountPaidCents).toBe(15_000);
  });

  it("deposit paid via payDeposit is credited by the completion invoice", async () => {
    const t = convexTest(schema);
    const artistId = await seedArtist(t);
    const sessionId = await seedSession(t, artistId, { status: "tentative", rateCents: 30_000, depositCents: 10_000 });

    await t.mutation(api.sessions.payDeposit, { id: sessionId });
    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    const invs = await invoicesFor(t, sessionId);
    expect(invs).toHaveLength(1);
    expect(invs[0].amountCents).toBe(20_000); // 30k rate - 10k ledgered deposit
  });
});

describe("invoices.sendReminder - authz + throttle", () => {
  const ORG_R = "org_reminders";

  async function seedInvoiceOrg(t: T, artistEmail?: string) {
    return t.run(async (ctx) => {
      await ctx.db.insert("members", { orgId: ORG_R, name: "Owner", role: "owner", skills: [], clerkUserId: "u_own" });
      await ctx.db.insert("members", { orgId: ORG_R, name: "Intern", role: "intern", skills: [], clerkUserId: "u_int" });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG_R, name: "Nova", type: "artist", email: artistEmail,
        genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const invoiceId = await ctx.db.insert("invoices", {
        orgId: ORG_R, number: "PLS-000001", artistId, status: "sent",
        lineItems: [{ label: "Tracking - balance", amountCents: 25_000 }],
        amountCents: 25_000, dueDate: Date.now() + 86_400_000,
      });
      return invoiceId;
    });
  }

  it("emails the client, stamps the throttle, and logs activity", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedInvoiceOrg(t, "nova@x.com");
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    const res = await asOwner.mutation(api.invoices.sendReminder, { id: invoiceId });
    expect(res.emailed).toBe(true);

    const inv = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv!.overdueNotifiedAt).toBeGreaterThan(0);

    const notes = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "invoice.reminder"),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].recipient).toBe("nova@x.com");
    expect(notes[0].body).toContain(`/pay/invoice/${invoiceId}`);
  });

  it("refuses a second reminder inside 24 hours", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedInvoiceOrg(t, "nova@x.com");
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    await asOwner.mutation(api.invoices.sendReminder, { id: invoiceId });
    await expect(
      asOwner.mutation(api.invoices.sendReminder, { id: invoiceId }),
    ).rejects.toThrow(/24 hours/);
  });

  it("allows a fresh reminder once the 24h window has passed", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedInvoiceOrg(t, "nova@x.com");
    await t.run((ctx) => ctx.db.patch(invoiceId, { overdueNotifiedAt: Date.now() - 25 * HOUR }));
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    const res = await asOwner.mutation(api.invoices.sendReminder, { id: invoiceId });
    expect(res.emailed).toBe(true);
  });

  it("denies a role without invoices.send", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedInvoiceOrg(t, "nova@x.com");
    const asIntern = t.withIdentity({ subject: "u_int", name: "Intern", orgId: ORG_R });

    await expect(
      asIntern.mutation(api.invoices.sendReminder, { id: invoiceId }),
    ).rejects.toThrow();
  });

  it("rejects reminders on draft invoices", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedInvoiceOrg(t, "nova@x.com");
    await t.run((ctx) => ctx.db.patch(invoiceId, { status: "draft" }));
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    await expect(
      asOwner.mutation(api.invoices.sendReminder, { id: invoiceId }),
    ).rejects.toThrow(/sent, viewed, or overdue/);
  });

  it("reports emailed:false (and skips the throttle stamp) when the client has no email", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedInvoiceOrg(t); // artist without an email
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    const res = await asOwner.mutation(api.invoices.sendReminder, { id: invoiceId });
    expect(res.emailed).toBe(false);
    const inv = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv!.overdueNotifiedAt).toBeUndefined();
  });
});

describe("internal bookings get payment emails but never lifecycle automation", () => {
  it("sends the deposit pay link once to an internal booking", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" } as never),
    );
    const artistId = await seedArtist(t, ORG, "nova@x.com");
    const sessionId = await seedSession(t, artistId, {
      status: "tentative",
      startTime: Date.now() + 24 * HOUR,
      endTime: Date.now() + 26 * HOUR,
    });

    await t.mutation(api.automation.runNow, {});
    await t.mutation(api.automation.runNow, {}); // second sweep: no duplicate

    const notes = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "booking.deposit_link"),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].recipient).toBe("nova@x.com");
    expect(notes[0].body).toContain(`/book/demo/checkout/${sessionId}`);

    // The internal hold is untouched - no auto-cancel for internal sessions.
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("tentative");
  });

  it("never releases or forfeits an internal session, even past its window", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" } as never),
    );
    const artistId = await seedArtist(t, ORG, "nova@x.com");
    // Confirmed internal session inside the 2h forfeit window, unpaid.
    const sessionId = await seedSession(t, artistId, {
      status: "confirmed",
      startTime: Date.now() + HOUR,
      endTime: Date.now() + 3 * HOUR,
    });

    await t.mutation(api.automation.runNow, {});

    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("confirmed"); // a public booking would have forfeited
  });
});
