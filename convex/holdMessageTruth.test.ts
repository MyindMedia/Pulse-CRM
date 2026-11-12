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

async function bookEmailOnly(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">) {
  const res = await t.mutation(api.booking.createBooking, {
    roomId, clientName: "Nova Client", clientEmail: "nova@x.test", startTime: Date.now() + 7 * DAY, durationHours: 2,
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
});
