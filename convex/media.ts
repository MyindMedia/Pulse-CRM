import { query, internalQuery, internalAction, action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { api, internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { resolveViewer, SETUP_ACCESS } from "./lib/access";
import { PURPOSES, makeKey, r2For, fileUrl, resolveBucket, rowBucket, ensureOrgBuckets, type FileRef, type MediaBucket, type MediaPurpose } from "./lib/media";
import { fileRefV } from "./lib/fileRef";

/* ============================================================
   Media API. Three steps, none of which moves the bytes through Convex:
     1. prepareUpload  - checks the caller, mints a one-time signed PUT URL
     2. the browser PUTs the file straight to R2
     3. confirmUpload  - asks R2 what actually arrived (size, type), enforces
                         the purpose's size cap, marks the row ready
   The caller then attaches the returned mediaId to its own row (a deliverable,
   a room photo...), where it sits in the same field as a legacy storage id.
   ============================================================ */

/** Uploads one workspace may start per rolling 24 hours. */
const UPLOADS_PER_DAY = 300;

const purposeV = v.union(
  v.literal("logo"), v.literal("photo"), v.literal("cover"),
  v.literal("video"), v.literal("deliverable"), v.literal("document"), v.literal("receipt"),
);

/** Creates the pending row and the signed upload URL. Callers run their own
 *  authorization first; this only validates what is being uploaded. */
export async function createUpload(
  ctx: MutationCtx,
  a: { scope: string; purpose: MediaPurpose; fileName: string; mimeType: string; size: number; actor: string; /** Backfill only: skip the per-purpose type/size checks and the daily limit. */ trusted?: boolean },
): Promise<{ mediaId: Id<"mediaFiles">; url: string; headers: Record<string, string> }> {
  const rule = PURPOSES[a.purpose];
  if (!Number.isFinite(a.size) || a.size <= 0) throw new ConvexError("That file is empty.");
  if (!a.trusted && a.size > rule.maxBytes) throw new ConvexError(`That file is too large (limit ${Math.round(rule.maxBytes / 1048576)} MB).`);
  if (!a.trusted && a.purpose === "video" && !/^video\/(mp4|quicktime|webm)$/i.test(a.mimeType)) throw new ConvexError("Upload an MP4, MOV or WebM video.");
  if (!a.trusted && rule.image && !/^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/i.test(a.mimeType)) throw new ConvexError("Upload a PNG, JPG, WebP, GIF or AVIF image.");
  // A studio cannot flood the bucket with uploads it never attaches: unclaimed
  // files are swept after a day, and creating them is rate limited.
  const recent = await ctx.db.query("mediaFiles").withIndex("by_org", (q) => q.eq("orgId", a.scope).gte("createdAt", Date.now() - 24 * 60 * 60 * 1000)).take(UPLOADS_PER_DAY);
  if (!a.trusted && recent.length >= UPLOADS_PER_DAY) throw new ConvexError("Too many uploads today. Try again tomorrow.");
  const fileName = a.fileName.slice(0, 160) || "file";
  const key = makeKey(a.scope, a.purpose, fileName);
  // The bucket comes from the owning studio (its own bucket once provisioned),
  // never from the caller.
  const bucketName = await resolveBucket(ctx, a.scope, rule.bucket);
  await ensureOrgBuckets(ctx, a.scope);
  const { url } = await r2For(rule.bucket, bucketName).generateUploadUrl(key);
  const mediaId = await ctx.db.insert("mediaFiles", {
    orgId: a.scope, bucket: rule.bucket, bucketName, key, purpose: a.purpose, fileName, mimeType: a.mimeType.slice(0, 120),
    status: "pending", uploadedBy: a.actor, createdAt: Date.now(),
  });
  return { mediaId, url, headers: { "Content-Type": a.mimeType } };
}

function actorOf(viewer: Awaited<ReturnType<typeof resolveViewer>>): string {
  return "clerkUserId" in viewer ? String(viewer.clerkUserId) : viewer.kind;
}

/** Studio staff upload into their own workspace. Module-specific uploads (agency
 *  logos, guest uploads) call createUpload directly after their own checks. */
export const prepareUpload = mutation({
  args: { purpose: purposeV, fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, a) => {
    // Also the setup wizard's logo upload (SETUP_ACCESS, lib/access.ts).
    const viewer = await resolveViewer(ctx, SETUP_ACCESS);
    if (viewer.kind === "guest") throw new ConvexError("Only studio staff can upload files.");
    const scope = await currentOrg(ctx, SETUP_ACCESS);
    return await createUpload(ctx, { ...a, scope, actor: actorOf(viewer) });
  },
});

/** The pending upload, if it is the caller's. Public so confirmUpload (an action)
 *  can check ownership under the caller's own identity. */
export const myPending = query({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => {
    const row = await ctx.db.get(mediaId);
    if (!row) return null;
    const viewer = await resolveViewer(ctx, SETUP_ACCESS);
    const scope = await currentOrg(ctx, SETUP_ACCESS);
    const mine = row.orgId === scope || (viewer.kind === "agency_member" && row.orgId.startsWith("agency:"));
    if (!mine) return null;
    return { mediaId: row._id, key: row.key, bucket: row.bucket, bucketName: rowBucket(row), purpose: row.purpose, status: row.status };
  },
});

export const confirmUpload = action({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }): Promise<{ mediaId: Id<"mediaFiles">; size: number }> => {
    const row = await ctx.runQuery(api.media.myPending, { mediaId });
    if (!row) throw new ConvexError("Upload not found.");
    const r2 = r2For(row.bucket, row.bucketName);
    await r2.syncMetadata(ctx, row.key);
    const meta = await r2.getMetadata(ctx, row.key);
    if (!meta || !meta.size) throw new ConvexError("The file did not arrive. Try uploading again.");
    const max = PURPOSES[row.purpose as MediaPurpose]?.maxBytes ?? 0;
    if (max && meta.size > max) {
      await ctx.runMutation(internal.media._discard, { mediaId });
      throw new ConvexError(`That file is too large (limit ${Math.round(max / 1048576)} MB).`);
    }
    await ctx.runMutation(internal.media._markReady, { mediaId, size: meta.size, contentType: meta.contentType });
    return { mediaId, size: meta.size };
  },
});

