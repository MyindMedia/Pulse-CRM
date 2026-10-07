/* ============================================================
   Per-studio R2 buckets. Every studio org gets two buckets of its own:

     pulse-<env>-<slug>-<tag>-media     public, served by the pulse-media Worker
     pulse-<env>-<slug>-<tag>-private   signed URLs only

   <tag> is 8 hex chars hashed from the orgId, so a name is deterministic, unique
   per org even when two slugs collide, and lets any code check that a bucket
   belongs to an org without a database read (bucketBelongsTo).

   Until an org's buckets are provisioned (orgs.r2BucketStatus === "ready"), or when
   R2_PER_ORG_BUCKETS is off, files go to the shared buckets (R2_MEDIA_BUCKET /
   R2_PRIVATE_BUCKET) so uploads never break. Every mediaFiles row records the
   bucket it lives in (bucketName); rows without one are in the shared bucket.
   See docs/R2-PER-ORG-BUCKETS.md.
   ============================================================ */

export type BucketRole = "media" | "private";

/** Feature flag. Off: everything stays in the shared buckets (today's behaviour). */
export function orgBucketsEnabled(): boolean {
  return /^(1|true|on)$/i.test(process.env.R2_PER_ORG_BUCKETS ?? "");
}

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Short environment label in the name, so dev and prod never share a bucket. */
export function bucketEnv(): string {
  return clean(process.env.R2_BUCKET_ENV || process.env.R2_KEY_PREFIX || "dev").slice(0, 8).replace(/-+$/, "") || "dev";
}

/** FNV-1a 32-bit of the orgId, as 8 hex chars. Deterministic and dependency free. */
export function orgTag(orgId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < orgId.length; i++) {
    h ^= orgId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The two bucket names for an org. S3/R2 rules: 3-63 chars, lowercase letters,
 *  digits and hyphens, starting and ending with a letter or digit. */
export function orgBucketNames(orgId: string, slug?: string | null): Record<BucketRole, string> {
  const env = bucketEnv();
  // "pulse-" + env(<=8) + "-" + slug + "-" + tag(8) + "-private"(8) <= 63  =>  slug <= 31
  const slugPart = clean(slug || orgId).slice(0, 24).replace(/-+$/, "") || "studio";
  const base = `pulse-${env}-${slugPart}-${orgTag(orgId)}`;
  return { media: `${base}-media`, private: `${base}-private` };
}

const ORG_BUCKET = /^pulse-[a-z0-9-]+-[0-9a-f]{8}-(media|private)$/;

export function isOrgBucketName(name: string): boolean {
  return name.length >= 3 && name.length <= 63 && ORG_BUCKET.test(name);
}

/** True when `name` is one of this org's own buckets (by the hashed tag), in the right role. */
export function bucketBelongsTo(orgId: string, name: string, role?: BucketRole): boolean {
  if (!isOrgBucketName(name)) return false;
  const tag = orgTag(orgId);
  return role ? name.endsWith(`-${tag}-${role}`) : name.endsWith(`-${tag}-media`) || name.endsWith(`-${tag}-private`);
}

/** Agency-owned files ("agency:<id>") are not a studio's and stay in the shared buckets. */
export function isStudioScope(scope: string): boolean {
  return !scope.startsWith("agency:");
}

export function sharedBucketName(role: BucketRole): string {
  const name = role === "media" ? "R2_MEDIA_BUCKET" : "R2_PRIVATE_BUCKET";
  const v = process.env[name];
  if (!v) throw new Error(`R2 is not configured: ${name} is not set on this deployment.`);
  return v;
}
