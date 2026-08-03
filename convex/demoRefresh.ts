import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

/* ============================================================
   Demo freshness. The pitch accounts drift stale on their own:

   - seedDemoFinance leaves an engineer ON the clock so the mobile clock-in
     widget is live. That entry keeps accruing, so a week later payroll reads
     1,613h / $43k instead of 1,278h / $32k and net profit collapses.
   - seedDemoYear builds a rolling window relative to "now". Left alone, the
     upcoming-sessions list empties out and today's calendar goes blank.

   Both seeds are idempotent and tagged, so re-running is safe and cheap.
   This job re-runs them nightly for every demo org so a demo is never
   opened on stale numbers again.
   ============================================================ */

/* Pitch accounts that are NOT flagged demoMode. Matched by slug, never by
   org id: the Myind Sound id changed during the Clerk production cutover and
   a hardcoded id would have silently stopped refreshing. The slug survived.
   Deliberately not flipping demoMode on these - that flag is the agency
   go-live switch, and turning it back off DELETES every row in the demoRows
   registry. Refreshing must never risk a real studio's data. */
const PITCH_SLUGS = ["myind-sound"];

/** Every org that should be kept demo-fresh. */
export const listDemoOrgs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    const flagged = orgs.filter((o) => o.demoMode === true).map((o) => o.orgId);
    const bySlug = orgs
      .filter((o) => o.slug && PITCH_SLUGS.includes(o.slug))
      .map((o) => o.orgId);
    // "pulse-demo" is the workspace unauthenticated/demo-mode callers land on
    // (see lib/tenant.ts) and may not carry the flag itself.
    return Array.from(new Set(["pulse-demo", ...flagged, ...bySlug]));
  },
});

export const refreshAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.demoRefresh.listDemoOrgs, {});
    const refreshed: string[] = [];
    for (const orgId of orgIds) {
      // Year fill first (bookings/invoices/pipeline), then finance (payroll,
      // expenses, and the live clock-in) so the shift is stamped against the
      // freshly generated schedule.
      const year = await ctx.runMutation(internal.seedDemoYear.fillYear, { orgId });
      if ((year as { error?: string }).error) continue; // org not seeded with a studio yet
      await ctx.runMutation(internal.seedDemoFinance.fill, { orgId });
      refreshed.push(orgId);
    }
    return { refreshed, count: refreshed.length };
  },
});