export const _markReady = internalMutation({
  args: { mediaId: v.id("mediaFiles"), size: v.number(), contentType: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.mediaId);
    if (!row || row.status === "ready") return null;
    await ctx.db.patch(a.mediaId, { status: "ready", size: a.size, readyAt: Date.now() });
    return null;
  },
});

/** Removes a row and its object (oversized or abandoned uploads). */
export const _discard = internalMutation({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => {
    const row = await ctx.db.get(mediaId);
    if (!row) return null;
    await ctx.db.delete(mediaId);
    await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket: row.bucket, key: row.key, bucketName: rowBucket(row) });
    return null;
  },
});

export const _deleteObject = internalAction({
  // bucketName is the bucket the row recorded (resolved through rowBucket, which
  // refuses another studio's bucket). Omitted on jobs queued before per-studio buckets.
  args: { bucket: v.union(v.literal("media"), v.literal("private")), key: v.string(), bucketName: v.optional(v.string()) },
  handler: async (ctx, { bucket, key, bucketName }): Promise<null> => {
    await r2For(bucket as MediaBucket, bucketName).deleteObject(ctx, key);
    return null;
  },
});

const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

/** Uploads that never finished (tab closed, network drop) leave a pending row and
 *  possibly a half object, and confirmed uploads can go unclaimed. Sweep both after a day, in small batches. */
export const sweepPending = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const cutoff = Date.now() - ABANDONED_AFTER_MS;
    const stale = await ctx.db.query("mediaFiles").withIndex("by_status", (q) => q.eq("status", "pending").lt("createdAt", cutoff)).take(100);
    for (const row of stale) {
      await ctx.db.delete(row._id);
      await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket: row.bucket, key: row.key, bucketName: rowBucket(row) });
    }
    // Confirmed uploads that no row ever claimed (the user abandoned the form).
    const unclaimed = await ctx.db.query("mediaFiles").withIndex("by_attach", (q) => q.eq("status", "ready").eq("attachedAt", undefined).lt("createdAt", cutoff)).take(100);
    for (const row of unclaimed) {
      await ctx.db.delete(row._id);
      await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket: row.bucket, key: row.key, bucketName: rowBucket(row) });
    }
    if (stale.length === 100 || unclaimed.length === 100) await ctx.scheduler.runAfter(0, internal.media.sweepPending, {});
    return null;
  },
});

/** For tests and support: what the row says. */
export const _row = internalQuery({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => await ctx.db.get(mediaId),
});

/** Signed or public URL for a stored file. For actions, which cannot read the database. */
export const _fileUrl = internalQuery({
  args: { ref: fileRefV, expiresIn: v.optional(v.number()) },
  handler: async (ctx, { ref, expiresIn }) => await fileUrl(ctx, ref, { expiresIn }),
});

/** The bytes of a stored file, from either store, for an action that must read them
 *  (receipt extraction). Legacy Convex storage is read directly; an R2 file is
 *  fetched through a short-lived signed URL. */
