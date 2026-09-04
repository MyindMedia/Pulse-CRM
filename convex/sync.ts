/* The delta feed the native clients sync against.
 *
 * Two reads. `snapshot` hydrates a table the first time a device sees it;
 * `pullChanges` streams everything that happened since a cursor. Both are
 * ordinary Convex queries resolving the caller's org through the access engine,
 * which is the entire point: authorization for the Mac app is the same code
 * that authorizes the web app, not a second dialect of it that has to be kept
 * in step.
 */
import { query } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import type { Id, TableNames } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { MIRRORED_TABLES, isMirroredTable } from "./lib/mirroredTables";

/** Convex caps a page at 1000; 500 keeps a pull comfortably inside a round trip. */
const MAX_PAGE = 500;
const DEFAULT_PAGE = 200;

function pageSize(requested?: number): number {
  if (!requested || requested < 1) return DEFAULT_PAGE;
  return Math.min(requested, MAX_PAGE);
}

/** The tables a client may mirror, so a device can discover the set it should hold.
 *
 *  Gated like every other sync read. The list itself is not a secret, but every
 *  Convex function is publicly invocable at the deployment URL, and a sync
 *  surface with one ungated door on it is the kind of inconsistency that later
 *  gets copied into a function where it does matter. */
export const mirroredTables = query({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return [...MIRRORED_TABLES];
  },
});

/**
 * A page of one table's current rows, for a device hydrating it the first time.
 *
 * Paginated on the table's `by_org` index, so it never scans another studio's
 * rows. Feed `cursor` back until `isDone`.
 */
export const snapshot = query({
  args: {
    table: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { table, cursor, limit }) => {
    const orgId = await currentOrg(ctx);
    if (!isMirroredTable(table)) {
      throw new Error(`Table "${table}" is not mirrored`);
    }
    // Every mirrored table carries an `orgId`-first `by_org` index, but the
    // index builder cannot be typed against a union of eleven table names. The
    // query is built against one concrete table and the rows go back as opaque
    // documents - the client decodes them per table anyway, and `sync.test.ts`
    // asserts the real behaviour rather than the cast.
    const result = await ctx.db
      .query(table as "artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .paginate({ cursor: cursor ?? null, numItems: pageSize(limit) });

    return {
      table,
      docs: result.page as unknown as Record<string, unknown>[],
      cursor: result.continueCursor,
      isDone: result.isDone,
      // Every snapshot page is stamped, so a device knows the point in time its
      // hydrate is consistent to and can start pulling changes from there.
      at: Date.now(),
    };
  },
});

/* The cursor is a position in the log, not a Convex pagination cursor.
 *
 * Convex's `continueCursor` is an end-cursor: once a page reaches the end of the
 * table, feeding it back returns an empty page forever, so rows appended later
 * are never seen. (PowerSync hit the same wall polling `document_deltas` and had
 * to bolt on a checkpoint mutation.) A resumable feed needs a position it can
 * always move past, so we encode one.
 *
 * `by_org_ts` orders by (orgId, ts, _creationTime) - Convex appends
 * `_creationTime` to every index - so `ts:_creationTime` is exactly the index's
 * own ordering, and two rows written in the same millisecond still resume in the
 * right place. */
type LogCursor = { ts: number; at: number };

function parseCursor(cursor: string | null | undefined): LogCursor | null {
  if (!cursor) return null;
  const at = cursor.indexOf(":");
  if (at < 1) return null;
  const ts = Number(cursor.slice(0, at));
  const creation = Number(cursor.slice(at + 1));
  if (!Number.isFinite(ts) || !Number.isFinite(creation)) return null;
  return { ts, at: creation };
}

const formatCursor = (row: { ts: number; _creationTime: number }): string =>
  `${row.ts}:${row._creationTime}`;

/**
 * Everything that changed in this studio since `cursor`, oldest first.
 *
 * Each entry carries the current document inline for an insert or an update, and
 * `null` for a delete - the tombstone that tells a local mirror to drop its row.
 * Pass `cursor` back on the next call; a null cursor starts at the beginning of
 * the log. `isDone` false means there is more waiting right now.
 */
export const pullChanges = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    tables: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { cursor, limit, tables }) => {
    const orgId = await currentOrg(ctx);
    const wanted = tables?.length
      ? new Set(tables.filter(isMirroredTable))
      : null;
    const max = pageSize(limit);
    const since = parseCursor(cursor);

    const rows = ctx.db
      .query("changeLog")
      .withIndex("by_org_ts", (q) =>
        since
          ? q.eq("orgId", orgId).gte("ts", since.ts)
          : q.eq("orgId", orgId),
      )
      .order("asc");

    const changes = [];
    let next = cursor ?? null;
    let examined = 0;
    let isDone = true;

    for await (const row of rows) {
      // `gte` re-reads the boundary millisecond, so drop what was already sent.
      if (since && row.ts === since.ts && row._creationTime <= since.at) {
        continue;
      }
      if (examined >= max) {
        isDone = false;
        break;
      }
      examined++;
      // The cursor advances past every row we look at, including ones filtered
      // out below. Otherwise a client asking for one table would re-walk every
      // other table's changes on every call.
      next = formatCursor(row);

      if (!isMirroredTable(row.tableName)) continue;
      if (wanted && !wanted.has(row.tableName)) continue;

      let doc = null;
      if (row.op !== "delete") {
        doc = await ctx.db.get(row.docId as Id<TableNames>);
        // Belt and braces on the tenant boundary. The log row was written with
        // this org, but a document is only handed over if it still agrees.
        if (doc && (doc as { orgId?: string }).orgId !== orgId) doc = null;
        // Deleted after the log entry was written; a later entry carries the
        // delete, so skipping here just avoids sending a null-doc update.
        if (!doc) continue;
      }

      changes.push({
        table: row.tableName,
        docId: row.docId,
        op: row.op,
        ts: row.ts,
        doc,
      });
    }

    return { changes, cursor: next, isDone };
  },
});

/* ── Retention ──
   The log is append-only, so without this it grows for as long as the studio
   uses Pulse. Two weeks is comfortably longer than any device is realistically
   away - a Mac shut in a drawer over a holiday still resumes from its cursor -
   and a device that has been gone longer than the horizon re-snapshots rather
   than silently missing rows.

   RETENTION_MS is deliberately generous: the cost of keeping a fortnight of
   change rows is small, and the cost of a device quietly missing a delete is a
   row that never disappears from someone's screen. */
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Drop change rows past the horizon. Batched so one run cannot time out. */
export const pruneChangeLog = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cutoff = Date.now() - RETENTION_MS;
    const batch = Math.min(limit ?? 2000, 4000);

    const stale = await ctx.db
      .query("changeLog")
      .withIndex("by_ts", (q) => q.lt("ts", cutoff))
      .order("asc")
      .take(batch);

    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length, cutoff };
  },
});

/**
 * Whether a device's cursor is still inside the retention window.
 *
 * A client calls this before trusting its cursor. False means the log no longer
 * reaches back that far and the device must re-snapshot instead of pulling a
 * feed with a hole in it.
 */
export const cursorIsUsable = query({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    await currentOrg(ctx);
    const since = parseCursor(cursor);
    if (!since) return { usable: true, reason: "no cursor, will snapshot" };
    const oldest = Date.now() - RETENTION_MS;
    return since.ts >= oldest
      ? { usable: true, reason: "inside the retention window" }
      : { usable: false, reason: "cursor older than retention; re-snapshot" };
  },
});
