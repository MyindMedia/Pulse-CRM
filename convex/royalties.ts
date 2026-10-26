import { internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveViewer } from "./lib/access";
import { requireRoyalties, royaltiesSwitchOn } from "./lib/royaltiesGate";
import { orgHasFeature } from "./lib/entitlements";
import { createUpload } from "./media";
import { claimFile, fileUrl } from "./lib/media";
import { statementSourceV } from "./catalogTables";
import { allocateLine, sheetFor, waitingOn } from "./lib/royaltyAllocate";
import { titleKey } from "./lib/catalogMerge";
import { artistKey } from "./lib/catalogArtists";

/* ============================================================
   Royalty Statements (Max + the agency switch; lib/royaltiesGate).

   Upload: the browser PUTs the CSV straight to R2 (prepareStatementUpload,
   then media.confirmUpload), and royaltiesNode.importStatement reads it
   back, folds it into one line per recording per currency, and writes
   the statement here in batches. Lines match Songs by ISRC; a matched
   line becomes Royalty Shares from the signed split sheet, or waits as
   Unallocated Income until the sheet is fully executed.

   Pulse never collects, holds or moves royalty money: shares are a
   ledger the studio pays out itself and marks paid.
   ============================================================ */

const MAX_STATEMENT_BYTES = 20 * 1024 * 1024;

/** Owner / manager of the studio (or an agency operator inside it), with
 *  Royalties available. Everything below goes through this. */
async function royaltyAdmin(ctx: QueryCtx | MutationCtx): Promise<{ orgId: string; actor: string }> {
  const viewer = await resolveViewer(ctx);
  let admin: { orgId: string; actor: string } | null = null;
  if (viewer.kind === "studio_member" && (viewer.role === "owner" || viewer.role === "manager")) {
    admin = { orgId: viewer.orgId, actor: viewer.clerkUserId };
  } else if (viewer.kind === "agency_member" && viewer.orgId) {
    admin = { orgId: viewer.orgId, actor: viewer.clerkUserId };
  }
  if (!admin) throw new ConvexError({ code: "CAPABILITY_DENIED", message: "Only an owner or manager can work with royalties." });
  await requireRoyalties(ctx, admin.orgId);
  return admin;
}

/** For navigation and the page: should this studio see Royalties, and if
 *  not, why. Never throws. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind === "guest" || !viewer.orgId) return { available: false, reason: "off" as const };
    if (!(await royaltiesSwitchOn(ctx, viewer.orgId))) return { available: false, reason: "off" as const };
    if (!(await orgHasFeature(ctx, viewer.orgId, "royalties"))) return { available: false, reason: "upgrade" as const };
    const admin = (viewer.kind === "studio_member" && (viewer.role === "owner" || viewer.role === "manager")) || viewer.kind === "agency_member";
    return admin ? { available: true, reason: null } : { available: false, reason: "role" as const };
  },
});

/* ── Upload ──────────────────────────────────────────────── */

export const prepareStatementUpload = mutation({
  args: { fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, { fileName, mimeType, size }) => {
    const { orgId, actor } = await royaltyAdmin(ctx);
    if (!/\.(csv|tsv|txt)$/i.test(fileName.trim())) {
      throw new ConvexError({ code: "BAD_FILE", message: "Upload the statement as a CSV (or the TSV DistroKid exports)." });
    }
    if (mimeType && !/^(text\/(csv|plain|tab-separated-values)|application\/(vnd\.ms-excel|csv|octet-stream))$/i.test(mimeType)) {
      throw new ConvexError({ code: "BAD_FILE", message: "That isn't a CSV file." });
    }
    if (size > MAX_STATEMENT_BYTES) throw new ConvexError({ code: "TOO_LARGE", message: "Statements up to 20 MB." });
    return await createUpload(ctx, {
      scope: orgId,
      purpose: "royalty_statement",
      fileName,
      mimeType: mimeType || "text/csv",
      size,
      actor,
      trusted: false,
    });
  },
});

