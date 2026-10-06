import { R2 } from "@convex-dev/r2";
import { components, internal } from "../_generated/api";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/* ============================================================
   Media: file bytes live in Cloudflare R2, never in Convex storage.
   Convex keeps the row (mediaFiles) and the R2 object key.

     media    pulse-media bucket, public through the pulse-media Worker.
              Photos, logos, covers: anything shown to many people.
     private  pulse-private bucket, never public. Deliverables (the songs a
              client may only get once paid), receipts, documents. Read through
              short-lived signed URLs minted after the caller passes its gate.

   A file reference stored in another table is either a legacy Convex storage
   id or a mediaFiles id, so existing rows keep working while new uploads go to
   R2. fileUrl() reads either.
   ============================================================ */

export type MediaBucket = "media" | "private";
export type FileRef = Id<"_storage"> | Id<"mediaFiles">;

const clients: Partial<Record<MediaBucket, R2>> = {};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`R2 is not configured: ${name} is not set on this deployment.`);
  return v;
}

export function r2For(bucket: MediaBucket): R2 {
  let c = clients[bucket];
  if (!c) {
    c = new R2(components.r2, {
      bucket: need(bucket === "media" ? "R2_MEDIA_BUCKET" : "R2_PRIVATE_BUCKET"),
      endpoint: need("R2_ENDPOINT"),
      accessKeyId: need("R2_ACCESS_KEY_ID"),
      secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
    });
    clients[bucket] = c;
  }
  return c;
}

/** Per-purpose limits. A purpose also fixes the bucket, so a caller can never
 *  choose to put private files in the public bucket. */
export const PURPOSES = {
  logo: { bucket: "media", maxBytes: 10 * MB(), image: true },
  photo: { bucket: "media", maxBytes: 25 * MB(), image: true },
  cover: { bucket: "media", maxBytes: 25 * MB(), image: true },
  deliverable: { bucket: "private", maxBytes: 2048 * MB(), image: false },
  video: { bucket: "media", maxBytes: 200 * MB(), image: false },
  document: { bucket: "private", maxBytes: 100 * MB(), image: false },
  receipt: { bucket: "private", maxBytes: 25 * MB(), image: false },
} as const satisfies Record<string, { bucket: MediaBucket; maxBytes: number; image: boolean }>;
export type MediaPurpose = keyof typeof PURPOSES;

function MB() { return 1024 * 1024; }

const safe = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "file";
const extOf = (s: string) => (/\.([a-z0-9]{1,8})$/i.exec(s)?.[1] ?? "").toLowerCase();

/** <prefix>/<scope>/<purpose>/<name>-<uuid>.<ext>. The uuid sits last so the
 *  Worker treats the key as content-hashed and caches it forever (keys are
 *  never overwritten; replacing a file mints a new key). */
export function makeKey(scope: string, purpose: MediaPurpose, fileName: string): string {
  const prefix = process.env.R2_KEY_PREFIX || "dev";
  const ext = extOf(fileName);
  const scopeSafe = scope.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${prefix}/${scopeSafe}/${purpose}/${safe(fileName)}-${crypto.randomUUID()}${ext ? "." + ext : ""}`;
}

export function publicUrl(key: string): string {
  return `${(process.env.R2_PUBLIC_URL ?? "https://pulse-media.myindmedia.workers.dev").replace(/\/$/, "")}/${key}`;
}

type Reader = QueryCtx | MutationCtx;

async function asMedia(ctx: Reader, ref: string) {
  const id = ctx.db.normalizeId("mediaFiles", ref);
  return id ? await ctx.db.get(id) : null;
}

/** A URL for a stored file, whichever store holds it. Private files get a signed
 *  URL that expires (default one hour); the caller must have passed its own gate
 *  before asking. Returns null when the file is gone or not finished uploading. */
export async function fileUrl(ctx: Reader, ref: FileRef | null | undefined, opts: { expiresIn?: number } = {}): Promise<string | null> {
  if (!ref) return null;
  const row = await asMedia(ctx, ref);
  if (row) {
    if (row.status !== "ready") return null;
    if (row.bucket === "media") return publicUrl(row.key);
    return await r2For("private").getUrl(row.key, { expiresIn: opts.expiresIn ?? 3600 });
  }
  return await ctx.storage.getUrl(ref as Id<"_storage">);
}

/** Size in bytes of a stored file, whichever store holds it (0 if unknown). */
export async function fileSize(ctx: Reader, ref: FileRef | null | undefined): Promise<number> {
  if (!ref) return 0;
  const row = await asMedia(ctx, ref);
  if (row) return row.status === "ready" ? row.size ?? 0 : 0;
  return (await ctx.db.system.get(ref as Id<"_storage">))?.size ?? 0;
}

/** Deletes the file: legacy storage immediately, R2 objects through a scheduled
 *  action (the row is removed in the same transaction so nothing can point at it). */
export async function deleteFile(ctx: MutationCtx, ref: FileRef | null | undefined): Promise<void> {
  if (!ref) return;
  const row = await asMedia(ctx, ref);
  if (row) {
    await ctx.db.delete(row._id);
    await ctx.scheduler.runAfter(0, internal.media._deleteObject, { bucket: row.bucket, key: row.key });
    return;
  }
  await ctx.storage.delete(ref as Id<"_storage">);
}

/** Call from every mutation that stores a file reference. For an R2 file it checks
 *  the upload is finished and belongs to `scope`, then marks it attached so the
 *  orphan sweeper leaves it alone. Legacy storage ids pass through untouched. */
export async function claimFile(ctx: MutationCtx, ref: FileRef | null | undefined, scope: string): Promise<void> {
  if (!ref) return;
  const row = await asMedia(ctx, ref);
  if (!row) return;
  if (row.orgId !== scope) throw new Error("Upload not found.");
  if (row.status !== "ready") throw new Error("The upload has not finished.");
  if (!row.attachedAt) await ctx.db.patch(row._id, { attachedAt: Date.now() });
}

/** Call when a reference is replaced or cleared. Frees an R2 file that nothing else
 *  points at. Legacy storage files are left to their existing cleanup. */
export async function retireFile(ctx: MutationCtx, previous: FileRef | null | undefined, next?: FileRef | null): Promise<void> {
  if (!previous || previous === next) return;
  if (await asMedia(ctx, previous)) await deleteFile(ctx, previous);
}
