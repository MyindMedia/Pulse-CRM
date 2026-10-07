import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { SPECS } from "../mediaBackfill";

/* ============================================================
   Legacy Convex storage ids handed in by a client.

   The old upload path (generateUploadUrl, then pass the storage id) lets the
   client name any storage id. Unlike an R2 mediaFiles row, a _storage record
   carries no owner, so an id alone proves nothing: a studio could name a file
   another studio stored, read it back through its own row, have it promoted
   into its own R2 scope, and have the original deleted by the refusal path or
   by purgeLegacy.

   A legacy id is accepted only when it looks like the caller's own fresh
   upload: created within the last hour (per the _storage record) and not
   already referenced by a row of any other workspace, nor by another
   workspace's R2 copy (mediaFiles.legacyStorageId).

   The reference scan covers every table that can hold a file (the backfill's
   SPECS list), limited to rows created since the upload, which is what
   keeps it cheap. Known limit: an OLDER row of another workspace that was
   patched to point at this id within the hour is not seen. That needs the
   other workspace's own fresh, opaque id in the first place.
   ============================================================ */

export const LEGACY_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

type Row = Record<string, unknown>;

function refsAt(r: Row, path: string): string[] {
  if (path.endsWith("[].storageId")) {
    const arr = r[path.slice(0, -"[].storageId".length)];
    return Array.isArray(arr)
      ? arr.flatMap((m) =>
          m && typeof m === "object" && typeof (m as Row).storageId === "string" ? [(m as Row).storageId as string] : [])
      : [];
  }
  let cur: unknown = r;
  for (const p of path.split(".")) cur = cur && typeof cur === "object" ? (cur as Row)[p] : undefined;
  return typeof cur === "string" ? [cur] : [];
}

/** True when `orgId` may treat legacy storage id `ref` as its own upload: it exists,
 *  is under an hour old, and nothing outside `orgId` points at it. */
export async function legacyUploadIsOwn(
  ctx: QueryCtx | MutationCtx,
  ref: string,
  orgId: string,
): Promise<boolean> {
  const meta = await ctx.db.system.get(ref as Id<"_storage">).catch(() => null);
  if (!meta) return false;
  const since = meta._creationTime;
  if (Date.now() - since > LEGACY_UPLOAD_MAX_AGE_MS) return false;

  for (const spec of SPECS) {
    const rows = await ctx.db
      .query(spec.table as "orgs")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
      .collect();
    for (const raw of rows) {
      const r = raw as unknown as Row;
      const holds = spec.fields.some((f) => refsAt(r, f.path).includes(ref));
      // Agency-scoped tables (no orgId) are never the caller's own.
      if (holds && r.orgId !== orgId) return false;
    }
  }

  const copies = await ctx.db
    .query("mediaFiles")
    .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
    .collect();
  if (copies.some((m) => m.legacyStorageId === ref && m.orgId !== orgId)) return false;
  return true;
}