/** Everything the import action needs, under the caller's identity. */
export const _importContext = internalQuery({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => {
    const { orgId, actor } = await royaltyAdmin(ctx);
    const row = await ctx.db.get(mediaId);
    if (!row || row.orgId !== orgId || row.purpose !== "royalty_statement") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload not found." });
    }
    if (row.status !== "ready") throw new ConvexError({ code: "NOT_READY", message: "The file has not finished uploading." });
    if ((row.size ?? 0) > MAX_STATEMENT_BYTES) throw new ConvexError({ code: "TOO_LARGE", message: "Statements up to 20 MB." });
    const url = await fileUrl(ctx, mediaId, { expiresIn: 300 });
    if (!url) throw new ConvexError({ code: "NOT_FOUND", message: "Upload not found." });
    const mappings = await ctx.db
      .query("royaltyMappings")
      .withIndex("by_org_signature", (q) => q.eq("orgId", orgId))
      .take(100);
    return {
      orgId,
      actor,
      url,
      fileName: row.fileName,
      mappings: mappings.map((m) => ({ signature: m.headerSignature, columns: m.columns })),
    };
  },
});

export const _byHash = internalQuery({
  args: { orgId: v.string(), fileHash: v.string() },
  handler: async (ctx, { orgId, fileHash }) =>
    (await ctx.db.query("royaltyStatements").withIndex("by_org_hash", (q) => q.eq("orgId", orgId).eq("fileHash", fileHash)).first())?._id ?? null,
});

const columnsV = v.object({
  isrc: v.optional(v.string()),
  title: v.optional(v.string()),
  artist: v.optional(v.string()),
  amount: v.string(),
  currency: v.optional(v.string()),
  units: v.optional(v.string()),
  period: v.optional(v.string()),
});

export const _createStatement = internalMutation({
  args: {
    orgId: v.string(),
    actor: v.string(),
    mediaId: v.id("mediaFiles"),
    fileName: v.string(),
    fileHash: v.string(),
    source: statementSourceV,
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    totals: v.array(v.object({ currency: v.string(), cents: v.number() })),
    rowCount: v.number(),
    lineCount: v.number(),
    /** A mapping the owner just picked, remembered for this header layout. */
    saveMapping: v.optional(v.object({ signature: v.string(), columns: columnsV })),
  },
  handler: async (ctx, a) => {
    await requireRoyalties(ctx, a.orgId);
    const dup = await ctx.db
      .query("royaltyStatements")
      .withIndex("by_org_hash", (q) => q.eq("orgId", a.orgId).eq("fileHash", a.fileHash))
      .first();
    if (dup) throw new ConvexError({ code: "DUPLICATE", message: "This statement was already imported." });
    await claimFile(ctx, a.mediaId, a.orgId);
    if (a.saveMapping) {
      const existing = await ctx.db
        .query("royaltyMappings")
        .withIndex("by_org_signature", (q) => q.eq("orgId", a.orgId).eq("headerSignature", a.saveMapping!.signature))
        .first();
      if (existing) await ctx.db.patch(existing._id, { columns: a.saveMapping.columns });
      else await ctx.db.insert("royaltyMappings", { orgId: a.orgId, headerSignature: a.saveMapping.signature, columns: a.saveMapping.columns, createdAt: Date.now() });
    }
    return await ctx.db.insert("royaltyStatements", {
      orgId: a.orgId,
      source: a.source,
      fileId: a.mediaId,
      fileName: a.fileName.slice(0, 160),
      fileHash: a.fileHash,
      status: "parsing",
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      totals: a.totals,
      rowCount: a.rowCount,
      lineCount: a.lineCount,
      uploadedBy: a.actor,
      createdAt: Date.now(),
    });
  },
});

/** The Song a line is: same ISRC; for a file without ISRCs, same title by the same artist. */
async function songForLine(ctx: MutationCtx, orgId: string, l: { isrc?: string; title?: string; artist?: string }) {
  if (l.isrc) {
    return await ctx.db.query("songs").withIndex("by_org_isrc", (q) => q.eq("orgId", orgId).eq("isrc", l.isrc)).first();
  }
  if (!l.title) return null;
  const want = titleKey(l.title);
  const hits = await ctx.db
    .query("songs")
    .withSearchIndex("search_title", (q) => q.search("title", l.title!).eq("orgId", orgId))
    .take(10);
  for (const s of hits) {
    if (titleKey(s.title) !== want) continue;
    if (!l.artist) return s;
    const a = await ctx.db.get(s.artistId);
    if (a && artistKey(a.name) === artistKey(l.artist)) return s;
  }
  return null;
}

