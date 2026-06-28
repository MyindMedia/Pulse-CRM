import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

describe("Studio Brain graph builder - tenant isolation", () => {
  async function seed() {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const mkOrg = (orgId: string, slug: string) =>
        ctx.db.insert("orgs", { orgId, name: slug, slug, plan: "studio", status: "active" });
      const mkArtist = (orgId: string, name: string) =>
        ctx.db.insert("artists", {
          orgId, name, type: "artist", genres: [], tags: [], status: "active",
          lifetimeValueCents: 0, sessionCount: 1, reliability: "solid",
        });
      const mkSession = (orgId: string, artistId: Id<"artists">, title: string) =>
        ctx.db.insert("sessions", {
          orgId, title, artistId, serviceType: "recording",
          startTime: Date.now() + DAY, endTime: Date.now() + DAY + 2 * 3_600_000,
          status: "confirmed", rateCents: 20000, depositCents: 6000, depositPaid: true, intakeCompleted: false,
        });

      await mkOrg("orgA", "A");
      await mkOrg("orgB", "B");
      const aArtist = await mkArtist("orgA", "A Artist");
      const aSession = await mkSession("orgA", aArtist, "A Session");
      const bArtist = await mkArtist("orgB", "B Artist");
      const bSession = await mkSession("orgB", bArtist, "B Session");
      return { aArtist, aSession, bArtist, bSession };
    });
    return { t, ...ids };
  }

  it("builds a graph from only the caller org's data", async () => {
    const { t, aArtist, aSession, bArtist, bSession } = await seed();
    await t.mutation(internal.studioBrain.rebuildOrg, { orgId: "orgA" });

    await t.run(async (ctx) => {
      const nodes = await ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", "orgA")).collect();
      const refs = nodes.map((n) => n.refId);
      // A's entities are present...
      expect(refs).toContain(aArtist);
      expect(refs).toContain(aSession);
      // ...and B's never leak in.
      expect(refs).not.toContain(bArtist);
      expect(refs).not.toContain(bSession);
      // Every node is stamped orgA.
      expect(nodes.every((n) => n.orgId === "orgA")).toBe(true);

      // The booked edge connects A's artist to A's session.
      const edges = await ctx.db.query("studioGraphEdges").withIndex("by_org", (q) => q.eq("orgId", "orgA")).collect();
      expect(edges.some((e) => e.fromRef === aArtist && e.toRef === aSession && e.rel === "booked")).toBe(true);
      // orgB has no graph yet (never rebuilt).
      const bNodes = await ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", "orgB")).collect();
      expect(bNodes).toHaveLength(0);
    });
  });

  it("rebuild is idempotent (no duplicate nodes/edges on re-run)", async () => {
    const { t } = await seed();
    await t.mutation(internal.studioBrain.rebuildOrg, { orgId: "orgA" });
    const after1 = await t.run((ctx) =>
      ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", "orgA")).collect(),
    );
    await t.mutation(internal.studioBrain.rebuildOrg, { orgId: "orgA" });
    const after2 = await t.run((ctx) =>
      ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", "orgA")).collect(),
    );
    expect(after2.length).toBe(after1.length);
  });
});
