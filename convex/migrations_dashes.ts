import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { stripEmDashes } from "./lib/text";

/* ============================================================
   One-shot cleanup: em dashes already written to the database.

   Fixing the code that writes them only helps the next row. Session
   titles like "Mastering — Nova Reign" are stored records, and they
   are what a studio owner is actually looking at.

   Scoped to fields a person READS. It deliberately does not touch
   names, emails, slugs, ids or anything a lookup depends on: a stray
   dash in a display string is a brand problem, but a rewritten
   identifier is a broken join.

   Run with { dryRun: true } first to see the counts.
   ============================================================ */

/** Table -> the text fields on it that a human reads. */
const TARGETS: { table: string; fields: string[] }[] = [
  { table: "sessions", fields: ["title", "notes"] },
  // The pipeline board renders these. Missed on the first pass, which is
  // exactly why the dashes were still visible there.
  { table: "opportunities", fields: ["title"] },
  { table: "syncOpportunities", fields: ["supervisorName", "outlet", "notes"] },
  { table: "songs", fields: ["title", "notes"] },
  { table: "releaseCampaigns", fields: ["title", "notes"] },
  { table: "deliverables", fields: ["label", "notes"] },
  { table: "packageProducts", fields: ["name", "description"] },
  { table: "membershipPlans", fields: ["name", "description"] },
  { table: "equipment", fields: ["name", "notes"] },
  { table: "softwareLicenses", fields: ["name", "notes"] },
  { table: "feeTemplates", fields: ["label"] },
  { table: "reviews", fields: ["comment"] },
  { table: "clientMessages", fields: ["body"] },
  { table: "shifts", fields: ["note"] },
  { table: "visitors", fields: ["note"] },
  { table: "notifications", fields: ["subject", "body"] },
  { table: "activity", fields: ["summary"] },
  { table: "insights", fields: ["title", "body"] },
  { table: "agentInsights", fields: ["title", "explanation"] },
  { table: "agentApprovals", fields: ["title", "explanation"] },
  { table: "orgs", fields: ["tagline", "bookingHeadline", "bookingIntro", "depositPolicyText"] },
  { table: "rooms", fields: ["notes"] },
  { table: "artists", fields: ["notes"] },
  { table: "invoices", fields: ["notes"] },
  { table: "expenses", fields: ["description", "notes"] },
  { table: "engineeringLogs", fields: ["notes"] },
];

const DASHES = /[—–―]/;

export const stripStoredEmDashes = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const report: Record<string, number> = {};
    let rowsTouched = 0;
    let fieldsFixed = 0;

    for (const { table, fields } of TARGETS) {
      // Whole-table reads are fine here: this runs once, by hand, not on a
      // request path.
      const rows = await ctx.db.query(table as "sessions").collect();
      for (const row of rows) {
        const patch: Record<string, string> = {};
        for (const f of fields) {
          const val = (row as unknown as Record<string, unknown>)[f];
          if (typeof val === "string" && DASHES.test(val)) {
            patch[f] = stripEmDashes(val);
            fieldsFixed++;
            report[`${table}.${f}`] = (report[`${table}.${f}`] ?? 0) + 1;
          }
        }
        if (Object.keys(patch).length > 0) {
          rowsTouched++;
          if (!dryRun) await ctx.db.patch(row._id, patch as never);
        }
      }
    }

    return {
      dryRun: dryRun === true,
      rowsTouched,
      fieldsFixed,
      byField: report,
    };
  },
});
