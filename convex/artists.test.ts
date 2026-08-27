import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

describe("artists", () => {
  let t: ReturnType<typeof convexTest>;
  let artist: Id<"artists">;

  beforeEach(async () => {
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "studio", status: "active",
      });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      await ctx.db.insert("members", { orgId: "org1", name: "Intern", role: "intern", clerkUserId: "u2", skills: [] });
      const artist = await ctx.db.insert("artists", {
        orgId: "org1", name: "Sky", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return { artist };
    });
    artist = ids.artist;
  });

  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
  const intern = () => t.withIdentity({ subject: "u2", name: "Intern", orgId: "org1" });

  it("okToFeature is unset by default and round-trips through update", async () => {
    expect((await owner().query(api.artists.get, { id: artist }))?.okToFeature).toBeUndefined();

    await owner().mutation(api.artists.update, { id: artist, okToFeature: true });
    expect((await owner().query(api.artists.get, { id: artist }))?.okToFeature).toBe(true);

    await owner().mutation(api.artists.update, { id: artist, okToFeature: false });
    expect((await owner().query(api.artists.get, { id: artist }))?.okToFeature).toBe(false);
  });

  it("update requires artists.edit, so an intern cannot flip okToFeature", async () => {
    await expect(
      intern().mutation(api.artists.update, { id: artist, okToFeature: true }),
    ).rejects.toThrow();
    expect((await owner().query(api.artists.get, { id: artist }))?.okToFeature).toBeUndefined();
  });
});
