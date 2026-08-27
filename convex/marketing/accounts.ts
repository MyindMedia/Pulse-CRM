import { action, mutation, query, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "../lib/tenant";
import { assertWithinLimit, recordUsage } from "../usage";
import { tierForOrg } from "../lib/tier";
import { PLAN_LIMITS } from "../lib/plans";
import { ghlFromEnv, startOAuth, attachOAuthAccount, listAccounts, PLATFORMS, type Platform } from "../lib/ghl";

const platformArg = v.union(...PLATFORMS.map((p) => v.literal(p)));

/** Count-metric sentinel for "effectively unlimited" - mirrors usage.ts's
 *  UNLIMITED, which is not exported (a leaf-module boundary this file has no
 *  reason to cross for one comparison). */
const UNLIMITED_CAP = 999_999;

/** Org doc + GHL override for actions (they have no ctx.db). */
export const orgContext = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return org ? { orgId: org.orgId, slug: org.slug, name: org.name, ghl: org.ghl ?? undefined } : null;
  },
});

export const startConnect = action({
  args: { platform: platformArg, reconnect: v.optional(v.boolean()) },
  handler: async (ctx, { platform, reconnect }): Promise<{ url: string } | { simulated: true }> => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    // A fresh connect needs a new slot; a reconnect of an account the org
    // already owns does not, so only gate the fresh-connect path here.
    if (!reconnect) {
      await ctx.runQuery(internal.usage.checkLimit, { orgId, metric: "social_accounts", add: 1 });
    }
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (!g) return { simulated: true };
    const r = await startOAuth(g, platform as Platform, reconnect ?? false);
    if (!r) throw new ConvexError({ code: "GHL_UNAVAILABLE", message: "Could not start the connection. Try again in a minute." });
    return r;
  },
});

/** Capability check for the connect flow, callable from an action. Cap
 *  enforcement is NOT here: a reconnect of an already-owned account needs no
 *  new slot, so the cap check lives in startConnect (fresh connects only)
 *  and insertInternal (fresh inserts only). */
export const myOrgForConnect = query({
  args: {},
  handler: async (ctx) => {
    return await currentOrgWithCapability(ctx, "marketing.approve");
  },
});

/** Picker candidates for the connect flow. The PIT this app runs under is not
 *  authorised for the oauth accounts-by-id endpoint (`The token is not
 *  authorized for this scope.`, proven live against production) - only the
 *  account owner can grant that scope, by logging into the GHL UI, and that
 *  is not this app's to do. `listAccounts` hits the plain accounts roster
 *  instead, which the token IS authorised for and which already carries
 *  everything the picker needs (id, name, avatar, platform, type, deleted).
 *
 *  `ghlAccountId` here is the oauthId the connect popup hands back - one
 *  oauth login can cover several pages/profiles on the roster, so it is used
 *  to narrow to that login's accounts first. When nothing on the roster
 *  matches it (a stale id, or GHL not reporting one), every non-deleted
 *  account on the requested platform is offered instead of an empty list -
 *  an empty picker reads to the owner as "nothing to connect," which is
 *  wrong when the roster has accounts.
 *
 *  `listAccounts` returns null, never [], when GHL is unreachable or the
 *  response cannot be trusted (see its doc comment). That must not collapse
 *  into an empty picker either - it surfaces as GHL_UNAVAILABLE so the owner
 *  is told to reconnect and try again instead of seeing "nothing here." */
export const choices = action({
  args: { platform: platformArg, ghlAccountId: v.string() },
  handler: async (ctx, { platform, ghlAccountId }) => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (!g) return [{ id: ghlAccountId, name: "Simulated account" }];
    const roster = await listAccounts(g);
    if (roster === null) {
      throw new ConvexError({ code: "GHL_UNAVAILABLE", message: "Could not read the connected account. Reconnect and try again." });
    }
    const live = roster.filter((a) => a.platform === platform && !a.deleted);
    const narrowed = live.filter((a) => a.oauthId === ghlAccountId);
    const pool = narrowed.length > 0 ? narrowed : live;
    return pool.map((a) => ({ id: a.id, name: a.name ?? a.id, type: a.type, avatar: a.avatar }));
  },
});