const lineV = v.object({
  isrc: v.optional(v.string()),
  title: v.optional(v.string()),
  artist: v.optional(v.string()),
  currency: v.string(),
  amountCents: v.number(),
  units: v.number(),
  rows: v.number(),
});

export const _addLines = internalMutation({
  args: { statementId: v.id("royaltyStatements"), lines: v.array(lineV) },
  handler: async (ctx, { statementId, lines }) => {
    const st = await ctx.db.get(statementId);
    if (!st || st.status !== "parsing") return;
    const sheets = new Map<string, Doc<"splitSheets"> | null>();
    for (const l of lines) {
      const song = await songForLine(ctx, st.orgId, l);
      const lineId = await ctx.db.insert("royaltyLines", {
        orgId: st.orgId,
        statementId,
        ...l,
        amountCents: Math.round(l.amountCents),
        songId: song?._id,
        state: song ? "unallocated" : "unmatched",
      });
      if (!song) continue;
      if (!sheets.has(song._id)) sheets.set(song._id, await sheetFor(ctx, st.orgId, song._id));
      await allocateLine(ctx, (await ctx.db.get(lineId))!, sheets.get(song._id));
    }
  },
});

export const _finishStatement = internalMutation({
  args: { statementId: v.id("royaltyStatements"), error: v.optional(v.string()) },
  handler: async (ctx, { statementId, error }) => {
    const st = await ctx.db.get(statementId);
    if (!st) return;
    await ctx.db.patch(statementId, error ? { status: "failed", error: error.slice(0, 300) } : { status: "ready" });
    if (!error) {
      const total = st.totals.map((t) => `${(t.cents / 100).toFixed(2)} ${t.currency}`).join(", ");
      await ctx.db.insert("activity", {
        orgId: st.orgId,
        kind: "royalty.statement",
        summary: `Royalty statement imported (${st.source}): ${total}`,
        entityType: "royaltyStatement",
        entityId: statementId,
        accent: "positive",
      });
    }
  },
});

/* ── Reading ─────────────────────────────────────────────── */

type Totals = Record<string, number>;
const add = (t: Totals, currency: string, cents: number) => {
  t[currency] = (t[currency] ?? 0) + cents;
};
const list = (t: Totals) => Object.entries(t).map(([currency, cents]) => ({ currency, cents }));

export const statements = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await royaltyAdmin(ctx);
    const rows = await ctx.db.query("royaltyStatements").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(200);
    return rows.map((s) => ({
      _id: s._id,
      source: s.source,
      fileName: s.fileName,
      status: s.status,
      error: s.error ?? null,
      periodStart: s.periodStart ?? null,
      periodEnd: s.periodEnd ?? null,
      totals: s.totals,
      rowCount: s.rowCount,
      lineCount: s.lineCount,
      createdAt: s.createdAt,
    }));
  },
});

/** Unallocated Income per song (with signatures outstanding) and the Unmatched queue. */
export const queues = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await royaltyAdmin(ctx);
    const waiting = await ctx.db
      .query("royaltyLines")
      .withIndex("by_org_state", (q) => q.eq("orgId", orgId).eq("state", "unallocated"))
      .take(2000);
    const bySong = new Map<Id<"songs">, Totals>();
    for (const l of waiting) {
      if (!l.songId) continue;
      const t = bySong.get(l.songId) ?? {};
      add(t, l.currency, l.amountCents);
      bySong.set(l.songId, t);
    }
    const unallocated = [];
    for (const [songId, totals] of bySong) {
      const song = await ctx.db.get(songId);
      if (!song) continue;
      const artist = await ctx.db.get(song.artistId);
      unallocated.push({
        songId,
        title: song.title,
        artistName: artist?.name ?? "",
        totals: list(totals),
        waitingOn: waitingOn(await sheetFor(ctx, orgId, songId)),
      });
    }
    const unmatchedRows = await ctx.db
      .query("royaltyLines")
      .withIndex("by_org_state", (q) => q.eq("orgId", orgId).eq("state", "unmatched"))
      .take(500);
    return {
      unallocated: unallocated.sort((a, b) => (b.totals[0]?.cents ?? 0) - (a.totals[0]?.cents ?? 0)),
      unmatched: unmatchedRows.map((l) => ({
        _id: l._id,
        statementId: l.statementId,
        isrc: l.isrc ?? null,
        title: l.title ?? null,
        artist: l.artist ?? null,
        currency: l.currency,
        amountCents: l.amountCents,
      })),
    };
  },
});

