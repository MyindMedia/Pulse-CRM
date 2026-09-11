import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api } from "./_generated/api";

/* A refusal has to say why, in production too.
 *
 * A production deployment hides the text of a plain thrown Error from every
 * client and sends "Server Error" instead. The phone files that as the reason a
 * write was refused, so a payment refused because the booking was already paid
 * read "Server Error", looked like a blip, and was retried four times. Only a
 * ConvexError's data reaches a client, so every mutation's refusal is sent as
 * one (convex/functions.ts). */

async function studio() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Skyline", slug: "demo", plan: "studio", status: "active" });
    await ctx.db.insert("members", {
      orgId: "pulse-demo", name: "Olu", role: "owner", email: "o@x.com", skills: [], clerkUserId: "user_owner",
    });
    const artistId = await ctx.db.insert("artists", {
      orgId: "pulse-demo", name: "Nova", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const sessionId = await ctx.db.insert("sessions", {
      orgId: "pulse-demo", title: "Mix", artistId, serviceType: "mixing",
      startTime: Date.now() + 3_600_000, endTime: Date.now() + 7_200_000, status: "confirmed",
      rateCents: 10000, depositCents: 2000, depositPaid: true, amountPaidCents: 10000, intakeCompleted: true,
    });
    return { sessionId };
  });
  return { t, owner: t.withIdentity({ subject: "user_owner", name: "Olu" }), ...ids };
}

async function refusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (err) {
    return err;
  }
  throw new Error("expected the write to be refused");
}

describe("refusal reasons reach the app", () => {
  it("a payment on a booking paid in full says so", async () => {
    const { owner, sessionId } = await studio();
    const err = await refusal(owner.mutation(api.payments.record, { sessionId, kind: "balance", provider: "simulated" }));
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe("This booking is already paid in full.");
  });

  it("a pay link to a client with no phone says so", async () => {
    const { owner, sessionId } = await studio();
    const err = await refusal(owner.mutation(api.sessions.sendPayLinkSms, { id: sessionId }));
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe("No phone number on file for this client.");
  });
});
