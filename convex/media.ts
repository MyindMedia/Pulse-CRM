import { query, internalQuery, internalAction, action } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { api, internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import { PURPOSES, makeKey, r2For, fileUrl, type FileRef, type MediaBucket, type MediaPurpose } from "./lib/media";
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

const purposeV = v.union(
  v.literal("logo"), v.literal("photo"), v.literal("cover"),
  v.literal("deliverable"), v.literal("document"), v.literal("receipt"),
);

/** Creates the pending row and the signed upload URL. Callers run their own
 *  authorization first; this only validates what is being uploaded. */
export async function createUpload(
  ctx: MutationCtx,
  a: { scope: string; purpose: MediaPurpose; fileName: string; mimeType: string; size: number; actor: string },
): Promise<{ mediaId: Id<"mediaFiles">; url: string; headers: Record<string, string> }> {
  const rule = PURPOSES[a.purpose];
  if (!Number.isFinite(a.size) || a.size <= 0) throw new ConvexError("That file is empty.");
  if (a.size > rule.maxBytes) throw new ConvexError(`That file is too large (limit ${Math.round(rule.maxBytes / 1048576)} MB).`);
  if (rule.image && !/^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/i.test(a.mimeType)) throw new ConvexError("Upload a PNG, JPG, WebP, GIF or AVIF image.");
  const fileName = a.fileName.slice(0, 160) || "file";
  const key = makeKey(a.scope, a.purpose, fileName);
  const { url } = await r2For(rule.bucket).generateUploadUrl(key);
  const mediaId = await ctx.db.insert("mediaFiles", {
    orgId: a.scope, bucket: rule.bucket, key, purpose: a.purpose, fileName, mimeType: a.mimeType.slice(0, 120),
    status: "pending", uploadedBy: a.actor, createdAt: Date.now(),
  });
  return { mediaId, url, headers: { "Content-Type": a.mimeType } };
}

async function actorOf(ctx: Parameters<typeof resolveViewer>[0]): Promise<string> {
  const viewer = await resolveViewer(ctx);
  return "clerkUserId" in viewer ? String(viewer.clerkUserId) : viewer.kind;
}

/** Studio staff upload into their own workspace. Module-specific uploads (agency
 *  logos, guest uploads) call createUpload directly after their own checks. */
export const prepareUpload = mutation({
  args: { purpose: purposeV, fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, a) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind === "guest") throw new ConvexError("Only studio staff can upload files.");
    const scope = await currentOrg(ctx);
    return await createUpload(ctx, { ...a, scope, actor: await actorOf(ctx) });
  },
});

/** The pending upload, if it is the caller's. Public so confirmUpload (an action)
 *  can check ownership under the caller's own identity. */
export const myPending = query({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => {
    const row = await ctx.db.get(mediaId);
    if (!row) return null;
    const viewer = await resolveViewer(ctx);
    const scope = await currentOrg(ctx);
    const mine = row.orgId === scope || (viewer.kind === "agency_member" && row.orgId.startsWith("agency:"));
    if (!mine) return null;
    return { mediaId: row._id, key: row.key, bucket: row.bucket, purpose: row.purpose, status: row.status };
  },
});

export const confirmUpload = action({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }): Promise<{ mediaId: Id<"mediaFiles">; size: number }> => {
    const row = await ctx.runQuery(api.media.myPending, { mediaId });
    if (!row) throw new ConvexError("Upload not found.");
    const r2 = r2For(row.bucket);
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
    await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket: row.bucket, key: row.key });
    return null;
  },
});

export const _deleteObject = internalAction({
  args: { bucket: v.union(v.literal("media"), v.literal("private")), key: v.string() },
  handler: async (ctx, { bucket, key }): Promise<null> => {
    await r2For(bucket as MediaBucket).deleteObject(ctx, key);
    return null;
  },
});

/** Schedules deletion of one R2 object. Used by lib/media.deleteFile. */
export async function scheduleObjectDelete(ctx: MutationCtx, bucket: MediaBucket, key: string): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket, key });
}

const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

/** Uploads that never finished (tab closed, network drop) leave a pending row and
 *  possibly a half object. Sweep them after a day, in small batches. */
export const sweepPending = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const cutoff = Date.now() - ABANDONED_AFTER_MS;
    const stale = await ctx.db.query("mediaFiles").withIndex("by_status", (q) => q.eq("status", "pending").lt("createdAt", cutoff)).take(100);
    for (const row of stale) {
      await ctx.db.delete(row._id);
      await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket: row.bucket, key: row.key });
    }
    if (stale.length === 100) await ctx.scheduler.runAfter(0, internal.media.sweepPending, {});
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
