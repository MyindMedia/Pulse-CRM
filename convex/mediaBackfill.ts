import { internalQuery, internalAction } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { createUpload, storeBytes } from "./media";
import { r2For, type MediaPurpose } from "./lib/media";

/* ============================================================
   Backfill: copy files that still live in Convex storage into R2 and point their
   rows at the copy. Driven by scripts/r2/backfill.mjs from a laptop (large audio
   files do not fit an action's memory), always dry-run first.

   Safe by construction:
     - the legacy Convex file is never deleted at copy time; the new row remembers
       it in legacyStorageId and purgeLegacy removes it only after a safety window
     - a row is repointed only if it still holds the exact legacy id that was read
       (a person who replaced the file mid-run wins)
     - the copy must match the legacy size byte for byte before anything is repointed
   ============================================================ */

type Row = Record<string, unknown> & { _id: string };
type Field = { path: string; purpose: MediaPurpose; name?: (r: Row) => string };
type Spec = { table: string; scope: (r: Row) => string; fields: Field[] };

const orgScope = (r: Row) => String(r.orgId);
const agencyScope = (r: Row) => `agency:${String(r.agencyId)}`;

/** Every place a file can be stored. Receipt extraction reads either store
 *  (readFileBlob), so receipts and expense receipts are copied like the rest. */
export const SPECS: Spec[] = [
  { table: "orgs", scope: orgScope, fields: [
    { path: "logoId", purpose: "logo" }, { path: "bookingHeroId", purpose: "photo" },
    { path: "generatedHeroId", purpose: "photo" }, { path: "theme.loginBackgroundId", purpose: "photo" },
  ] },
  { table: "agencies", scope: agencyScope, fields: [{ path: "logoId", purpose: "logo" }, { path: "faviconId", purpose: "logo" }] },
  { table: "agencyMembers", scope: agencyScope, fields: [{ path: "photoStorageId", purpose: "photo" }] },
  { table: "members", scope: orgScope, fields: [{ path: "photoId", purpose: "photo" }] },
  { table: "songs", scope: orgScope, fields: [{ path: "coverArtId", purpose: "cover" }] },
  { table: "bookableServices", scope: orgScope, fields: [{ path: "heroImageId", purpose: "photo" }] },
  { table: "rooms", scope: orgScope, fields: [{ path: "heroImageId", purpose: "photo" }] },
  { table: "equipment", scope: orgScope, fields: [{ path: "photoId", purpose: "photo" }] },
  { table: "deviceInstances", scope: orgScope, fields: [{ path: "photoId", purpose: "photo" }, { path: "panelPhotoId", purpose: "photo" }] },
  { table: "assetDocuments", scope: orgScope, fields: [{ path: "storageId", purpose: "document", name: (r) => String(r.fileName ?? "document") }] },
  { table: "deliverables", scope: orgScope, fields: [{ path: "fileId", purpose: "deliverable", name: (r) => String(r.fileName ?? "deliverable") }] },
  { table: "socialPosts", scope: orgScope, fields: [{ path: "media[].storageId", purpose: "photo" }] },
  { table: "receipts", scope: orgScope, fields: [{ path: "storageId", purpose: "receipt", name: (r) => String(r.fileName ?? "receipt") }] },
  { table: "expenses", scope: orgScope, fields: [{ path: "receiptId", purpose: "receipt", name: () => "expense-receipt" }] },
];

const refs = (r: Row, path: string): Array<{ ref: string; index?: number }> => {
  if (path.endsWith("[].storageId")) {
    const arr = r[path.slice(0, -"[].storageId".length)];
    return Array.isArray(arr) ? arr.flatMap((m, index) => (m && typeof m === "object" && typeof (m as Record<string, unknown>).storageId === "string" ? [{ ref: (m as Record<string, string>).storageId, index }] : [])) : [];
  }
  const parts = path.split(".");
  let cur: unknown = r;
  for (const p of parts) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
  return typeof cur === "string" ? [{ ref: cur }] : [];
};

