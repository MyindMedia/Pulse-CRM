import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { TierKey } from "./lib/pricing";

/* Catalog Import: the destination check, the plan gate, and the per-song
   create-or-merge (ISRC first, then title + artist), with catalog artists
   kept out of the client roster. */

async function studio(t: ReturnType<typeof convexTest>, orgId: string, tier: TierKey, user = `u_${orgId}`, role = "owner") {
  const memberId = await t.run(async (ctx) => {
    const existing = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === orgId);
    if (!existing) await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier, status: "active" });
    return ctx.db.insert("members", { orgId, name: `Member ${user}`, role: role as "owner", skills: [], clerkUserId: user });
  });
  return { as: t.withIdentity({ subject: user, name: user, orgId }), memberId };
}

const MIKE = { source: "genius" as const, sourceId: "123", name: "Mike Dean" };

async function job(t: ReturnType<typeof convexTest>, orgId: string, memberId: Id<"members">) {
  return t.run(async (ctx) => {
    const identityId = await ctx.db.insert("creditIdentities", {
      orgId, subjectKind: "member", subjectId: memberId, source: "genius", sourceId: "123", name: "Mike Dean", createdAt: 0,
    });
    return ctx.db.insert("catalogImports", {
      orgId, subjectKind: "member", subjectId: memberId, identityIds: [identityId], roles: ["Producer"],
      status: "importing", found: 0, imported: 0, merged: 0, failed: 0, skipped: 0, capped: 0,
      startedBy: "u", startedAt: 0,
    });
  });
}

async function item(t: ReturnType<typeof convexTest>, orgId: string, importId: Id<"catalogImports">) {
  return t.run((ctx) =>
    ctx.db.insert("catalogImportItems", {
      orgId, importId, title: "x", roles: ["Producer"], sources: ["genius"], refs: {}, state: "pending",
    }),
  );
}

const song = (over: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  song: {
    title: "SICKO MODE",
    artistName: "Travis Scott feat. Drake",
    isrc: "USSM11806295",
    roles: ["Producer"],
    credits: [{ name: "Mike Dean", role: "Producer" }],
    ...over,
  },
});

describe("start", () => {
  it("refuses a workspace the caller has no seat in", async () => {
    const t = convexTest(schema);
    const { as } = await studio(t, "org_a", "growth");
    await studio(t, "org_b", "growth");
    await expect(
      as.mutation(api.catalogImport.start, {
        destinationOrgId: "org_b", subject: { kind: "member" }, roles: ["Producer"], identities: [MIKE],
      }),
    ).rejects.toMatchObject({ data: { code: "SCOPE_DENIED" } });
    const rows = await t.run((ctx) => ctx.db.query("catalogImports").collect());
    expect(rows).toHaveLength(0);
  });

  it("refuses a Core destination and allows Growth, writing only there", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "org_core", "core", "u_lb");
    await studio(t, "org_growth", "growth", "u_lb");
    await expect(
      core.as.mutation(api.catalogImport.start, {
        destinationOrgId: "org_core", subject: { kind: "member" }, roles: ["Producer"], identities: [MIKE],
      }),
    ).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });

    // Same person, picking their Growth workspace as the destination.
    const { importId } = await core.as.mutation(api.catalogImport.start, {
      destinationOrgId: "org_growth", subject: { kind: "member" }, roles: ["Producer", "Bogus"], identities: [MIKE],
    });
    const { imports, identities } = await t.run(async (ctx) => ({
      imports: await ctx.db.query("catalogImports").collect(),
      identities: await ctx.db.query("creditIdentities").collect(),
    }));
    expect(imports.map((i) => [i._id, i.orgId, i.roles])).toEqual([[importId, "org_growth", ["Producer"]]]);
    expect(identities.map((i) => i.orgId)).toEqual(["org_growth"]);
  });

  it("refuses a second running import for the same person", async () => {
    const t = convexTest(schema);
    const { as } = await studio(t, "org_g", "growth");
    const args = { destinationOrgId: "org_g", subject: { kind: "member" as const }, roles: ["Producer"], identities: [MIKE] };
    await as.mutation(api.catalogImport.start, args);
    await expect(as.mutation(api.catalogImport.start, args)).rejects.toMatchObject({ data: { code: "IMPORT_RUNNING" } });
  });

  it("lets only an owner or manager import a roster artist", async () => {
    const t = convexTest(schema);
    await studio(t, "org_g", "growth");
    const engineer = await studio(t, "org_g", "growth", "u_eng", "engineer");
    const artistId = await t.run((ctx) =>
      ctx.db.insert("artists", {
        orgId: "org_g", name: "Client", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }),
    );
    await expect(
      engineer.as.mutation(api.catalogImport.start, {
        destinationOrgId: "org_g", subject: { kind: "artist", artistId }, roles: ["Artist"], identities: [MIKE],
      }),
    ).rejects.toMatchObject({ data: { code: expect.stringMatching(/CAPABILITY_DENIED|SCOPE_DENIED/) } });
  });
});

