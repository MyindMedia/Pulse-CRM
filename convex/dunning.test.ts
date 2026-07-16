import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Dunning ladder - the automated escalating overdue-invoice reminders in
   automation.ts, plus reminder-driven collection attribution in invoices.ts.

   The ladder reads Date.now() internally, so tests force the day-overdue
   thresholds by back-dating dueDate, and drive the >=24h min-gap by
   back-dating overdueNotifiedAt (the shared last-send stamp). */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORG = "pulse-demo"; // the no-identity demo viewer resolves here

type T = ReturnType<typeof convexTest>;

async function seedOrg(t: T) {
  await t.run((ctx) =>
    ctx.db.insert("orgs", {
      orgId: ORG,
      name: "Skyline",
      slug: "demo",
      plan: "studio",
      status: "active",
      ownerEmail: "owner@studio.com",
    } as never),
  );
}

async function seedArtist(t: T, email?: string) {
  return t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId: ORG,
      name: "Nova",
      type: "artist",
      email,
      genres: [],
      tags: [],
      status: "active",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
    }),
  );
}

async function seedInvoice(
  t: T,
  artistId: Id<"artists">,
  overrides: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("invoices", {
      orgId: ORG,
      number: "PLS-000001",
      artistId,
      status: "sent",
      lineItems: [{ label: "Tracking - balance", amountCents: 25_000 }],
      amountCents: 25_000,
      dueDate: Date.now() - 3.5 * DAY,
      ...overrides,
    } as never),
  );
}

async function dunningNotes(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter(
      (n) => n.kind === "invoice.dunning" && n.channel === "email" && n.recipient === "nova@x.com",
    ),
  );
}

async function getInvoice(t: T, id: Id<"invoices">) {
  return t.run((ctx) => ctx.db.get(id));
}

describe("dunning ladder - staged overdue reminders", () => {
  it("progresses 1 -> 2 -> 3 at the 3/7/14-day thresholds, one stage per sweep, then stops", async () => {
    const t = convexTest(schema);
    await seedOrg(t);
    const artistId = await seedArtist(t, "nova@x.com");
    const invoiceId = await seedInvoice(t, artistId, { dueDate: Date.now() - 3.5 * DAY });

    // Sweep 1 - crosses the 3-day threshold -> stage 1 (friendly).
    await t.mutation(api.automation.runNow, {});
    let inv = await getInvoice(t, invoiceId);
    expect(inv!.status).toBe("overdue");
    expect(inv!.reminderStage).toBe(1);
    let notes = await dunningNotes(t);
    expect(notes).toHaveLength(1);
    expect(notes[0].subject).toContain("Reminder:");
    expect(notes[0].body).toContain(`/pay/invoice/${invoiceId}`);

    // Age to 7+ days overdue and clear the min-gap -> stage 2 (firmer).
    await t.run((ctx) =>
      ctx.db.patch(invoiceId, {
        dueDate: Date.now() - 7.5 * DAY,
        overdueNotifiedAt: Date.now() - 25 * HOUR,
      }),
    );
    await t.mutation(api.automation.runNow, {});
    inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(2);
    notes = await dunningNotes(t);
    expect(notes).toHaveLength(2);
    expect(notes[1].subject).toContain("Second notice");

    // Age to 14+ days overdue and clear the min-gap -> stage 3 (final).
    await t.run((ctx) =>
      ctx.db.patch(invoiceId, {
        dueDate: Date.now() - 14.5 * DAY,
        overdueNotifiedAt: Date.now() - 25 * HOUR,
      }),
    );
    await t.mutation(api.automation.runNow, {});
    inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(3);
    notes = await dunningNotes(t);
    expect(notes).toHaveLength(3);
    expect(notes[2].subject).toContain("Final notice");
    expect(notes[2].body).toContain("significantly past due");

    // Ladder is exhausted - further sweeps never send a 4th reminder.
    await t.run((ctx) =>
      ctx.db.patch(invoiceId, { overdueNotifiedAt: Date.now() - 25 * HOUR }),
    );
    await t.mutation(api.automation.runNow, {});
    inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(3);
    notes = await dunningNotes(t);
    expect(notes).toHaveLength(3);
  });

  it("does not send two stages in one sweep even when several thresholds are met", async () => {
    const t = convexTest(schema);
    await seedOrg(t);
    const artistId = await seedArtist(t, "nova@x.com");
    // 8 days overdue: both the 3-day and 7-day thresholds are already met.
    const invoiceId = await seedInvoice(t, artistId, { dueDate: Date.now() - 8 * DAY });

    await t.mutation(api.automation.runNow, {});
    let inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(1); // only stage 1, never jumps to 2
    let notes = await dunningNotes(t);
    expect(notes).toHaveLength(1);

    // Immediate re-sweep inside the 24h gap: no second stage, no duplicate.
    await t.mutation(api.automation.runNow, {});
    inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(1);
    notes = await dunningNotes(t);
    expect(notes).toHaveLength(1);

    // Clear the min-gap -> now stage 2 fires.
    await t.run((ctx) =>
      ctx.db.patch(invoiceId, { overdueNotifiedAt: Date.now() - 25 * HOUR }),
    );
    await t.mutation(api.automation.runNow, {});
    inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(2);
    notes = await dunningNotes(t);
    expect(notes).toHaveLength(2);
  });

  it("respects the 24h min-gap shared with a manual reminder", async () => {
    const t = convexTest(schema);
    await seedOrg(t);
    const artistId = await seedArtist(t, "nova@x.com");
    // Overdue past the stage-1 threshold, but a manual nudge just went out.
    const invoiceId = await seedInvoice(t, artistId, {
      dueDate: Date.now() - 4 * DAY,
      status: "overdue",
      overdueNotifiedAt: Date.now() - 2 * HOUR,
    });

    await t.mutation(api.automation.runNow, {});
    let inv = await getInvoice(t, invoiceId);
    // Manual nudge inside 24h suppresses the auto stage-1 send.
    expect(inv!.reminderStage ?? 0).toBe(0);
    let notes = await dunningNotes(t);
    expect(notes).toHaveLength(0);

    // Once 24h has passed, the ladder resumes.
    await t.run((ctx) =>
      ctx.db.patch(invoiceId, { overdueNotifiedAt: Date.now() - 25 * HOUR }),
    );
    await t.mutation(api.automation.runNow, {});
    inv = await getInvoice(t, invoiceId);
    expect(inv!.reminderStage).toBe(1);
    notes = await dunningNotes(t);
    expect(notes).toHaveLength(1);
  });

  it("does not remind before the 3-day stage-1 threshold", async () => {
    const t = convexTest(schema);
    await seedOrg(t);
    const artistId = await seedArtist(t, "nova@x.com");
    // Only 1 day overdue - the status materializes but no reminder yet.
    const invoiceId = await seedInvoice(t, artistId, { dueDate: Date.now() - 1 * DAY });

    await t.mutation(api.automation.runNow, {});
    const inv = await getInvoice(t, invoiceId);
    expect(inv!.status).toBe("overdue");
    expect(inv!.reminderStage ?? 0).toBe(0);
    const notes = await dunningNotes(t);
    expect(notes).toHaveLength(0);
  });
});

