import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* Booking must work for first-time clients, not just existing artists. */
describe("sessions.create — client name vs existing artist", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
  });

  const base = () => ({
    title: "Session",
    serviceType: "recording" as const,
    startTime: Date.now() + 3_600_000,
    endTime: Date.now() + 7_200_000,
    rateCents: 20000,
    depositCents: 6000,
  });

  it("creates a new 'lead' client from a typed name + links the session", async () => {
    await t.mutation(api.sessions.create, {
      ...base(),
      clientName: "Walk-in Wendy",
      clientEmail: "wendy@client.com",
    });
    const artist = await t.run(async (ctx) =>
      (await ctx.db.query("artists").collect()).find((a) => a.name === "Walk-in Wendy"));
    expect(artist).toBeTruthy();
    expect(artist?.status).toBe("lead");
    expect(artist?.email).toBe("wendy@client.com");
    expect(artist?.source).toBe("booking");
    const session = await t.run(async (ctx) =>
      (await ctx.db.query("sessions").collect()).find((s) => s.artistId === artist!._id));
    expect(session).toBeTruthy();
    expect(session?.title).toBe("Session");
  });

  it("uses an existing artist when artistId is given (no duplicate created)", async () => {
    const artistId = await t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }));
    await t.mutation(api.sessions.create, { ...base(), artistId });
    const count = await t.run(async (ctx) => (await ctx.db.query("artists").collect()).length);
    expect(count).toBe(1);
  });

  it("requires either a client name or an artist", async () => {
    await expect(t.mutation(api.sessions.create, base())).rejects.toThrow(/client name|artist/i);
  });
});
