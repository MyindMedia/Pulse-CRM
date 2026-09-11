import { query } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { currentOrgWithCapability, currentMoneySight } from "./lib/tenant";
import { MONEY_FIELDS, BOOKS_FIELDS } from "./lib/money";
import { AUDIT_AREAS, MONEY_AREA_TABLES, areaOf } from "./lib/changeAudit";

/** A year of history, then it goes. */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** The change log, newest first, for owners and managers (`audit.read`).
 *
 *  Money is hidden again here, not only at the source: a manager whose owner
 *  has turned money off sees that a rate changed and who changed it, never the
 *  figures, and sees nothing at all from the money tables themselves. */
export const list = query({
  args: {
    area: v.optional(v.string()),
    actorMemberId: v.optional(v.id("members")),
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { area, actorMemberId, days, limit }) => {
    const orgId = await currentOrgWithCapability(ctx, "audit.read");
    const sight = await currentMoneySight(ctx);
    const since = Date.now() - Math.min(Math.max(days ?? 30, 1), 365) * 24 * 60 * 60 * 1000;
    const max = Math.min(Math.max(limit ?? 200, 1), 500);
    const tables = area && AUDIT_AREAS[area] ? new Set(AUDIT_AREAS[area].tables) : null;

    const out = [];
    const rows = ctx.db
      .query("changeAudit")
      .withIndex("by_org_at", (q) => q.eq("orgId", orgId).gte("at", since))
      .order("desc");
    for await (const row of rows) {
      if (out.length >= max) break;
      if (tables && !tables.has(row.tableName)) continue;
      if (area === "other" && areaOf(row.tableName) !== "other") continue;
      if (actorMemberId && row.actorMemberId !== actorMemberId) continue;
      if (!sight.money && MONEY_AREA_TABLES.has(row.tableName)) continue;

      const hidden = new Set<string>([
        ...(sight.money ? [] : (MONEY_FIELDS[row.tableName] ?? [])),
        ...(sight.books ? [] : (BOOKS_FIELDS[row.tableName] ?? [])),
      ]);
      const strip = (values: unknown) => {
        if (!values || typeof values !== "object") return undefined;
        const kept = Object.fromEntries(
          Object.entries(values as Record<string, unknown>).filter(([field]) => !hidden.has(field)),
        );
        return Object.keys(kept).length ? kept : undefined;
      };

      out.push({
        _id: row._id,
        at: row.at,
        area: areaOf(row.tableName),
        tableName: row.tableName,
        docId: row.docId,
        op: row.op,
        actorName: row.actorName,
        actorMemberId: row.actorMemberId ?? null,
        label: row.label ?? null,
        fields: row.fields,
        before: strip(row.before) ?? null,
        after: strip(row.after) ?? null,
      });
    }
    return out;
  },
});

/** Drop history older than a year. Scheduled by sync.pruneChangeLog, which
 *  already runs every six hours. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    const batch = 2000;
    const stale = await ctx.db
      .query("changeAudit")
      .withIndex("by_at", (q) => q.lt("at", cutoff))
      .take(batch);
    for (const row of stale) await ctx.db.delete(row._id);
    if (stale.length === batch) await ctx.scheduler.runAfter(0, internal.changeAudit.prune, {});
    return { deleted: stale.length };
  },
});
