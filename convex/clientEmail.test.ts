import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* P4 email — provider choice + internal send + Google connect guards.
   (No GOOGLE_CLIENT_ID / RESEND_API_KEY in tests → internal send is simulated.) */
describe("client email + google connect", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.RESEND_API_KEY;
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Skyline", slug: "skyline", plan: "studio", status: "active" });
    });
  });

  it("emailStatus defaults to the internal channel", async () => {
    const s = await t.query(api.clientEmail.emailStatus, {});
    expect(s.provider).toBe("internal");
    expect(s.googleConnected).toBe(false);
  });

  it("setProvider('google') is refused until Google is connected", async () => {
    await expect(t.mutation(api.clientEmail.setProvider, { provider: "google" })).rejects.toThrow(/connect your google/i);
  });

  it("sendToClient sends on the internal channel to a client with an email", async () => {
    const artistId = await t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", email: "nova@client.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0,
        sessionCount: 0, reliability: "solid",
      }));
    const res = await t.action(api.clientEmail.sendToClient, {
      artistId, subject: "Your session", body: "See you Friday.",
    });
    expect(res.channel).toBe("internal");
    expect(res.ok).toBe(true);
  });

  it("sendToClient refuses a client with no email", async () => {
    const artistId = await t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "NoEmail", type: "artist",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0,
        sessionCount: 0, reliability: "solid",
      }));
    await expect(t.action(api.clientEmail.sendToClient, { artistId, subject: "x", body: "y" }))
      .rejects.toThrow(/no email/i);
  });

  it("sendToClient logs the message to the client's thread", async () => {
    const artistId = await t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", email: "nova@client.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }));
    await t.action(api.clientEmail.sendToClient, { artistId, subject: "Hi", body: "See you Friday." });
    const thread = await t.query(api.clientEmail.thread, { artistId });
    expect(thread.length).toBe(1);
    expect(thread[0].subject).toBe("Hi");
    expect(thread[0].channel).toBe("internal");
    expect(thread[0].direction).toBe("out");
  });

  it("google status is not-configured + authUrl throws without OAuth creds", async () => {
    const s = await t.query(api.googleAuth.status, {});
    expect(s).toMatchObject({ configured: false, connected: false });
    await expect(t.action(api.googleAuth.authUrl, {})).rejects.toThrow(/configured/i);
  });
});