/** Per-song earnings across every statement, and how much is still held. */
export const songs = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await royaltyAdmin(ctx);
    const by = new Map<Id<"songs">, { earned: Totals; held: Totals; lines: number }>();
    for (const state of ["allocated", "unallocated"] as const) {
      const rows = await ctx.db
        .query("royaltyLines")
        .withIndex("by_org_state", (q) => q.eq("orgId", orgId).eq("state", state))
        .take(20000);
      for (const l of rows) {
        if (!l.songId) continue;
        const e = by.get(l.songId) ?? { earned: {}, held: {}, lines: 0 };
        add(e.earned, l.currency, l.amountCents);
        if (state === "unallocated") add(e.held, l.currency, l.amountCents);
        e.lines++;
        by.set(l.songId, e);
      }
    }
    const out = [];
    for (const [songId, e] of by) {
      const song = await ctx.db.get(songId);
      if (!song || song.orgId !== orgId) continue;
      const artist = await ctx.db.get(song.artistId);
      out.push({ songId, title: song.title, artistName: artist?.name ?? "", isrc: song.isrc ?? null, earned: list(e.earned), held: list(e.held) });
    }
    return out.sort((a, b) => (b.earned[0]?.cents ?? 0) - (a.earned[0]?.cents ?? 0));
  },
});

/** Per-contributor totals across every statement: owed (unpaid) and paid. */
export const contributors = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await royaltyAdmin(ctx);
    const shares = await ctx.db
      .query("royaltyShares")
      .withIndex("by_org_contributor", (q) => q.eq("orgId", orgId))
      .take(20000);
    const by = new Map<string, { key: string; name: string; owed: Totals; paid: Totals; songs: Set<string> }>();
    for (const s of shares) {
      const c = by.get(s.contributorKey) ?? { key: s.contributorKey, name: s.name, owed: {}, paid: {}, songs: new Set<string>() };
      add(s.paidAt ? c.paid : c.owed, s.currency, s.amountCents);
      c.songs.add(s.songId);
      by.set(s.contributorKey, c);
    }
    return [...by.values()]
      .map((c) => ({
        key: c.key,
        name: c.name,
        email: c.key.startsWith("name:") ? null : c.key,
        owed: list(c.owed),
        paid: list(c.paid),
        songs: c.songs.size,
      }))
      .sort((a, b) => (b.owed[0]?.cents ?? 0) - (a.owed[0]?.cents ?? 0));
  },
});

/** One contributor's shares, newest statement first. */
export const contributorShares = query({
  args: { contributorKey: v.string() },
  handler: async (ctx, { contributorKey }) => {
    const { orgId } = await royaltyAdmin(ctx);
    return await sharesFor(ctx, orgId, contributorKey);
  },
});

export async function sharesFor(ctx: QueryCtx, orgId: string, contributorKey: string) {
  const shares = await ctx.db
    .query("royaltyShares")
    .withIndex("by_org_contributor", (q) => q.eq("orgId", orgId).eq("contributorKey", contributorKey))
    .take(5000);
  const songs = new Map<string, string>();
  const statements = new Map<string, Doc<"royaltyStatements"> | null>();
  const out = [];
  for (const s of shares) {
    if (!songs.has(s.songId)) songs.set(s.songId, (await ctx.db.get(s.songId))?.title ?? "Untitled");
    if (!statements.has(s.statementId)) statements.set(s.statementId, await ctx.db.get(s.statementId));
    const st = statements.get(s.statementId);
    out.push({
      _id: s._id,
      statementId: s.statementId,
      songTitle: songs.get(s.songId)!,
      source: st?.source ?? null,
      periodStart: st?.periodStart ?? null,
      periodEnd: st?.periodEnd ?? null,
      pct: s.pct,
      currency: s.currency,
      amountCents: s.amountCents,
      paidAt: s.paidAt ?? null,
      paidMethod: s.paidMethod ?? null,
    });
  }
  return out.sort((a, b) => (b.periodEnd ?? 0) - (a.periodEnd ?? 0));
}

/* ── Acting ──────────────────────────────────────────────── */

/** Match an Unmatched Line to a Song (or create one) and allocate it. The
 *  Song keeps the line's ISRC so the next statement matches on its own. */
