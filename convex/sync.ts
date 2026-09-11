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
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id, TableNames } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import {
  isMirroredTable,
  mirrorSightTag,
  projectDoc,
  rowAllowed,
  tablesFor,
  type MirrorViewer,
} from "./lib/mirroredTables";

/** The caller's org plus what they may actually read.
 *
 *  currentOrg answers "who" and stops there, which is the right shape for a
 *  table whose own list query is org-gated and nothing more. It is the wrong
 *  shape for a feed that hands over twenty-eight tables at once, because the
 *  strictest of them sets the bar. Resolving the viewer once gives both
 *  answers. */
async function syncViewer(
  ctx: Parameters<typeof currentOrg>[0],
): Promise<{ orgId: string; viewer: MirrorViewer }> {
  const orgId = await currentOrg(ctx);
  const resolved = await resolveViewer(ctx);
  // A studio member's own row id, so a table they hold only for themselves
  // (their own clock punches) can be filtered to their rows. The demo owner
  // and an agency member acting as a studio have no row and get none.
  const memberId =
    resolved.kind === "studio_member" &&
    resolved.memberId !== ("demo" as unknown as typeof resolved.memberId)
      ? (resolved.memberId as unknown as string)
      : undefined;
  return { orgId, viewer: { capabilities: resolved.capabilities as Set<string>, memberId } };
}

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
    // Only the tables this caller may hold. An intern asking what to mirror is
    // told about the seventeen that need nothing beyond membership, not all
    // twenty-eight, so the client never even tries for the ones it would be
    // refused.
    const { viewer } = await syncViewer(ctx);
    return tablesFor(viewer);
  },
});

/* The tip of this studio's change log.
 *
 * A device subscribes to this rather than polling `pullChanges`: it is one
 * indexed read of one row, it changes exactly when there is something to pull,
 * and Convex pushes the new value over the socket the moment it does. The
 * device then pulls from its own cursor. Subscribing to `pullChanges` itself
 * would work too, but a subscription's arguments are fixed when it is opened,
 * so every re-run would replay everything since the cursor it was opened with. */
