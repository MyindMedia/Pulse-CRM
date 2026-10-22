import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { TierKey } from "./lib/pricing";

/* Royalty Statements: gate, ISRC matching, shares from the signed sheet,
   Unallocated Income released on signing, Unmatched Lines, mark paid. */

const ISRC = "USABC2600001";

async function setup(tier: TierKey = "max", enabled = true) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "ag", name: "Ag", slug: "ag", plan: "max", status: "active",
      ownerClerkUserId: "u_ag", ownerEmail: "o@x", royaltiesEnabled: enabled,
    });
    await ctx.db.insert("orgs", { orgId: "o1", name: "S", slug: "s", tier, status: "active", agencyId: "ag" });
    await ctx.db.insert("orgs", { orgId: "o2", name: "T", slug: "t", tier: "max", status: "active", agencyId: "ag" });
    await ctx.db.insert("members", { orgId: "o1", name: "Owner", role: "owner", skills: [], clerkUserId: "u_owner" });
    await ctx.db.insert("members", { orgId: "o1", name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" });
    await ctx.db.insert("members", { orgId: "o2", name: "Other", role: "owner", skills: [], clerkUserId: "u_other" });
    const artistId = await ctx.db.insert("artists", {
      orgId: "o1", name: "LB", type: "artist", genres: [], tags: [], status: "active",
      lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const songId = await ctx.db.insert("songs", {
      orgId: "o1", title: "Night Drive", artistId, isrc: ISRC, kind: "single", stage: "released",
      moodTags: [], referenceTracks: [], revisionsIncluded: 0, revisionsUsed: 0,
    });
    const c = (name: string, email: string, masterPct: number, signed: boolean) => ({
      name, email, role: "Writer", masterPct, publishingPct: masterPct, signed,
    });
    const sheetId = await ctx.db.insert("splitSheets", {
      orgId: "o1", songId, status: "sent", updatedAt: 0,
      contributors: [c("Ana", "ana@x.com", 50, true), c("Bo", "bo@x.com", 30, false), c("Cy", "cy@x.com", 20, false)],
    });
    return { songId, sheetId, artistId };
  });
  const as = (user: string, orgId = "o1") => t.withIdentity({ subject: user, name: user, orgId });
  return { t, as, ...ids };
}

async function statement(t: ReturnType<typeof convexTest>, lines: { isrc?: string; title?: string; artist?: string; amountCents: number; currency?: string }[], hash = "h1") {
  const mediaId = await t.run((ctx) =>
    ctx.db.insert("mediaFiles", {
      orgId: "o1", bucket: "private", bucketName: "b", key: `k/${hash}`, purpose: "royalty_statement",
      fileName: "dk.tsv", mimeType: "text/tab-separated-values", status: "ready", uploadedBy: "u_owner", createdAt: Date.now(),
    }),
  );
  const statementId = await t.mutation(internal.royalties._createStatement, {
    orgId: "o1", actor: "u_owner", mediaId, fileName: "dk.tsv", fileHash: hash, source: "distrokid",
    totals: [{ currency: "USD", cents: lines.reduce((s, l) => s + l.amountCents, 0) }], rowCount: lines.length, lineCount: lines.length,
  });
  await t.mutation(internal.royalties._addLines, {
    statementId,
    lines: lines.map((l) => ({ currency: "USD", units: 1, rows: 1, ...l })),
  });
  await t.mutation(internal.royalties._finishStatement, { statementId });
  return statementId;
}

describe("gate", () => {
  it("is off with the switch off, refuses the API, and status says so", async () => {
    const { as } = await setup("max", false);
    expect(await as("u_owner").query(api.royalties.status, {})).toEqual({ available: false, reason: "off" });
    await expect(
      as("u_owner").mutation(api.royalties.prepareStatementUpload, { fileName: "a.csv", mimeType: "text/csv", size: 10 }),
    ).rejects.toMatchObject({ data: { code: "ROYALTIES_OFF" } });
    await expect(as("u_owner").query(api.royalties.statements, {})).rejects.toMatchObject({ data: { code: "ROYALTIES_OFF" } });
  });

  it("asks Growth to upgrade, and keeps engineers out on Max", async () => {
    const growth = await setup("growth", true);
    expect(await growth.as("u_owner").query(api.royalties.status, {})).toEqual({ available: false, reason: "upgrade" });
    const max = await setup("max", true);
    expect(await max.as("u_owner").query(api.royalties.status, {})).toEqual({ available: true, reason: null });
    expect(await max.as("u_eng").query(api.royalties.status, {})).toEqual({ available: false, reason: "role" });
    await expect(max.as("u_eng").query(api.royalties.statements, {})).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
  });

  it("hides Royalties from the nav entirely while the switch is off, and shows Growth a lock once on", async () => {
    const off = await setup("growth", false);
    const o1 = await off.as("u_owner").query(api.orgs.current, {});
    expect(o1?.disabledFeatures).toContain("royalties");
    expect(o1?.tierLockedFeatures).not.toContain("royalties");
    const on = await setup("growth", true);
    const o2 = await on.as("u_owner").query(api.orgs.current, {});
    expect(o2?.tierLockedFeatures).toContain("royalties");
    const max = await setup("max", true);
    const o3 = await max.as("u_owner").query(api.orgs.current, {});
    expect(o3?.disabledFeatures).not.toContain("royalties");
  });

  it("refuses files that are not CSV", async () => {
    const { as } = await setup();
    await expect(
      as("u_owner").mutation(api.royalties.prepareStatementUpload, { fileName: "a.pdf", mimeType: "application/pdf", size: 10 }),
    ).rejects.toMatchObject({ data: { code: "BAD_FILE" } });
  });
});

describe("statements", () => {
  it("holds a matched line as Unallocated Income until the sheet is fully executed, then splits 50/30/20", async () => {
    const { t, as, sheetId, songId } = await setup();
    await statement(t, [{ isrc: ISRC, amountCents: 41200 }]);

    const q1 = await as("u_owner").query(api.royalties.queues, {});
    expect(q1.unallocated).toEqual([
      { songId, title: "Night Drive", artistName: "LB", totals: [{ currency: "USD", cents: 41200 }], waitingOn: 2 },
    ]);
    expect(await t.run((ctx) => ctx.db.query("royaltyShares").collect())).toHaveLength(0);

    await as("u_owner").mutation(api.splitSheets.setStatus, { id: sheetId, status: "fully_executed" });
    const shares = await t.run((ctx) => ctx.db.query("royaltyShares").collect());
    expect(shares.map((s) => [s.contributorKey, s.amountCents])).toEqual([
      ["ana@x.com", 20600],
      ["bo@x.com", 12360],
      ["cy@x.com", 8240],
    ]);
    expect((await as("u_owner").query(api.royalties.queues, {})).unallocated).toEqual([]);
    expect(await as("u_owner").query(api.royalties.songs, {})).toMatchObject([
      { songId, title: "Night Drive", earned: [{ currency: "USD", cents: 41200 }], held: [] },
    ]);
  });

  it("allocates on import when the sheet is already signed, summing exactly", async () => {
    const { t, as, sheetId } = await setup();
    await t.run((ctx) => ctx.db.patch(sheetId, { status: "fully_executed" }));
    await statement(t, [{ isrc: ISRC, amountCents: 10 }]);
    const shares = await t.run((ctx) => ctx.db.query("royaltyShares").collect());
    expect(shares.map((s) => s.amountCents)).toEqual([5, 3, 2]);
    expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(10);
    const people = await as("u_owner").query(api.royalties.contributors, {});
    expect(people.map((p) => [p.key, p.owed])).toEqual([
      ["ana@x.com", [{ currency: "USD", cents: 5 }]],
      ["bo@x.com", [{ currency: "USD", cents: 3 }]],
      ["cy@x.com", [{ currency: "USD", cents: 2 }]],
    ]);
  });

  it("refuses the same file twice and creates nothing new", async () => {
    const { t } = await setup();
    await statement(t, [{ isrc: ISRC, amountCents: 100 }], "same");
    await expect(statement(t, [{ isrc: ISRC, amountCents: 100 }], "same")).rejects.toMatchObject({ data: { code: "DUPLICATE" } });
    expect(await t.run((ctx) => ctx.db.query("royaltyStatements").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("royaltyLines").collect())).toHaveLength(1);
  });

  it("queues an Unmatched Line, then matching it allocates and teaches the Song its ISRC", async () => {
    const { t, as, sheetId, songId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(sheetId, { status: "fully_executed" });
      await ctx.db.patch(songId, { isrc: undefined });
    });
    await statement(t, [{ isrc: "USXYZ2699999", title: "Night Drive (Remix)", amountCents: 1000 }]);
    const { unmatched } = await as("u_owner").query(api.royalties.queues, {});
    expect(unmatched).toHaveLength(1);

    const res = await as("u_owner").mutation(api.royalties.matchLine, { lineId: unmatched[0]._id, songId });
    expect(res.state).toBe("allocated");
    expect((await t.run((ctx) => ctx.db.get(songId)))?.isrc).toBe("USXYZ2699999");
    expect((await as("u_owner").query(api.royalties.queues, {})).unmatched).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("royaltyShares").collect())).toHaveLength(3);
  });

  it("creates a Song for an Unmatched Line under a hidden catalog artist", async () => {
    const { t, as } = await setup();
    await statement(t, [{ isrc: "USXYZ2600777", title: "Stranger", artist: "Guest Act", amountCents: 500 }]);
    const { unmatched } = await as("u_owner").query(api.royalties.queues, {});
    const res = await as("u_owner").mutation(api.royalties.matchLine, {
      lineId: unmatched[0]._id, create: { title: "Stranger", artistName: "Guest Act" },
    });
    expect(res.state).toBe("unallocated"); // a new song has no signed sheet yet
    const song = await t.run((ctx) => ctx.db.get(res.songId as Id<"songs">));
    expect(song).toMatchObject({ title: "Stranger", isrc: "USXYZ2600777", stage: "released" });
    const artist = await t.run((ctx) => ctx.db.get(song!.artistId));
    expect(artist).toMatchObject({ name: "Guest Act", catalogOnly: true });
  });

  it("marks one contributor's shares in a statement paid, records only", async () => {
    const { t, as, sheetId } = await setup();
    await t.run((ctx) => ctx.db.patch(sheetId, { status: "fully_executed" }));
    const statementId = await statement(t, [{ isrc: ISRC, amountCents: 1000 }]);
    const when = Date.UTC(2026, 9, 30);
    const r = await as("u_owner").mutation(api.royalties.markPaid, {
      contributor: { key: "bo@x.com", statementId }, paid: true, paidAt: when, method: "Zelle",
    });
    expect(r.changed).toBe(1);
    const bo = await as("u_owner").query(api.royalties.contributorShares, { contributorKey: "bo@x.com" });
    expect(bo).toMatchObject([{ amountCents: 300, paidAt: when, paidMethod: "Zelle" }]);
    const ana = await as("u_owner").query(api.royalties.contributorShares, { contributorKey: "ana@x.com" });
    expect(ana[0].paidAt).toBeNull();
  });

  it("never lets another studio read or act on these rows", async () => {
    const { t, as, sheetId } = await setup();
    await t.run((ctx) => ctx.db.patch(sheetId, { status: "fully_executed" }));
    const statementId = await statement(t, [{ isrc: ISRC, amountCents: 1000 }]);
    const other = as("u_other", "o2");
    expect(await other.query(api.royalties.statements, {})).toEqual([]);
    expect(await other.query(api.royalties.contributorShares, { contributorKey: "ana@x.com" })).toEqual([]);
    const shares = await t.run((ctx) => ctx.db.query("royaltyShares").collect());
    const r = await other.mutation(api.royalties.markPaid, { shareIds: shares.map((s) => s._id), paid: true });
    expect(r.changed).toBe(0);
    await expect(other.mutation(api.royalties.markPaid, { contributor: { key: "ana@x.com", statementId }, paid: true })).resolves.toEqual({ changed: 0 });
  });
});