describe("_applyItem", () => {
  it("creates a song under a hidden catalog artist, then merges a repeat by ISRC", async () => {
    const t = convexTest(schema);
    const { as, memberId } = await studio(t, "org_g", "growth");
    const importId = await job(t, "org_g", memberId);
    const first = await item(t, "org_g", importId);
    const second = await item(t, "org_g", importId);

    await t.mutation(internal.catalogImport._applyItem, { importId, itemId: first, outcome: song() });
    await t.mutation(internal.catalogImport._applyItem, {
      importId, itemId: second, outcome: song({ title: "Sicko Mode (Explicit)", genre: "Hip-Hop" }),
    });

    const state = await t.run(async (ctx) => ({
      songs: await ctx.db.query("songs").collect(),
      artists: await ctx.db.query("artists").collect(),
      credits: await ctx.db.query("importedCredits").collect(),
      job: await ctx.db.get(importId),
      items: await ctx.db.query("catalogImportItems").collect(),
    }));
    expect(state.songs).toHaveLength(1);
    expect(state.songs[0].isrc).toBe("USSM11806295");
    expect(state.songs[0].creditedMembers).toEqual([memberId]);
    expect(state.songs[0].importedFrom?.importId).toBe(importId);
    expect(state.artists.map((a) => [a.name, a.catalogOnly])).toEqual([["Travis Scott", true]]);
    expect(state.credits.map((c) => [c.role, c.approved])).toEqual([["Producer", false]]);
    expect(state.job).toMatchObject({ imported: 1, merged: 1 });
    expect(state.items.map((i) => i.state).sort()).toEqual(["imported", "merged"]);
    expect(state.songs[0].stage).toBe("released");
    expect(state.songs[0].genre).toBe("Hip-Hop"); // the merge filled a blank

    // A drafted split sheet carries the imported credits.
    const sheets = await t.run((ctx) => ctx.db.query("splitSheets").collect());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].status).toBe("draft");
    expect(sheets[0].contributors.map((c) => c.name)).toContain("Mike Dean");

    // The catalog artist is not a client.
    expect(await as.query(api.artists.list, {})).toEqual([]);
    expect(await as.query(api.artists.roster, {})).toEqual([]);
  });

  it("merges by title and artist into an existing client song and credits a second member", async () => {
    const t = convexTest(schema);
    const owner = await studio(t, "org_g", "growth");
    const second = await studio(t, "org_g", "growth", "u_two", "engineer");
    const { songId } = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "org_g", name: "Travis Scott", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const songId = await ctx.db.insert("songs", {
        orgId: "org_g", title: "SICKO MODE", artistId, kind: "single", stage: "mixing",
        moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
      });
      return { songId };
    });

    const a = await job(t, "org_g", owner.memberId);
    await t.mutation(internal.catalogImport._applyItem, {
      importId: a, itemId: await item(t, "org_g", a), outcome: song({ isrc: undefined }),
    });
    const b = await job(t, "org_g", second.memberId);
    await t.mutation(internal.catalogImport._applyItem, {
      importId: b, itemId: await item(t, "org_g", b), outcome: song({ isrc: undefined, roles: ["Producer", "Mix Engineer"] }),
    });

    const { songs, artists, credits } = await t.run(async (ctx) => ({
      songs: await ctx.db.query("songs").collect(),
      artists: await ctx.db.query("artists").collect(),
      credits: await ctx.db.query("importedCredits").collect(),
    }));
    expect(songs).toHaveLength(1);
    expect(songs[0]._id).toBe(songId);
    expect(songs[0].stage).toBe("mixing"); // a merge never moves the client's song
    expect(songs[0].creditedMembers).toEqual([owner.memberId, second.memberId]);
    expect(artists).toHaveLength(1);
    // Only roles the import asked for become credits (job roles = Producer).
    expect(credits.map((c) => [c.memberId, c.role])).toEqual([
      [owner.memberId, "Producer"],
      [second.memberId, "Producer"],
    ]);
  });

  it("never matches a song in another workspace", async () => {
    const t = convexTest(schema);
    const g = await studio(t, "org_g", "growth");
    await studio(t, "org_other", "growth");
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "org_other", name: "Travis Scott", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      await ctx.db.insert("songs", {
        orgId: "org_other", title: "SICKO MODE", artistId, isrc: "USSM11806295", kind: "single", stage: "released",
        moodTags: [], referenceTracks: [], revisionsIncluded: 0, revisionsUsed: 0,
      });
    });
    const importId = await job(t, "org_g", g.memberId);
    await t.mutation(internal.catalogImport._applyItem, { importId, itemId: await item(t, "org_g", importId), outcome: song() });
    const { mine, theirs } = await t.run(async (ctx) => ({
      mine: await ctx.db.query("songs").withIndex("by_org_isrc", (q) => q.eq("orgId", "org_g")).collect(),
      theirs: await ctx.db.query("songs").withIndex("by_org_isrc", (q) => q.eq("orgId", "org_other")).collect(),
    }));
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].creditedMembers).toBeUndefined();
  });

  it("counts skips and failures without touching songs", async () => {
    const t = convexTest(schema);
    const { memberId } = await studio(t, "org_g", "growth");
    const importId = await job(t, "org_g", memberId);
    await t.mutation(internal.catalogImport._applyItem, {
      importId, itemId: await item(t, "org_g", importId), outcome: { kind: "skip", reason: "Not credited in a chosen role" },
    });
    await t.mutation(internal.catalogImport._applyItem, {
      importId, itemId: await item(t, "org_g", importId), outcome: { kind: "fail", reason: "No artist" },
    });
    const { songs, row } = await t.run(async (ctx) => ({
      songs: await ctx.db.query("songs").collect(),
      row: await ctx.db.get(importId),
    }));
    expect(songs).toHaveLength(0);
    expect(row).toMatchObject({ skipped: 1, failed: 1, imported: 0 });
  });
});

describe("songs.list origin filter", () => {
  it("separates imported songs from studio songs", async () => {
    const t = convexTest(schema);
    const { as, memberId } = await studio(t, "org_g", "growth");
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "org_g", name: "Client", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      await ctx.db.insert("songs", {
        orgId: "org_g", title: "Studio Song", artistId, kind: "single", stage: "mixing",
        moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
      });
    });
    const importId = await job(t, "org_g", memberId);
    await t.mutation(internal.catalogImport._applyItem, { importId, itemId: await item(t, "org_g", importId), outcome: song() });

    const all = await as.query(api.songs.list, {});
    const imported = await as.query(api.songs.list, { origin: "imported" });
    const studioOnly = await as.query(api.songs.list, { origin: "studio" });
    const releasedImported = await as.query(api.songs.list, { origin: "imported", stage: "released" });
    expect(all).toHaveLength(2);
    expect(imported.map((s) => [s.title, s.imported])).toEqual([["SICKO MODE", true]]);
    expect(studioOnly.map((s) => [s.title, s.imported])).toEqual([["Studio Song", false]]);
    expect(releasedImported).toHaveLength(1);
  });
});
