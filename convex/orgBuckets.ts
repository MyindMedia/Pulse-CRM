import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { r2For, rowBucket, type MediaBucket } from "./lib/media";
import { bucketBelongsTo, isOrgBucketName, isStudioScope, orgBucketNames, sharedBucketName, type BucketRole } from "./lib/orgBuckets";

/* ============================================================
   Per-studio R2 buckets: provisioning, release and the move of files already in
   the shared buckets. Design and the manual Cloudflare steps:
   docs/R2-PER-ORG-BUCKETS.md.

   Provisioning creates two buckets through the Cloudflare REST API with an
   account token that may create buckets (CF_R2_ADMIN_TOKEN). It is idempotent
   ("already exists" counts as created), dry-runnable, and never blocks an
   upload: until an org is "ready" its files go to the shared buckets.
   ============================================================ */

const CF_API = "https://api.cloudflare.com/client/v4";
const ROLES: BucketRole[] = ["media", "private"];

type Cf = { account: string; token: string };

/** Cloudflare credentials, or null when this deployment cannot create buckets. The
 *  account id defaults to the one in R2_ENDPOINT. */
export function cfConfig(): Cf | null {
  const token = process.env.CF_R2_ADMIN_TOKEN;
  const account = process.env.CF_ACCT || /^https:\/\/([0-9a-f]{32})\.r2\.cloudflarestorage\.com/i.exec(process.env.R2_ENDPOINT ?? "")?.[1];
  return token && account ? { token, account } : null;
}

type CfAnswer = { ok: boolean; status: number; codes: number[]; message: string; result?: unknown };

async function cf(c: Cf, method: string, path: string, body?: unknown): Promise<CfAnswer> {
  const res = await fetch(`${CF_API}/accounts/${c.account}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: { success?: boolean; errors?: { code: number; message: string }[]; result?: unknown } = {};
  try { json = await res.json(); } catch { /* empty body */ }
  const errors = json.errors ?? [];
  return { ok: res.ok && json.success !== false, status: res.status, codes: errors.map((e) => e.code), message: errors.map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${res.status}`, result: json.result };
}

/** Creates a bucket; one that already exists in this account counts as created. */
async function createBucket(c: Cf, name: string): Promise<void> {
  const r = await cf(c, "POST", "/r2/buckets", { name });
  if (r.ok || r.status === 409 || r.codes.includes(10004)) return;
  throw new Error(`create ${name}: ${r.message}`);
}

/** Browser uploads PUT straight to R2 with a presigned URL, so each bucket needs CORS. */
async function setCors(c: Cf, name: string): Promise<void> {
  const origins = (process.env.R2_CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const r = await cf(c, "PUT", `/r2/buckets/${name}/cors`, {
    rules: [{ allowed: { methods: ["GET", "PUT", "HEAD"], origins, headers: ["*"] }, exposeHeaders: ["ETag", "Content-Length"], maxAgeSeconds: 3600 }],
  });
  if (!r.ok) throw new Error(`cors ${name}: ${r.message}`);
}

export const _org = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    return { orgId: org.orgId, slug: org.slug, status: org.r2BucketStatus ?? null, media: org.r2MediaBucket ?? null, private: org.r2PrivateBucket ?? null };
  },
});

const namesV = v.object({ media: v.string(), private: v.string() });

function assertOwned(orgId: string, names: { media: string; private: string }) {
  if (!bucketBelongsTo(orgId, names.media, "media") || !bucketBelongsTo(orgId, names.private, "private")) {
    throw new Error("Bucket names do not belong to this studio.");
  }
}

export const _markReady = internalMutation({
  args: { orgId: v.string(), names: namesV },
  handler: async (ctx, { orgId, names }) => {
    assertOwned(orgId, names);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    await ctx.db.patch(org._id, { r2MediaBucket: names.media, r2PrivateBucket: names.private, r2BucketStatus: "ready", r2ProvisionedAt: Date.now(), r2ProvisionError: undefined });
    return null;
  },
});

export const _markPending = internalMutation({
  args: { orgId: v.string(), names: namesV, error: v.string() },
  handler: async (ctx, { orgId, names, error }) => {
    assertOwned(orgId, names);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org || org.r2BucketStatus === "ready") return null;
    await ctx.db.patch(org._id, { r2MediaBucket: names.media, r2PrivateBucket: names.private, r2BucketStatus: "pending", r2ProvisionAttemptAt: Date.now(), r2ProvisionError: error.slice(0, 300) });
    return null;
  },
});

type ProvisionResult = { orgId: string; ok: boolean; names?: { media: string; private: string }; dryRun?: boolean; already?: boolean; reason?: string };

/** Creates (or confirms) one studio's two buckets, then marks the org ready. Safe to
 *  re-run. dryRun returns the names it would create and touches nothing. */