/** One page of legacy references. Walk with {specIndex, cursor} until `done`. */
export const page = internalQuery({
  args: { specIndex: v.number(), cursor: v.union(v.string(), v.null()), limit: v.number() },
  handler: async (ctx, { specIndex, cursor, limit }) => {
    const spec = SPECS[specIndex];
    if (!spec) return { items: [], next: null as null | { specIndex: number; cursor: string | null }, done: true };
    const res = await ctx.db.query(spec.table as "orgs").paginate({ numItems: limit, cursor });
    const items: Array<{ table: string; id: string; path: string; ref: string; index?: number; scope: string; purpose: MediaPurpose; fileName: string }> = [];
    for (const raw of res.page) {
      const r = raw as unknown as Row;
      for (const f of spec.fields) {
        for (const { ref, index } of refs(r, f.path)) {
          if (ctx.db.normalizeId("mediaFiles", ref)) continue; // already on R2
          const meta = await ctx.db.system.get(ref as Id<"_storage">);
          if (!meta) continue; // dangling reference: nothing to copy
          items.push({ table: spec.table, id: r._id, path: f.path, ref, index, scope: spec.scope(r), purpose: f.purpose, fileName: f.name?.(r) ?? `${spec.table}-${f.path.replace(/\W+/g, "-")}` });
        }
      }
    }
    const next = res.isDone ? (SPECS[specIndex + 1] ? { specIndex: specIndex + 1, cursor: null } : null) : { specIndex, cursor: res.continueCursor };
    return { items, next, done: next === null };
  },
});

/** Where to read one legacy file, and what it is. */
export const legacyInfo = internalQuery({
  args: { ref: v.id("_storage") },
  handler: async (ctx, { ref }) => {
    const meta = await ctx.db.system.get(ref);
    const url = await ctx.storage.getUrl(ref);
    return meta && url ? { url, size: meta.size, contentType: meta.contentType ?? "application/octet-stream" } : null;
  },
});

export const startCopy = internalMutation({
  args: { scope: v.string(), purpose: v.string(), fileName: v.string(), mimeType: v.string(), size: v.number(), legacy: v.id("_storage") },
  handler: async (ctx, a) => {
    // Legacy rows often lack an extension in their name; take it from the type so the R2 key reads well.
    const ext = /\.[a-z0-9]{1,8}$/i.test(a.fileName) ? "" : ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "video/mp4": ".mp4", "application/pdf": ".pdf" } as Record<string, string>)[a.mimeType.toLowerCase()] ?? "";
    const up = await createUpload(ctx, { scope: a.scope, purpose: a.purpose as MediaPurpose, fileName: a.fileName + ext, mimeType: a.mimeType, size: a.size, actor: "backfill", trusted: true });
    await ctx.db.patch(up.mediaId, { legacyStorageId: a.legacy });
    return up;
  },
});

/** After the PUT: ask R2 what arrived, require the exact legacy size, mark ready. */
export const finishCopy = internalAction({
  args: { mediaId: v.id("mediaFiles"), expectedSize: v.number() },
  handler: async (ctx, { mediaId, expectedSize }): Promise<{ ok: boolean; reason?: string }> => {
    const row = await ctx.runQuery(internal.media._row, { mediaId });
    if (!row) return { ok: false, reason: "row missing" };
    const r2 = r2For(row.bucket, row.bucketName);
    await r2.syncMetadata(ctx, row.key);
    const meta = await r2.getMetadata(ctx, row.key);
    if (!meta || meta.size !== expectedSize) {
      await ctx.runMutation(internal.media._discard, { mediaId });
      return { ok: false, reason: `size mismatch (R2 ${meta?.size ?? "none"}, legacy ${expectedSize})` };
    }
    await ctx.runMutation(internal.media._markReady, { mediaId, size: meta.size });
    return { ok: true };
  },
});

