import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const HOUR = 3_600_000;

describe("GDPR data rights - export + erasure", () => {
  let t: ReturnType<typeof convexTest>;
  let aArtist: Id<"artists">;
  let aSession: Id<"sessions">;
  let aMessage: Id<"clientMessages">;
  let bArtist: Id<"artists">;

  beforeEach(async () => {
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "orgA", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "orgB", name: "B", slug: "b", plan: "studio", status: "active" });
      // No-identity viewer is the owner of appState.activeOrgId.
      await ctx.db.insert("appState", { key: "demo", activeOrgId: "orgA" });

      const mkArtist = (orgId: string, name: string, email: string) =>
        ctx.db.insert("artists", {
          orgId, name, type: "artist", email, genres: [], tags: ["vip"], status: "active",
          lifetimeValueCents: 50000, sessionCount: 2, reliability: "solid",
        });
      const a = await mkArtist("orgA", "Nova Reign", "nova@x.com");
      const b = await mkArtist("orgB", "Other Person", "other@x.com");
      const sess = await ctx.db.insert("sessions", {
        orgId: "orgA", title: "Nova Reign - Studio A", artistId: a, serviceType: "recording",
        startTime: Date.now() + HOUR, endTime: Date.now() + 3 * HOUR, status: "confirmed",
        rateCents: 20000, depositCents: 6000, depositPaid: true, intakeCompleted: false,
        notes: "Nova Reign prefers the U47.",
      });
      const msg = await ctx.db.insert("clientMessages", {
        orgId: "orgA", artistId: a, direction: "out", subject: "Hi Nova Reign",
        body: "Thanks Nova Reign, see you at nova@x.com", channel: "internal", status: "sent",
      });
      return { a, b, sess, msg };
    });
    aArtist = ids.a;
    bArtist = ids.b;
    aSession = ids.sess;
    aMessage = ids.msg;
  });

  it("exports the subject's data bundle", async () => {
    const data = await t.query(api.dataRights.exportArtist, { artistId: aArtist });
    expect(data).not.toBeNull();
    expect(data!.subject.name).toBe("Nova Reign");
    expect(data!.subject.email).toBe("nova@x.com");
    expect(data!.sessions).toHaveLength(1);
    expect(data!.messages).toHaveLength(1);
  });

  it("anonymizes the client and scrubs their identity from records", async () => {
    const res = await t.mutation(api.dataRights.eraseArtist, { artistId: aArtist });
    expect(res.scrubbed).toBeGreaterThanOrEqual(2);

    await t.run(async (ctx) => {
      const artist = await ctx.db.get(aArtist);
      expect(artist?.name).toMatch(/^Erased client/);
      expect(artist?.email).toBeUndefined();
      expect(artist?.phone).toBeUndefined();
      expect(artist?.erasedAt).toBeTypeOf("number");
      expect(artist?.tags).toEqual([]);

      const session = await ctx.db.get(aSession);
      expect(session?.title).not.toMatch(/Nova Reign/);
      expect(session?.notes).not.toMatch(/Nova Reign/);
      // The session itself is retained (accounting basis).
      expect(session?.rateCents).toBe(20000);

      const msg = await ctx.db.get(aMessage);
      expect(msg?.body).not.toMatch(/Nova Reign/);
      expect(msg?.body).not.toMatch(/nova@x\.com/);

      // An audit event was written.
      const audits = await ctx.db.query("auditEvents").collect();
      expect(audits.some((a) => a.orgId === "orgA" && a.action === "data.erase.artist")).toBe(true);
    });
  });

  it("cannot erase a client in another org (tenant isolation)", async () => {
    // The viewer is owner of orgA only; orgB's client is out of scope.
    await expect(t.mutation(api.dataRights.eraseArtist, { artistId: bArtist })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => {
      const b = await ctx.db.get(bArtist);
      expect(b?.name).toBe("Other Person"); // untouched
      expect(b?.erasedAt).toBeUndefined();
    });
  });

  it("is idempotent - erasing twice is a no-op the second time", async () => {
    await t.mutation(api.dataRights.eraseArtist, { artistId: aArtist });
    const second = await t.mutation(api.dataRights.eraseArtist, { artistId: aArtist });
    expect(second.alreadyErased).toBe(true);
  });
});
