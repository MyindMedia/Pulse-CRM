import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* Credit Approval: imported credits stay inside the Studio until an owner or
   manager approves them, and only approved ones reach the public booking page. */

async function seed() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "org1", name: "Studio One", slug: "studio-one", tier: "growth", status: "active" });
    await ctx.db.insert("orgs", { orgId: "org2", name: "Studio Two", slug: "studio-two", tier: "growth", status: "active" });
    await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: "u_owner", bio: "Owner" });
    const ace = await ctx.db.insert("members", { orgId: "org1", name: "Ace", role: "engineer", skills: [], clerkUserId: "u_ace" });
    await ctx.db.insert("members", { orgId: "org1", name: "Bea", role: "engineer", skills: [], clerkUserId: "u_bea" });
    await ctx.db.insert("members", { orgId: "org2", name: "Other Owner", role: "owner", skills: [], clerkUserId: "u_other" });
    const artistId = await ctx.db.insert("artists", {
      orgId: "org1", name: "Travis Scott", type: "artist", genres: [], tags: [], status: "dormant",
      lifetimeValueCents: 0, sessionCount: 0, reliability: "solid", catalogOnly: true,
    });
    const songId = await ctx.db.insert("songs", {
      orgId: "org1", title: "SICKO MODE", artistId, kind: "single", stage: "released",
      moodTags: [], referenceTracks: [], revisionsIncluded: 0, revisionsUsed: 0, importedAt: 1,
    });
    const producer = await ctx.db.insert("importedCredits", {
      orgId: "org1", memberId: ace, songId, role: "Producer", source: "genius", approved: false, createdAt: 1,
    });
    const mix = await ctx.db.insert("importedCredits", {
      orgId: "org1", memberId: ace, songId, role: "Mix Engineer", source: "genius", approved: false, createdAt: 1,
    });
    return { ace, producer, mix };
  });
  const as = (user: string, orgId = "org1") => t.withIdentity({ subject: user, name: user, orgId });
  return { t, as, ...ids };
}

const aceOnFront = async (t: ReturnType<typeof convexTest>) =>
  (await t.query(api.booking.studioFront, { slug: "studio-one" }))?.engineers?.find((e) => e.name === "Ace");

describe("Credit Approval", () => {
  it("keeps unapproved credits off the public booking page", async () => {
    const { t } = await seed();
    expect(await aceOnFront(t)).toBeUndefined();
  });

  it("shows approved credits, one line per song, labelled with role and source", async () => {
    const { t, as, ace, producer, mix } = await seed();
    await as("u_owner").mutation(api.importedCredits.approve, { memberId: ace, creditIds: [producer, mix], approved: true });
    expect((await aceOnFront(t))?.credits).toEqual(["Travis Scott - SICKO MODE (Producer, Mix Engineer, via Genius)"]);

    await as("u_owner").mutation(api.importedCredits.approve, { memberId: ace, creditIds: [producer, mix], approved: false });
    expect(await aceOnFront(t)).toBeUndefined();
  });

  it("lets only an owner or manager approve, and never across studios", async () => {
    const { t, as, ace, producer } = await seed();
    await expect(
      as("u_ace").mutation(api.importedCredits.approve, { memberId: ace, creditIds: [producer], approved: true }),
    ).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
    const other = await as("u_other", "org2").mutation(api.importedCredits.approve, {
      memberId: ace, creditIds: [producer], approved: true,
    });
    expect(other.changed).toBe(0);
    expect(await aceOnFront(t)).toBeUndefined();
  });

  it("shows a Member their own credits but not a teammate's", async () => {
    const { as, ace } = await seed();
    expect((await as("u_ace").query(api.importedCredits.forMember, { memberId: ace }))?.credits).toHaveLength(2);
    expect(await as("u_bea").query(api.importedCredits.forMember, { memberId: ace })).toBeNull();
    expect((await as("u_owner").query(api.importedCredits.forMember, { memberId: ace }))?.canApprove).toBe(true);
  });
});