/** Point the row at the R2 copy, only if it still holds the legacy id that was copied. */
export const repoint = internalMutation({
  args: { table: v.string(), id: v.string(), path: v.string(), index: v.optional(v.number()), oldRef: v.string(), mediaId: v.id("mediaFiles") },
  handler: async (ctx, a): Promise<"repointed" | "changed" | "gone"> => {
    const spec = SPECS.find((s) => s.table === a.table);
    const docId = ctx.db.normalizeId(a.table as "orgs", a.id);
    const doc = docId ? ((await ctx.db.get(docId)) as unknown as Row | null) : null;
    if (!spec || !doc) return "gone";
    const field = spec.fields.find((f) => f.path === a.path);
    if (!field) return "gone";
    let patch: Record<string, unknown>;
    if (a.path.endsWith("[].storageId")) {
      const key = a.path.slice(0, -"[].storageId".length);
      const arr = Array.isArray(doc[key]) ? (doc[key] as Array<Record<string, unknown>>) : [];
      if (a.index === undefined || arr[a.index]?.storageId !== a.oldRef) return "changed";
      patch = { [key]: arr.map((m, i) => (i === a.index ? { ...m, storageId: a.mediaId } : m)) };
    } else if (a.path.includes(".")) {
      const [top, leaf] = a.path.split(".");
      const obj = (doc[top] ?? {}) as Record<string, unknown>;
      if (obj[leaf] !== a.oldRef) return "changed";
      patch = { [top]: { ...obj, [leaf]: a.mediaId } };
    } else {
      if (doc[a.path] !== a.oldRef) return "changed";
      patch = { [a.path]: a.mediaId };
    }
    await ctx.db.patch(docId as Id<"orgs">, patch as never);
    await ctx.db.patch(a.mediaId, { attachedAt: Date.now() });
    return "repointed";
  },
});

/** Free the legacy Convex files whose R2 copy has been live for `days` days. Returns the
 *  count; run with a small limit first. */
export const purgeLegacy = internalMutation({
  args: { days: v.number(), limit: v.number() },
  handler: async (ctx, { days, limit }) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("mediaFiles").withIndex("by_attach", (q) => q.eq("status", "ready")).collect();
    let purged = 0;
    for (const r of rows) {
      if (purged >= limit) break;
      if (!r.legacyStorageId || !r.attachedAt || r.attachedAt > cutoff) continue;
      await ctx.storage.delete(r.legacyStorageId).catch(() => undefined);
      await ctx.db.patch(r._id, { legacyStorageId: undefined });
      purged++;
    }
    return { purged };
  },
});

/** Copies ONE file that just arrived in Convex storage to R2 and repoints its row:
 *  the path for clients that still upload to Convex storage (the iOS receipt
 *  upload, an expense receipt). Scheduled by the attaching mutation. The Convex
 *  original is kept (legacyStorageId) and freed by purgeLegacy after the safety
 *  window, exactly like the bulk backfill. Never throws: a file left in Convex
 *  storage still reads, and the backfill script picks it up later. */
export const promote = internalAction({
  args: { table: v.string(), id: v.string(), path: v.string(), ref: v.id("_storage"), scope: v.string(), purpose: v.string(), fileName: v.string() },
  handler: async (ctx, a): Promise<"repointed" | "changed" | "gone" | "skipped"> => {
    try {
      const blob = await ctx.storage.get(a.ref);
      if (!blob) return "gone";
      const ref = await storeBytes(ctx, { scope: a.scope, purpose: a.purpose as MediaPurpose, blob, fileName: a.fileName, actor: "promote", legacyStorageId: a.ref, noFallback: true });
      const mediaId = ref as Id<"mediaFiles">;
      const r = await ctx.runMutation(internal.mediaBackfill.repoint, { table: a.table, id: a.id, path: a.path, oldRef: a.ref, mediaId });
      if (r !== "repointed") await ctx.runMutation(internal.media._discard, { mediaId });
      return r;
    } catch (err) {
      console.warn(`promote ${a.table}.${a.path} ${a.id}: ${err instanceof Error ? err.message : String(err)}`);
      return "skipped";
    }
  },
});