export const provision = internalAction({
  args: { orgId: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, dryRun }): Promise<ProvisionResult> => {
    if (!isStudioScope(orgId)) return { orgId, ok: false, reason: "agency files stay in the shared buckets" };
    const org = await ctx.runQuery(internal.orgBuckets._org, { orgId });
    if (!org) return { orgId, ok: false, reason: "org not found" };
    const names = org.media && org.private ? { media: org.media, private: org.private } : orgBucketNames(orgId, org.slug);
    if (dryRun) return { orgId, ok: true, dryRun: true, names };
    if (org.status === "ready") return { orgId, ok: true, already: true, names };
    const c = cfConfig();
    if (!c) {
      const reason = "not configured: CF_R2_ADMIN_TOKEN (and CF_ACCT or R2_ENDPOINT) must be set";
      await ctx.runMutation(internal.orgBuckets._markPending, { orgId, names, error: reason });
      return { orgId, ok: false, names, reason };
    }
    try {
      for (const role of ROLES) {
        await createBucket(c, names[role]);
        await setCors(c, names[role]);
      }
      await ctx.runMutation(internal.orgBuckets._markReady, { orgId, names });
      return { orgId, ok: true, names };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.orgBuckets._markPending, { orgId, names, error: reason });
      return { orgId, ok: false, names, reason };
    }
  },
});

export const _unprovisioned = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const out: string[] = [];
    for await (const org of ctx.db.query("orgs")) {
      if (org.r2BucketStatus !== "ready") out.push(org.orgId);
      if (out.length >= limit) break;
    }
    return out;
  },
});

/** Backfill for existing studios. Dry run by default: lists the buckets it would
 *  create and checks them against the account's bucket quota (R2_BUCKET_QUOTA,
 *  Cloudflare's default is 1,000 per account). With dryRun:false it provisions one
 *  org at a time and refuses to start if the quota would be exceeded. */
export const provisionAll = internalAction({
  args: { dryRun: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, { dryRun = true, limit = 500 }): Promise<{ dryRun: boolean; orgs: number; bucketsNeeded: number; existingBuckets: number | null; quota: number; results: ProvisionResult[]; refused?: string }> => {
    const orgIds: string[] = await ctx.runQuery(internal.orgBuckets._unprovisioned, { limit });
    const quota = Number(process.env.R2_BUCKET_QUOTA || 1000);
    const c = cfConfig();
    let existingBuckets: number | null = null;
    if (c) {
      const r = await cf(c, "GET", "/r2/buckets?per_page=1000");
      const list = (r.result as { buckets?: unknown[] } | undefined)?.buckets;
      existingBuckets = Array.isArray(list) ? list.length : null;
    }
    const bucketsNeeded = orgIds.length * 2;
    const base = { dryRun, orgs: orgIds.length, bucketsNeeded, existingBuckets, quota };
    if (dryRun) {
      const results: ProvisionResult[] = [];
      for (const orgId of orgIds) results.push(await ctx.runAction(internal.orgBuckets.provision, { orgId, dryRun: true }));
      return { ...base, results };
    }
    if (existingBuckets !== null && existingBuckets + bucketsNeeded > quota) {
      return { ...base, results: [], refused: `Would need ${existingBuckets + bucketsNeeded} buckets, over the quota of ${quota}. Ask Cloudflare to raise the R2 bucket limit first.` };
    }
    const results: ProvisionResult[] = [];
    for (const orgId of orgIds) results.push(await ctx.runAction(internal.orgBuckets.provision, { orgId }));
    return { ...base, results };
  },
});

/** Deletes a removed studio's buckets. R2 only deletes an empty bucket, so this
 *  runs after the object deletes; a bucket still holding objects is reported, not forced. */
export const releaseBuckets = internalAction({
  args: { orgId: v.string(), names: v.array(v.string()) },
  handler: async (_ctx, { orgId, names }): Promise<{ released: string[]; kept: string[] }> => {
    const c = cfConfig();
    const released: string[] = [];
    const kept: string[] = [];
    for (const name of names) {
      if (!bucketBelongsTo(orgId, name) || !c) { kept.push(name); continue; }
      const r = await cf(c, "DELETE", `/r2/buckets/${name}`);
      if (r.ok || r.status === 404) released.push(name);
      else { kept.push(name); console.warn(`releaseBuckets: kept ${name}: ${r.message}`); }
    }
    return { released, kept };
  },
});

/* ── Moving files already in the shared buckets ────────────────
   Driven by scripts/r2/migrate-to-org-buckets.mjs from a laptop (large audio does
   not fit an action's memory). The shared copy is NOT deleted by a move: the row
   records sharedCopyAt and purgeSharedCopies removes it after a safety window. */