describe("reminder-driven collection attribution", () => {
  const ORG_R = "org_collect";

  async function seedCollectInvoice(t: T, reminderStage?: number) {
    return t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: ORG_R,
        name: "Owner",
        role: "owner",
        skills: [],
        clerkUserId: "u_own",
      });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG_R,
        name: "Rio",
        type: "artist",
        email: "rio@x.com",
        genres: [],
        tags: [],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
      });
      return ctx.db.insert("invoices", {
        orgId: ORG_R,
        number: "PLS-000042",
        artistId,
        status: "overdue",
        lineItems: [{ label: "Mixing", amountCents: 40_000 }],
        amountCents: 40_000,
        dueDate: Date.now() - 10 * DAY,
        reminderStage,
      });
    });
  }

  async function recoveryEvents(t: T) {
    return t.run((ctx) => ctx.db.query("recoveryEvents").collect());
  }

  it("records reminder_collected when a reminded invoice is paid", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedCollectInvoice(t, 2);
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    await asOwner.mutation(api.invoices.setStatus, { id: invoiceId, status: "paid", paymentMethod: "zelle" });

    const events = await recoveryEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("reminder_collected");
    expect(events[0].amountCents).toBe(40_000);
    expect(events[0].invoiceId).toBe(invoiceId);
  });

  it("does NOT record when the invoice was never reminded (reminderStage 0)", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedCollectInvoice(t); // no reminderStage
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    await asOwner.mutation(api.invoices.setStatus, { id: invoiceId, status: "paid", paymentMethod: "zelle" });

    const events = await recoveryEvents(t);
    expect(events).toHaveLength(0);
  });

  it("does not double-record when a paid invoice is re-saved as paid", async () => {
    const t = convexTest(schema);
    const invoiceId = await seedCollectInvoice(t, 1);
    const asOwner = t.withIdentity({ subject: "u_own", name: "Owner", orgId: ORG_R });

    await asOwner.mutation(api.invoices.setStatus, { id: invoiceId, status: "paid", paymentMethod: "zelle" });
    await asOwner.mutation(api.invoices.setStatus, { id: invoiceId, status: "paid", paymentMethod: "zelle" });

    const events = await recoveryEvents(t);
    expect(events).toHaveLength(1);
  });
});