export const attach = action({
  args: {
    platform: platformArg, ghlAccountId: v.string(),
    choice: v.object({ id: v.string(), name: v.string(), type: v.optional(v.string()), avatar: v.optional(v.string()) }),
  },
  handler: async (ctx, { platform, ghlAccountId, choice }): Promise<Id<"socialAccounts">> => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    let attached: { id: string; name: string; avatar?: string } = { id: ghlAccountId, name: choice.name };
    if (g) {
      // Every account on the roster is already attached at the GHL end -
      // Pulse's only job here is binding it to this studio's org, so a
      // roster hit skips the oauth attach call the token cannot make.
      // Re-checked live rather than trusted from the client, so a chosen
      // account that GHL has since dropped falls through to the old path
      // below instead of being bound on stale data.
      const roster = await listAccounts(g);
      const rosterMatch = roster?.find((a) => a.id === choice.id && !a.deleted);
      if (rosterMatch) {
        attached = { id: rosterMatch.id, name: rosterMatch.name ?? choice.name, avatar: rosterMatch.avatar ?? choice.avatar };
      } else {
        const r = await attachOAuthAccount(g, platform as Platform, ghlAccountId, choice);
        if (!r) throw new ConvexError({ code: "GHL_ATTACH_FAILED", message: "The account could not be attached. Reconnect and try again." });
        attached = r;
      }
    }
    const actor = await ctx.runQuery(api.marketing.accounts.whoAmI, {});
    // insertInternal is the single place that enforces the one-account-one-org
    // invariant (ACCOUNT_TAKEN) - that check must run on every path here, roster
    // bind included, so it is never bypassed by skipping the GHL attach call.
    return await ctx.runMutation(internal.marketing.accounts.insertInternal, {
      orgId, platform, ghlAccountId: attached.id, ghlLocationId: g?.locationId ?? "simulated",
      name: attached.name, avatarUrl: attached.avatar, connectedBy: actor,
    });
  },
});

export const whoAmI = query({ args: {}, handler: async (ctx) => currentActor(ctx) });

export const insertInternal = internalMutation({
  args: {
    orgId: v.string(), platform: platformArg, ghlAccountId: v.string(), ghlLocationId: v.string(),
    name: v.string(), avatarUrl: v.optional(v.string()), connectedBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Invariant: one GHL account belongs to exactly one org, forever.
    const owned = await ctx.db.query("socialAccounts").withIndex("by_ghl_account", (q) => q.eq("ghlAccountId", args.ghlAccountId)).first();
    if (owned && owned.orgId !== args.orgId) {
      throw new ConvexError({ code: "ACCOUNT_TAKEN", message: "That profile is already connected to another studio." });
    }
    if (owned) {
      // Only a row that was actually removed freed its slot; reviving a
      // needs_reconnect or already-connected row must not touch usage, and
      // reviving a removed row must re-claim a slot under the cap (a
      // remove-then-reattach loop must never bypass the cap).
      const wasRemoved = owned.status === "removed";
      if (wasRemoved) {
        await assertWithinLimit(ctx, args.orgId, "social_accounts", 1);
      }
      await ctx.db.patch(owned._id, { status: "connected", name: args.name, avatarUrl: args.avatarUrl, lastCheckedAt: Date.now() });
      if (wasRemoved) {
        await recordUsage(ctx, args.orgId, "social_accounts", 1);
      }
      return owned._id;
    }
    await assertWithinLimit(ctx, args.orgId, "social_accounts", 1);
    const id = await ctx.db.insert("socialAccounts", { ...args, status: "connected", connectedAt: Date.now() });
    await recordUsage(ctx, args.orgId, "social_accounts", 1);
    return id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.filter((r) => r.status !== "removed").map((r) => ({
      _id: r._id, platform: r.platform, name: r.name, avatarUrl: r.avatarUrl, status: r.status, stats: r.stats, connectedAt: r.connectedAt,
    }));
  },
});

export const remove = mutation({
  args: { id: v.id("socialAccounts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status: "removed" });
    await recordUsage(ctx, orgId, "social_accounts", -1);
  },
});

/** Connected-account count against the plan cap, for the accounts page's
 *  limit indicator. `cap: null` means the tier has no ceiling (pro and
 *  above) - the UI shows a plain count instead of a bar. Gated on
 *  marketing.read like `list`: a viewer who cannot connect accounts can
 *  still see how many are connected. */
export const limitStatus = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const limits = PLAN_LIMITS[await tierForOrg(ctx, orgId)];
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const used = rows.filter((r) => r.status !== "removed").length;
    return {
      used,
      cap: limits.socialAccountCap >= UNLIMITED_CAP ? null : limits.socialAccountCap,
      tierLabel: limits.label,
    };
  },
});

/** GHL account ids currently connected for an org, for the status-sync
 *  action (which has no ctx.db and cannot filter by org itself). */
export const ghlAccountIdsForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.filter((r) => r.status !== "removed").map((r) => r.ghlAccountId);
  },
});

