import { internalMutation } from "./functions";
import { v } from "convex/values";
import { normalizeEmail } from "./lib/emailKey";

/* ============================================================
   Bring stored addresses onto the rule.

   Every write path normalizes now (see lib/emailKey.ts), but the rows
   written before that still hold whatever was typed - and an INDEXED lookup
   matches bytes, so a row saved as "Info@studio.com" is unreachable by a
   search for "info@studio.com" however careful the reader is. That is the
   exact shape of the bug that locked a studio owner out of his own
   workspace.

   Dry by default. Idempotent: a second pass finds nothing.
   ============================================================ */

/** Tables whose email column identifies a PERSON, and the column's name. */
const EMAIL_COLUMNS: { table: string; column: string }[] = [
  { table: "orgs", column: "ownerEmail" },
  { table: "agencies", column: "ownerEmail" },
  { table: "agencyMembers", column: "email" },
  { table: "members", column: "email" },
  { table: "invites", column: "email" },
  { table: "betaInvites", column: "email" },
  { table: "collaboratorGrants", column: "email" },
  { table: "artists", column: "email" },
  { table: "visitors", column: "email" },
  { table: "users", column: "email" },
];

export const _normalizeStoredEmails = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }) => {
    const changed: Record<string, number> = {};
    const samples: string[] = [];
    let total = 0;

    for (const { table, column } of EMAIL_COLUMNS) {
      // "orgs" stands in for any table here: the cast is about the union of
      // table names, and every row this touches is read as a bag of fields.
      const rows = await ctx.db.query(table as "orgs").collect();
      for (const row of rows) {
        const raw = (row as unknown as Record<string, unknown>)[column];
        if (typeof raw !== "string" || raw.length === 0) continue;
        const clean = normalizeEmail(raw);
        if (clean === raw) continue;

        changed[table] = (changed[table] ?? 0) + 1;
        total++;
        if (samples.length < 12) samples.push(`${table}.${column}: ${raw} -> ${clean}`);
        if (apply) {
          await ctx.db.patch(row._id, { [column]: clean } as never);
        }
      }
    }

    return { applied: Boolean(apply), total, changed, samples };
  },
});
