import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* client-messages-hold-email-no-link: the hold email asked the client to pay
   within 60 minutes but carried no link (only the text did, and phone is
   optional), called the full price a "deposit" on paid-in-full rooms, and
   asked for a $0.00 deposit on 0% rooms, which the checkout cannot take, so
   the slot was released after an hour. */
const ORG = "org_hold";
const DAY = 86_400_000;
const HOUR = 3_600_000;

async function studio(t: ReturnType<typeof convexTest>, room: Record<string, unknown>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Hold Studio", slug: "hold", tier: "growth", status: "active", ownerEmail: "owner@h.test", directoryListed: true,
    } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Owner", role: "owner", email: "owner@h.test", clerkUserId: "u_own", skills: [] } as never);
    return (await ctx.db.insert("rooms", {
      orgId: ORG, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30, ...room,
    } as never)) as Id<"rooms">;
  });
}

async function bookEmailOnly(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">, startIn = 7 * DAY) {
  const res = await t.mutation(api.booking.createBooking, {
    roomId, clientName: "Nova Client", clientEmail: "nova@x.test", startTime: Date.now() + startIn, durationHours: 2,
  } as never);
  const mail = await t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).find((n) => n.kind === "booking.held" && n.channel === "email"),
  );
  const session = await t.run((ctx) => ctx.db.get(res.sessionId));
  return { mail, session };
}

describe("hold message", () => {
  it("an email-only booker gets the pay link in the email", async () => {
    const t = convexTest(schema);
    const room = await studio(t, {});
    const { mail } = await bookEmailOnly(t, room);
    expect(mail?.body).toContain("Pay the $60 deposit within 60 minutes");
    expect(mail?.body).toContain("/book/hold/checkout/");
  });

  it("a paid-in-full room says payment, not deposit", async () => {
    const t = convexTest(schema);
    const room = await studio(t, { paymentMode: "full" });
    const { mail } = await bookEmailOnly(t, room);
    expect(mail?.body).toContain("Pay $200 within 60 minutes");
    expect(mail?.body).not.toContain("deposit");
  });

  it("a 0% deposit room is booked, not held for a $0 payment", async () => {
    const t = convexTest(schema);
    const room = await studio(t, { depositPct: 0 });
    const { mail, session } = await bookEmailOnly(t, room);
    expect(session?.status).toBe("confirmed");
    expect(session?.holdExpiresAt).toBeUndefined();
    expect(mail?.body).not.toContain("$0");
    expect(mail?.body).toContain("No deposit is needed");
    expect(mail?.body).toContain("/book/hold/checkout/");
  });

  /* R01/R02: a 0% booking confirmed inside 2h (+ one 15-minute cron tick) of
     its start would be forfeited by automation step 4 at the next tick, after
     telling the client they had until 2h before start. Short notice keeps the
     60-minute hold and asks for the full price. */
  it("a 0% deposit room booked under 2h15m before start stays a hold for the full price", async () => {
    const t = convexTest(schema);
    const room = await studio(t, { depositPct: 0 });
    const { mail, session } = await bookEmailOnly(t, room, 2 * HOUR + 10 * 60_000);
    expect(session?.status).toBe("tentative");
    expect(session?.holdExpiresAt).toBeGreaterThan(Date.now());
    expect(mail?.subject).toContain("Hold started");
    expect(mail?.body).toContain("Pay the $200 in full within 60 minutes");
    expect(mail?.body).not.toContain("$0");
  });

  it("a 0% deposit room booked well ahead is confirmed with no hold", async () => {
    const t = convexTest(schema);
    const room = await studio(t, { depositPct: 0 });
    const { session } = await bookEmailOnly(t, room, 2 * HOUR + 20 * 60_000);
    expect(session?.status).toBe("confirmed");
    expect(session?.holdExpiresAt).toBeUndefined();
  });
});

/* client-messages-engineer-finalized: the engineer email said "The booking is
   finalized once you confirm", but the deposit is what confirms a public
   booking. */
describe("engineer request email", () => {
  it("does not tell the engineer their answer finalizes the booking", async () => {
    const t = convexTest(schema);
    const room = await studio(t, {});
    const eng = await t.run((ctx) =>
      ctx.db.insert("members", { orgId: ORG, name: "Eve Engineer", role: "engineer", email: "eng@h.test", clerkUserId: "u_eng", skills: [] } as never),
    );
    await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova Client", clientEmail: "nova@x.test", startTime: Date.now() + 7 * DAY, durationHours: 2, engineerId: eng,
    } as never);
    const mail = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).find((n) => n.kind === "booking.engineer_requested"),
    );
    expect(mail?.body).toBeDefined();
    expect(mail?.body).not.toContain("finalized once you confirm");
    expect(mail?.body).toContain("Confirm so the studio knows you can take it.");
  });
});
