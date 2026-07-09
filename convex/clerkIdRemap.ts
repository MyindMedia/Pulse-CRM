import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import schema from "./schema";

/* ============================================================
   One-time Clerk dev -> production instance migration.
   Clerk assigns new org/user IDs on the production instance, but
   Convex documents reference the old dev-instance IDs everywhere
   (orgs.orgId, members.clerkUserId, activity actors, audit rows,
   nested payloads...). This walks EVERY document in EVERY table
   and swaps any string that exactly matches an old Clerk ID for
   its production counterpart. Safe by construction: Clerk IDs are
   globally-unique random strings, so exact-match replacement can
   never collide with real data.
   Run: npx convex run clerkIdRemap:run '{"map": {...}}' (internal).
   ============================================================ */

function deepSwap(
  value: unknown,
  map: Record<string, string>,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const next = map[value];
    return next ? { value: next, changed: true } : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const r = deepSwap(item, map);
      changed = changed || r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(value)) {
      const r = deepSwap(item, map);
      changed = changed || r.changed;
      out[k] = r.value;
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}

export const remapBatch = internalMutation({
  args: {
    table: v.string(),
    cursor: v.union(v.string(), v.null()),
    map: v.record(v.string(), v.string()),
  },
  handler: async (ctx, { table, cursor, map }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (ctx.db.query(table as any) as any).paginate({
      cursor,
      numItems: 200,
    });
    let patched = 0;
    for (const doc of page.page) {
      const { _id, _creationTime, ...fields } = doc;
      const swapped = deepSwap(fields, map);
      if (swapped.changed) {
        await ctx.db.replace(_id, swapped.value as never);
        patched++;
      }
    }
    return { cursor: page.continueCursor as string, isDone: page.isDone as boolean, patched };
  },
});

export const run = internalAction({
  args: { map: v.record(v.string(), v.string()) },
  handler: async (ctx, { map }) => {
    const tables = Object.keys(schema.tables);
    const summary: Record<string, number> = {};
    for (const table of tables) {
      let cursor: string | null = null;
      let total = 0;
      for (;;) {
        const r: { cursor: string; isDone: boolean; patched: number } =
          await ctx.runMutation(internal.clerkIdRemap.remapBatch, { table, cursor, map });
        total += r.patched;
        if (r.isDone) break;
        cursor = r.cursor;
      }
      if (total > 0) summary[table] = total;
    }
    return summary;
  },
});