export const tip = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await syncViewer(ctx);
    const latest = await ctx.db
      .query("changeLog")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .first();
    return latest ? `${latest.ts}:${latest._creationTime}` : null;
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
    const { orgId, viewer } = await syncViewer(ctx);
    if (!isMirroredTable(table)) {
      throw new Error(`Table "${table}" is not mirrored`);
    }
    if (!tablesFor(viewer).includes(table)) {
      throw new Error(`Table "${table}" is not mirrored for this caller`);
    }
    // Every mirrored table carries an `orgId`-first `by_org` index, but the
    // index builder cannot be typed against a union of twenty-eight table
    // names. The
    // query is built against one concrete table and the rows go back as opaque
    // documents - the client decodes them per table anyway, and `sync.test.ts`
    // asserts the real behaviour rather than the cast.
    const result = await ctx.db
      .query(table as "artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .paginate({ cursor: cursor ?? null, numItems: pageSize(limit) });

    return {
      table,
      // A table held only for oneself is filtered here, row by row. The page
      // may come back short of `limit`; the cursor still advances, so a device
      // paginating an engineer's timeEntries walks the studio's rows and keeps
      // its own.
      docs: (result.page as unknown as Record<string, unknown>[])
        .filter((doc) => rowAllowed(table, doc, viewer))
        .map((doc) => projectDoc(table, doc, viewer)),
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
/** `tag` is who the rows were projected for (lib/mirroredTables.ts); null on a
 *  cursor issued before tags existed. */
type LogCursor = { ts: number; at: number; tag: string | null };

function parseCursor(cursor: string | null | undefined): LogCursor | null {
  if (!cursor) return null;
  const [tsPart, atPart, tag] = cursor.split(":");
  if (!tsPart || atPart === undefined) return null;
  const ts = Number(tsPart);
  const creation = Number(atPart);
  if (!Number.isFinite(ts) || !Number.isFinite(creation)) return null;
  return { ts, at: creation, tag: tag ?? null };
}

const formatCursor = (row: { ts: number; _creationTime: number }, tag: string): string =>
  `${row.ts}:${row._creationTime}:${tag}`;

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
    const { orgId, viewer } = await syncViewer(ctx);
    const permitted = new Set<string>(tablesFor(viewer));
    const wanted = tables?.length
      ? new Set(tables.filter((t) => isMirroredTable(t) && permitted.has(t)))
      : null;
    const max = pageSize(limit);
    const since = parseCursor(cursor);
    const tag = mirrorSightTag(viewer);

    /* Ordered by `_creationTime`, not by `ts`.
       `ts` is stamped when the mutation RUNS, and a mutation commits some time
       after it runs, so two mutations in flight together can commit in the
       opposite order to their stamps. A client that pulled between the two
       commits would have saved a cursor past the slower one's stamp and never
       been handed that row until a fortnightly re-snapshot. `_creationTime` is
       the commit's own clock and advances with every commit, so a cursor on
       it cannot skip a row. The cursor still carries `ts` for the retention
       check; the position is the second half. */
    const rows = ctx.db
      .query("changeLog")
      .withIndex("by_org", (q) =>
        since
          ? q.eq("orgId", orgId).gt("_creationTime", since.at)
          : q.eq("orgId", orgId),
      )
      .order("asc");

    const changes = [];
    let next = cursor ?? null;
    let examined = 0;
    let isDone = true;

    for await (const row of rows) {
      if (examined >= max) {
        isDone = false;
        break;
      }
      examined++;
      // The cursor advances past every row we look at, including ones filtered
      // out below. Otherwise a client asking for one table would re-walk every
      // other table's changes on every call.
      next = formatCursor(row, tag);

      if (!isMirroredTable(row.tableName)) continue;
      if (!permitted.has(row.tableName)) continue;
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
        // Somebody else's row in a table this caller holds only for themselves.
        if (!rowAllowed(row.tableName, doc as Record<string, unknown>, viewer)) continue;
      }

      changes.push({
        table: row.tableName,
        docId: row.docId,
        op: row.op,
        ts: row.ts,
        doc: doc ? projectDoc(row.tableName, doc as Record<string, unknown>, viewer) : null,
      });
    }

    return { changes, cursor: next, isDone };
  },
});

/* A no-op write on a studio's own row, for timing the feed.
 *
 * Patching a document with its own value still goes through the trigger, so
 * one changeLog row appears and every device holding that studio pulls. Used
 * from the CLI with the deploy key to measure how long a web-side change
 * takes to reach a phone; it changes nothing anyone can see. */
export const touch = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("No such org");
    await ctx.db.patch(org._id, { name: org.name });
    return { at: Date.now() };
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

/** Drop change rows past the horizon. Batched so one run cannot time out.
 *
 * A batch that comes back full means there is more behind it, so the run
 * reschedules itself rather than waiting six hours for the next tick. The cron
 * interval decides how often pruning STARTS; it must not also decide the most a
 * deployment may write in a day. Twenty-eight mirrored tables across every
 * studio on the deployment is a rate a single fixed batch can lose to, and the
 * failure mode is silent: the log simply never comes down.
 *
 * The drain terminates because `cutoff` is fixed for the chain and only rows
 * older than it are ever taken. */
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

    const more = stale.length === batch;
    if (more) {
      await ctx.scheduler.runAfter(0, internal.sync.pruneChangeLog, { limit });
    }
    return { deleted: stale.length, cutoff, more };
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
    const { viewer } = await syncViewer(ctx);
    const since = parseCursor(cursor);
    if (!since) return { usable: true, reason: "no cursor, will snapshot" };
    // Rows fetched under different permissions are not this person's to keep:
    // a manager whose owner has just hidden money, a promotion, a demotion. A
    // cursor from before tags existed is treated the same way, exactly once.
    if (since.tag !== mirrorSightTag(viewer)) {
      return { usable: false, reason: "what this person may see has changed; re-snapshot" };
    }
    const oldest = Date.now() - RETENTION_MS;
    return since.ts >= oldest
      ? { usable: true, reason: "inside the retention window" }
      : { usable: false, reason: "cursor older than retention; re-snapshot" };
  },
});
