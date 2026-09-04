import { internalAction } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { ORG_TABLES, orgRows } from "./subaccountDeletion";

/* ============================================================
   Reset a workspace to its setup.

   Not the same thing as either neighbour:

     demoMode.clearDemo    removes exactly the rows the demo FILLER
                           inserted, tracked in `demoRows`.
     subaccountDeletion    destroys the workspace and everything in it.

   This is the middle case, and the one a studio staged for a pitch
   actually needs: the content was written by seeders and by the agency
   working in the account, not by the registered filler, so `demoRows` is
   empty and clearDemo removes nothing. Playback had 384 sessions, 225
   invoices and 1,975 ops actions of it, none of it real, with a beta
   tester about to open the door.

   So: history out, setup kept. Rooms, gear, the patchbay, team, invites,
   pricing templates, AI policy and branding all survive, because they are
   what the agency built for this studio. Bookings, money, clients, AI runs,
   activity and metrics go, because none of it happened.

   Dry by default. Nothing here can be reached from a browser.
   ============================================================ */

/** The studio's SETUP - what the agency configured for them. Everything in
 *  ORG_TABLES that is not on this list is history and gets cleared. */
const KEEP = new Set<string>([
  "members",            // the team roster
  "invites",            // pending owner/staff invites - deleting one locks them out
  "collaboratorGrants", // shared access already handed out
  "rooms",
  "equipment",
  "assetDocuments",     // manuals and receipts attached to gear
  "softwareLicenses",
  "feeTemplates",
  "packageProducts",
  "membershipPlans",
  "availability",       // opening hours
  "agentPolicies",
  "agentRules",
  "opsAutonomy",
  "externalCalendars",  // calendar connections (their events are cleared)
  "pushSubscriptions",  // devices already registered for alerts
  // The patchbay is a drawing of the room, not a record of what happened in it.
  "patchSpaces", "deviceInstances", "ports", "connections", "patchGroups",
]);

async function orgOrThrow(ctx: MutationCtx, orgId: string) {
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!org) throw new ConvexError(`No studio with orgId ${orgId}`);
  return org;
}

/** What a reset would clear, and what it would keep. Reads only. */
export const _resetContent = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await orgOrThrow(ctx, orgId);
    const cleared: Record<string, number> = {};
    const kept: Record<string, number> = {};
    let total = 0;

    for (const table of ORG_TABLES) {
      const rows = await orgRows(ctx, table, orgId);
      if (rows.length === 0) continue;
      if (KEEP.has(table)) kept[table] = rows.length;
      else {
        cleared[table] = rows.length;
        total += rows.length;
      }
    }
    return { applied: false as const, name: org.name, total, cleared, kept };
  },
});

/* One transaction's worth of deletion.

   Convex caps a single function execution at a few thousand document reads,
   and a staged workspace can hold far more than that - Playback had 6,770
   rows. So the work is done in bites and the caller keeps calling until
   there is nothing left, rather than one heroic mutation that dies at the
   limit having deleted an arbitrary half. */
export const _resetBatch = internalMutation({
  args: { orgId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    await orgOrThrow(ctx, orgId);
    const budget = limit ?? 800;
    const cleared: Record<string, number> = {};
    let used = 0;

    for (const table of ORG_TABLES) {
      if (used >= budget) break;
      if (KEEP.has(table)) continue;
      const rows = await orgRows(ctx, table, orgId, budget - used);
      if (rows.length === 0) continue;
      for (const row of rows) await ctx.db.delete(row._id);
      cleared[table] = rows.length;
      used += rows.length;
    }

    return { cleared, deleted: used, done: used < budget };
  },
});

/** Close the reset: the studio is unonboarded again, on the record. */
export const _finishReset = internalMutation({
  args: { orgId: v.string(), total: v.number() },
  handler: async (ctx, { orgId, total }) => {
    const org = await orgOrThrow(ctx, orgId);
    /* A studio that has just been emptied has not been onboarded, whatever the
       flag says - the owner's first sign-in should walk the welcome wizard
       against the clean slate rather than a dashboard of nothing. */
    await ctx.db.patch(org._id, { demoMode: false, onboardingCompletedAt: undefined });
    await ctx.db.insert("activity", {
      orgId,
      kind: "account.reset",
      summary: `Workspace reset for go-live: ${total} demo and staging records cleared`,
      accent: "gold",
    });
  },
});

/** The whole reset. Dry by default; `apply` deletes, batch after batch. */
export const _reset = internalAction({
  args: { orgId: v.string(), apply: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, apply }): Promise<Record<string, unknown>> => {
    const plan = await ctx.runMutation(internal.orgReset._resetContent, { orgId });
    if (!apply) return plan;

    const cleared: Record<string, number> = {};
    let total = 0;
    // A bound, not an expectation: 200 x 800 rows is far past any real
    // workspace, and a loop that cannot end is worse than one that stops.
    for (let round = 0; round < 200; round++) {
      const r = await ctx.runMutation(internal.orgReset._resetBatch, { orgId });
      for (const [table, n] of Object.entries(r.cleared)) {
        cleared[table] = (cleared[table] ?? 0) + n;
      }
      total += r.deleted;
      if (r.done) break;
    }
    await ctx.runMutation(internal.orgReset._finishReset, { orgId, total });
    return { applied: true, name: plan.name, total, cleared, kept: plan.kept };
  },
});