/** Rows the account-health sweep needs, grouped by org - every connected or
 *  needs_reconnect row, never a removed one. Both live statuses are
 *  included (not just "connected") so a token that comes back healthy at
 *  GHL can be recovered automatically, not just broken.
 *
 *  Grouped by org first, same shape as results.orgsWithAccounts and
 *  posts.scheduledDue: one GHL location hosts every studio's accounts, so
 *  the sweep resolves each org's own GHL context and only ever matches
 *  that org's own ghlAccountIds against the response - never another
 *  org's. */
export const orgsForHealthCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialAccounts").collect();
    const byOrg = new Map<string, { id: Id<"socialAccounts">; ghlAccountId: string; status: "connected" | "needs_reconnect" }[]>();
    for (const r of rows) {
      if (r.status === "removed") continue;
      byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), { id: r._id, ghlAccountId: r.ghlAccountId, status: r.status }]);
    }
    return [...byOrg.entries()].map(([orgId, accounts]) => ({ orgId, accounts }));
  },
});

/** Applies the sweep's verdicts. Re-reads each row instead of trusting the
 *  snapshot taken at the top of the action: a row can be removed (or
 *  reconnected by the owner) in the gap between the GHL call and this
 *  write, and a removed row must never be resurrected by the sweep. Only
 *  rows whose status actually changes are patched. */
export const applyAccountHealth = internalMutation({
  args: {
    changes: v.array(v.object({
      id: v.id("socialAccounts"),
      status: v.union(v.literal("connected"), v.literal("needs_reconnect")),
    })),
  },
  handler: async (ctx, { changes }) => {
    for (const c of changes) {
      const row = await ctx.db.get(c.id);
      if (!row || row.status === "removed" || row.status === c.status) continue;
      await ctx.db.patch(c.id, { status: c.status });
    }
  },
});

/** Hourly cron: the reactive half of broken-token handling (needs_reconnect
 *  badge, tinted row, Reconnect button on the accounts screen) already
 *  shipped, but nothing wrote needs_reconnect - a studio's token expires
 *  roughly every 60 days and posts would just start silently failing. This
 *  is the write side: ask GHL which accounts still hold a live
 *  authorisation and flip status accordingly.
 *
 *  Detection rule - needs_reconnect when GHL reports the account expired
 *  (isExpired: true), deleted (deleted: true), or simply absent from the
 *  location's account list (the same signal as a studio revoking access
 *  from the platform side, or the account being replaced under a new id).
 *  An account nearing expiry but not yet expired is left connected:
 *  isExpired is GHL's own "broken now" signal, and there is no state
 *  between connected and needs_reconnect in the schema or the accounts UI
 *  to hold a soft pre-expiry warning - adding one is a UI change (a new
 *  badge, a new sort bucket, a new Account.status literal in
 *  account-row.tsx) that is out of scope for this backend sweep. Running
 *  hourly is the mitigation instead: a token that tips into isExpired is
 *  caught and surfaced within the hour, well inside the "invisible until
 *  posts fail" gap this closes.
 *
 *  Recovery - a row already needs_reconnect that GHL now reports healthy is
 *  set back to connected, so a studio that reauthorises outside Pulse (or
 *  whose token GHL silently refreshed) is not stuck showing broken.
 *
 *  Failure handling - grouped by org first and resolved through each org's
 *  own GHL context (ghlFromEnv respects an org's locationId/tokenRef
 *  override), same as refreshStatsAll and syncStatusAll, so a verdict is
 *  only ever applied to the org whose own accounts were just checked.
 *  listAccounts returns null (never []) on any non-2xx, network failure, or
 *  untrusted response shape, and a null result skips that org for this run
 *  with no writes at all: a location-wide outage or a bad Pulse-side
 *  credential must read as "could not check," never as "every studio's
 *  accounts broke." Missing GHL env (no token configured) is simulated
 *  mode - there is nothing to verify against, so it is skipped the same
 *  way, same as the other two GHL crons. */
export const accountHealthSweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.marketing.accounts.orgsForHealthCheck, {});
    for (const g of groups) {
      const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId: g.orgId });
      const ghl = ghlFromEnv(org);
      if (!ghl) continue;
      const remote = await listAccounts(ghl);
      if (remote === null) continue;
      const byId = new Map(remote.map((a) => [a.id, a]));
      const changes: { id: Id<"socialAccounts">; status: "connected" | "needs_reconnect" }[] = [];
      for (const a of g.accounts) {
        const match = byId.get(a.ghlAccountId);
        const broken = !match || match.deleted === true || match.isExpired === true;
        const nextStatus: "connected" | "needs_reconnect" = broken ? "needs_reconnect" : "connected";
        if (nextStatus !== a.status) changes.push({ id: a.id, status: nextStatus });
      }
      if (changes.length > 0) {
        await ctx.runMutation(internal.marketing.accounts.applyAccountHealth, { changes });
      }
    }
  },
});