export const migrationPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const res = await ctx.db.query("mediaFiles").paginate({ numItems: limit, cursor });
    const ready = new Map<string, boolean>();
    const items: Array<{ mediaId: Id<"mediaFiles">; orgId: string; size: number }> = [];
    for (const row of res.page) {
      if (row.status !== "ready" || !isStudioScope(row.orgId) || isOrgBucketName(rowBucket(row))) continue;
      if (!ready.has(row.orgId)) {
        const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", row.orgId)).first();
        ready.set(row.orgId, org?.r2BucketStatus === "ready");
      }
      if (ready.get(row.orgId)) items.push({ mediaId: row._id, orgId: row.orgId, size: row.size ?? 0 });
    }
    return { items, cursor: res.isDone ? null : res.continueCursor };
  },
});

/** Signed GET from the shared bucket and signed PUT into the studio's own bucket, same key. */
export const startMove = internalMutation({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => {
    const row = await ctx.db.get(mediaId);
    if (!row || row.status !== "ready") return null;
    const from = rowBucket(row);
    if (isOrgBucketName(from)) return null; // already moved
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", row.orgId)).first();
    const to = row.bucket === "media" ? org?.r2MediaBucket : org?.r2PrivateBucket;
    if (org?.r2BucketStatus !== "ready" || !to || !bucketBelongsTo(row.orgId, to, row.bucket)) return null;
    const getUrl = await r2For(row.bucket, from).getUrl(row.key, { expiresIn: 3600 });
    const { url: putUrl } = await r2For(row.bucket, to).generateUploadUrl(row.key);
    return { getUrl, putUrl, toBucket: to, size: row.size ?? 0, contentType: row.mimeType };
  },
});

/** After the PUT: the copy must match the recorded size before the row moves. */
export const finishMove = internalAction({
  args: { mediaId: v.id("mediaFiles"), toBucket: v.string(), expectedSize: v.number() },
  handler: async (ctx, { mediaId, toBucket, expectedSize }): Promise<{ ok: boolean; reason?: string }> => {
    const row = await ctx.runQuery(internal.media._row, { mediaId });
    if (!row) return { ok: false, reason: "row missing" };
    if (!bucketBelongsTo(row.orgId, toBucket, row.bucket)) return { ok: false, reason: "bucket is not this studio's" };
    const r2 = r2For(row.bucket as MediaBucket, toBucket);
    await r2.syncMetadata(ctx, row.key);
    const meta = await r2.getMetadata(ctx, row.key);
    if (!meta || (expectedSize > 0 && meta.size !== expectedSize)) return { ok: false, reason: `size mismatch (copy ${meta?.size ?? "none"}, expected ${expectedSize})` };
    await ctx.runMutation(internal.orgBuckets._repointBucket, { mediaId, toBucket });
    return { ok: true };
  },
});

export const _repointBucket = internalMutation({
  args: { mediaId: v.id("mediaFiles"), toBucket: v.string() },
  handler: async (ctx, { mediaId, toBucket }) => {
    const row = await ctx.db.get(mediaId);
    if (!row || isOrgBucketName(rowBucket(row))) return "unchanged";
    if (!bucketBelongsTo(row.orgId, toBucket, row.bucket)) throw new Error("Bucket is not this studio's.");
    await ctx.db.patch(mediaId, { bucketName: toBucket, sharedCopyAt: Date.now() });
    return "moved";
  },
});

export const _sharedCopies = internalQuery({
  args: { before: v.number(), limit: v.number() },
  handler: async (ctx, { before, limit }) => {
    const out: Array<{ mediaId: Id<"mediaFiles">; bucket: MediaBucket; key: string }> = [];
    for await (const row of ctx.db.query("mediaFiles")) {
      if (row.sharedCopyAt && row.sharedCopyAt < before) out.push({ mediaId: row._id, bucket: row.bucket, key: row.key });
      if (out.length >= limit) break;
    }
    return out;
  },
});

export const _clearSharedCopy = internalMutation({
  args: { mediaId: v.id("mediaFiles") },
  handler: async (ctx, { mediaId }) => {
    const row = await ctx.db.get(mediaId);
    if (row) await ctx.db.patch(mediaId, { sharedCopyAt: undefined });
    return null;
  },
});

/** Deletes shared-bucket originals of files moved `days`+ days ago. Dry run by default. */
export const purgeSharedCopies = internalAction({
  args: { days: v.number(), limit: v.number(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { days, limit, dryRun = true }): Promise<{ dryRun: boolean; candidates: number; purged: number }> => {
    const rows = await ctx.runQuery(internal.orgBuckets._sharedCopies, { before: Date.now() - days * 86_400_000, limit });
    if (dryRun) return { dryRun, candidates: rows.length, purged: 0 };
    let purged = 0;
    for (const r of rows) {
      await r2For(r.bucket, sharedBucketName(r.bucket)).deleteObject(ctx, r.key);
      await ctx.runMutation(internal.orgBuckets._clearSharedCopy, { mediaId: r.mediaId });
      purged++;
    }
    return { dryRun, candidates: rows.length, purged };
  },
});