export const matchLine = mutation({
  args: {
    lineId: v.id("royaltyLines"),
    songId: v.optional(v.id("songs")),
    create: v.optional(v.object({ title: v.string(), artistName: v.string() })),
  },
  handler: async (ctx, { lineId, songId, create }) => {
    const { orgId } = await royaltyAdmin(ctx);
    const line = await ctx.db.get(lineId);
    if (!line || line.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Line not found." });
    if (line.state !== "unmatched") throw new ConvexError({ code: "BAD_REQUEST", message: "That line is already matched." });
    let song: Doc<"songs"> | null = null;
    if (songId) {
      song = await ctx.db.get(songId);
      if (!song || song.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Song not found." });
      if (line.isrc && !song.isrc) await ctx.db.patch(song._id, { isrc: line.isrc });
    } else if (create && create.title.trim()) {
      const name = create.artistName.trim() || line.artist || "Unknown artist";
      const roster = await ctx.db
        .query("artists")
        .withSearchIndex("search_name", (q) => q.search("name", name).eq("orgId", orgId))
        .take(10);
      const artistId =
        roster.find((a) => artistKey(a.name) === artistKey(name))?._id ??
        (await ctx.db.insert("artists", {
          orgId, name: name.slice(0, 200), type: "artist", genres: [], tags: [], status: "dormant",
          lifetimeValueCents: 0, sessionCount: 0, reliability: "solid", source: "royalty_statement", catalogOnly: true,
        }));
      const id = await ctx.db.insert("songs", {
        orgId, title: create.title.trim().slice(0, 200), artistId, kind: "single", stage: "released",
        moodTags: [], referenceTracks: [], revisionsIncluded: 0, revisionsUsed: 0,
        ...(line.isrc ? { isrc: line.isrc } : {}),
      });
      song = await ctx.db.get(id);
    }
    if (!song) throw new ConvexError({ code: "BAD_REQUEST", message: "Pick a song or name a new one." });
    await ctx.db.patch(lineId, { songId: song._id, state: "unallocated" });
    const state = await allocateLine(ctx, (await ctx.db.get(lineId))!);
    // Other unmatched lines with the same ISRC go with it.
    if (line.isrc) {
      const twins = await ctx.db
        .query("royaltyLines")
        .withIndex("by_org_state", (q) => q.eq("orgId", orgId).eq("state", "unmatched"))
        .take(2000);
      for (const t of twins) {
        if (t._id === lineId || t.isrc !== line.isrc) continue;
        await ctx.db.patch(t._id, { songId: song._id, state: "unallocated" });
        await allocateLine(ctx, (await ctx.db.get(t._id))!);
      }
    }
    return { songId: song._id, state };
  },
});

/** Mark shares paid (or not): explicit shares, or every share of one
 *  contributor in one statement. Records only; no money moves. */
export const markPaid = mutation({
  args: {
    shareIds: v.optional(v.array(v.id("royaltyShares"))),
    contributor: v.optional(v.object({ key: v.string(), statementId: v.id("royaltyStatements") })),
    paid: v.boolean(),
    paidAt: v.optional(v.number()),
    method: v.optional(v.string()),
  },
  handler: async (ctx, { shareIds, contributor, paid, paidAt, method }) => {
    const { orgId, actor } = await royaltyAdmin(ctx);
    let rows: Doc<"royaltyShares">[] = [];
    if (shareIds) {
      if (shareIds.length > 1000) throw new ConvexError({ code: "BAD_REQUEST", message: "At most 1,000 at a time." });
      rows = (await Promise.all(shareIds.map((id) => ctx.db.get(id)))).filter((r): r is Doc<"royaltyShares"> => !!r);
    } else if (contributor) {
      rows = (
        await ctx.db
          .query("royaltyShares")
          .withIndex("by_org_contributor", (q) => q.eq("orgId", orgId).eq("contributorKey", contributor.key))
          .take(5000)
      ).filter((r) => r.statementId === contributor.statementId);
    }
    const when = paidAt ?? Date.now();
    let changed = 0;
    for (const r of rows) {
      if (r.orgId !== orgId || Boolean(r.paidAt) === paid) continue;
      await ctx.db.patch(
        r._id,
        paid
          ? { paidAt: when, paidMethod: (method ?? "").trim().slice(0, 60) || undefined, paidBy: actor }
          : { paidAt: undefined, paidMethod: undefined, paidBy: undefined },
      );
      changed++;
    }
    return { changed };
  },
});