export async function readFileBlob(
  ctx: { storage: { get(id: Id<"_storage">): Promise<Blob | null> }; runQuery: (fn: typeof internal.media._fileUrl, args: { ref: FileRef; expiresIn?: number }) => Promise<string | null> },
  ref: FileRef,
): Promise<Blob | null> {
  try {
    const legacy = await ctx.storage.get(ref as Id<"_storage">);
    if (legacy) return legacy;
  } catch {
    // not a Convex storage id: fall through to R2
  }
  const url = await ctx.runQuery(internal.media._fileUrl, { ref, expiresIn: 300 });
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? await res.blob() : null;
}

/* ── Server-side writes ───────────────────────────────────────
   Bytes an action already holds (a generated hero, a logo fetched from a
   studio's website, an imported cover) go to R2 the same way a browser upload
   does: a mediaFiles row in the studio's scope, in the studio's bucket, marked
   ready once the object is there. The caller's mutation then claims it
   (claimFile), so an orphan is swept after a day like any other upload. */

/** Pending row for a server-side write. Returns where the bytes must go. */
export const _reserveStored = internalMutation({
  args: {
    scope: v.string(), purpose: purposeV, fileName: v.string(), mimeType: v.string(), size: v.number(), actor: v.string(), legacyStorageId: v.optional(v.id("_storage")),
    /** false for bytes a third party chose (an inbound email attachment): the
     *  per-purpose checks and the daily limit apply. Unset = our own bytes. */
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, a): Promise<{ mediaId: Id<"mediaFiles">; key: string; bucket: MediaBucket; bucketName: string }> => {
    const { mediaId } = await createUpload(ctx, { scope: a.scope, purpose: a.purpose, fileName: a.fileName, mimeType: a.mimeType, size: a.size, actor: a.actor, trusted: a.trusted !== false });
    if (a.legacyStorageId) await ctx.db.patch(mediaId, { legacyStorageId: a.legacyStorageId });
    const row = (await ctx.db.get(mediaId))!;
    return { mediaId, key: row.key, bucket: row.bucket, bucketName: rowBucket(row) };
  },
});

/** True when the error means this deployment has no R2 settings. */
export function isR2NotConfigured(err: unknown): boolean {
  return err instanceof Error && /R2 is not configured/i.test(err.message);
}

/** Stores bytes in R2 under `scope` and returns the ready (unclaimed) mediaFiles id.
 *  On a deployment with no R2 settings at all it falls back to Convex storage, the
 *  same fallback the browser uploads use, so local and preview deployments keep
 *  working; production has R2 configured and never takes this path. */
export async function storeBytes(
  ctx: ActionCtx,
  a: {
    scope: string; purpose: MediaPurpose; blob: Blob; fileName: string; mimeType?: string; actor: string; legacyStorageId?: Id<"_storage">; noFallback?: boolean;
    /** Content-Disposition R2 serves the object with (e.g. a forced download). */
    disposition?: string;
    /** Bytes from outside (an email sender): not exempt from upload checks. */
    untrusted?: boolean;
  },
): Promise<FileRef> {
  const rule = PURPOSES[a.purpose];
  if (a.blob.size <= 0) throw new ConvexError("That file is empty.");
  if (a.blob.size > rule.maxBytes) throw new ConvexError(`That file is too large (limit ${Math.round(rule.maxBytes / 1048576)} MB).`);
  const mimeType = (a.mimeType || a.blob.type || "application/octet-stream").slice(0, 120);
  let spot: { mediaId: Id<"mediaFiles">; key: string; bucket: MediaBucket; bucketName: string };
  try {
    spot = await ctx.runMutation(internal.media._reserveStored, {
      scope: a.scope, purpose: a.purpose, fileName: a.fileName, mimeType, size: a.blob.size, actor: a.actor, legacyStorageId: a.legacyStorageId,
      ...(a.untrusted ? { trusted: false } : {}),
    });
  } catch (err) {
    if (!a.noFallback && isR2NotConfigured(err)) {
      console.warn(`storeBytes: R2 is not configured, keeping ${a.purpose} in Convex storage`);
      return await ctx.storage.store(a.blob);
    }
    throw err;
  }
  try {
    await r2For(spot.bucket, spot.bucketName).store(ctx, a.blob, { key: spot.key, type: mimeType, ...(a.disposition ? { disposition: a.disposition } : {}) });
  } catch (err) {
    await ctx.runMutation(internal.media._discard, { mediaId: spot.mediaId });
    throw err;
  }
  await ctx.runMutation(internal.media._markReady, { mediaId: spot.mediaId, size: a.blob.size });
  return spot.mediaId;
}
