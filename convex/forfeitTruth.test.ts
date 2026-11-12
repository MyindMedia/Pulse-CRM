import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { clientPolicyText } from "./lib/clientPolicy";

/* client-messages-forfeit-terms-never-shown: the forfeit and no-show emails
   speak about a deposit and a policy. They must not claim a deposit that was
   never paid or an invoice that was never sent, and the public booking page
   must show the cancellation rule the no-show email quotes. */
const ORG = "forfeit_org";
const HOUR = 3_600_000;

async function seed(t: ReturnType<typeof convexTest>, session: Record<string, unknown>, org: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Truth Studio", slug: "truth", tier: "growth", status: "active", ownerEmail: "owner@t.test", ...org } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Owner", role: "owner", skills: [], clerkUserId: "u_own" } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Client", type: "artist", email: "client@t.test",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    return await ctx.db.insert("sessions", {
      orgId: ORG, title: "Late Mix", artistId, serviceType: "recording", source: "public_booking",
      startTime: Date.now() + HOUR, endTime: Date.now() + 3 * HOUR,
      status: "confirmed", rateCents: 20_000, depositCents: 6_000, depositPaid: false, intakeCompleted: false,
      ...session,
    } as never);
  });
}

const forfeitMail = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).find((n) => n.kind === "booking.forfeited" && n.recipient === "client@t.test"),
  );

describe("forfeit and no-show emails", () => {
  it("does not mention a deposit when nothing was paid", async () => {
    const t = convexTest(schema);
    await seed(t, { depositPaid: false });
    await t.mutation(internal.automation.tick, {});
    const mail = await forfeitMail(t);
    expect(mail?.body).toContain("booking was released");
    expect(mail?.body).not.toMatch(/deposit/i);
    expect(mail?.body).not.toMatch(/booking terms/i);
  });

  it("names the amount kept when the client paid", async () => {
    const t = convexTest(schema);
    await seed(t, { depositPaid: true, amountPaidCents: 6_000 });
    await t.mutation(internal.automation.tick, {});
    const mail = await forfeitMail(t);
    expect(mail?.body).toContain("The $60 you paid is kept by the studio.");
  });

  it("the no-show email does not say an invoice was sent while it is a draft", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { startTime: Date.now() + 10 * HOUR, endTime: Date.now() + 12 * HOUR }, { cancellationWindowHours: 24, cancellationFeePct: 50 });
    await t.withIdentity({ subject: "u_own", orgId: ORG }).mutation(api.sessions.setStatus, { id, status: "no_show" });
    const mail = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).find((n) => n.kind === "session.no_show_fee"),
    );
    expect(mail?.body).not.toContain("We have sent an invoice");
    expect(mail?.body).toContain("The studio will send you an invoice for the $100 balance.");
  });
});

describe("booking page policy line", () => {
  it("states the 2h balance rule and the studio's cancellation fee by default", () => {
    const text = clientPolicyText({ cancellationWindowHours: 24, cancellationFeePct: 50 });
    expect(text).toContain("at least 2 hours before your session");
    expect(text).toContain("If you cancel within 24 hours of the start or do not show up, the deposit is kept and a fee of 50% of the booking applies");
  });

  it("keeps the studio's own text and adds its cancellation rule", () => {
    expect(clientPolicyText({ depositPolicyText: "30% holds it.", cancellationFeePct: 25 })).toBe(
      "30% holds it. If you do not show up, the deposit is kept and a fee of 25% of the booking applies (the deposit counts toward it).",
    );
    expect(clientPolicyText({ depositPolicyText: "30% holds it." })).toBe("30% holds it.");
  });

  it("is what the public studio page returns", async () => {
    const t = convexTest(schema);
    await seed(t, {}, { cancellationWindowHours: 48, cancellationFeePct: 100 });
    const front = await t.query(api.booking.studioFront, { slug: "truth" } as never);
    expect(front?.org.depositPolicy).toContain("If you cancel within 48 hours");
  });
});

/* R16/R17: the default policy said "A deposit holds your slot ... the deposit
   is kept" on paid-in-full and 0% deposit rooms, which take no deposit. */
describe("booking page policy line per room", () => {
  async function roomPolicy(room: Record<string, unknown>) {
    const t = convexTest(schema);
    const roomId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Truth Studio", slug: "truth", tier: "growth", status: "active", ownerEmail: "owner@t.test" } as never);
      return await ctx.db.insert("rooms", {
        orgId: ORG, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30, ...room,
      } as never);
    });
    const page = await t.query(api.booking.room, { roomId } as never);
    return (page as { depositPolicy: string | null } | null)?.depositPolicy ?? null;
  }

  it("a paid-in-full room says payment in full confirms it, with no deposit", async () => {
    const text = await roomPolicy({ paymentMode: "full" });
    expect(text).toContain("Payment in full confirms your booking.");
    expect(text).not.toContain("deposit");
  });

  it("a 0% deposit room states only the 2h balance rule", async () => {
    const text = await roomPolicy({ depositPct: 0 });
    expect(text).toContain("at least 2 hours before your session");
    expect(text).not.toContain("deposit holds");
    expect(text).not.toContain("deposit is kept");
  });

  it("a deposit room keeps the deposit wording", async () => {
    expect(await roomPolicy({})).toContain("A deposit holds your slot");
  });

  it("studio-wide wording does not depend on a room", () => {
    const text = clientPolicyText({});
    expect(text).not.toContain("A deposit holds your slot");
    expect(text).toContain("at least 2 hours before your session");
    expect(clientPolicyText({ cancellationFeePct: 50 }, { depositPct: 0 })).toBe(
      "No deposit is needed. Pay the balance at least 2 hours before your session, or the booking is released. If you do not show up, a fee of 50% of the booking applies.",
    );
  });
});
