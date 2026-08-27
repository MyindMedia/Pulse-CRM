import { query, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { currentOrgWithCapability } from "../lib/tenant";
import { ghlFromEnv, accountStats } from "../lib/ghl";

const WINDOW = 7 * 86_400_000;

/** Attribution readback: joins socialPosts to bookingVisits. A visit
 *  attaches to a post either directly (?src=<postId>, the tracked-link
 *  click) or through the post's own promo code (?code=); postId wins when a
 *  visit carries both. A "page" visit is a click regardless of window; only
 *  a "booked" visit inside the 7-day window from publish counts as a
 *  booking. Clicks, bookings, revenue and redemptions are four distinct
 *  measures - a booking attributed by tracked link that redeemed no code is
 *  not a code redemption. */
export const perPost = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const posts = (await ctx.db.query("socialPosts").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "published")).collect())
      .filter((p) => (p.publishedAt ?? p.scheduledFor) >= from && (p.publishedAt ?? p.scheduledFor) <= to);
    if (posts.length === 0) return [];
    const promoCode = new Map<string, string>();
    for (const p of posts) {
      if (p.promoId) { const promo = await ctx.db.get(p.promoId); if (promo) promoCode.set(p._id, promo.code); }
    }
    const codeToPost = new Map<string, string>();
    for (const [postId, code] of promoCode) if (!codeToPost.has(code)) codeToPost.set(code, postId);
    const visits = await ctx.db.query("bookingVisits").withIndex("by_org_step", (q) => q.eq("orgId", orgId)).collect();
    const acc = new Map(posts.map((p) => [p._id as string, { clicks: 0, bookings: 0, revenueCents: 0, redemptions: 0 }]));
    const publishedAt = new Map(posts.map((p) => [p._id as string, p.publishedAt ?? p.scheduledFor]));
    for (const vRow of visits) {
      const byId = vRow.postId ? (vRow.postId as string) : undefined;
      const byCode = vRow.code ? codeToPost.get(vRow.code.toUpperCase()) : undefined;
      const target = byId && acc.has(byId) ? byId : byCode;
      if (!target) continue;
      const row = acc.get(target)!;
      const t0 = publishedAt.get(target)!;
      if (vRow.step === "page") { row.clicks += 1; continue; }
      if (vRow.step !== "booked") continue;
      if (vRow.createdAt < t0 || vRow.createdAt > t0 + WINDOW) continue;
      row.bookings += 1;
      row.revenueCents += vRow.amountCents ?? 0;
      if (vRow.code && promoCode.get(target) === vRow.code.toUpperCase()) row.redemptions += 1;
    }
    return posts.map((p) => ({ postId: p._id, caption: p.caption, template: p.template, publishedAt: p.publishedAt ?? p.scheduledFor, stats: p.stats, ...acc.get(p._id as string)! }))
      .sort((a, b) => b.publishedAt - a.publishedAt);
  },
});

export const orgsWithAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialAccounts").collect();
    const byOrg = new Map<string, { id: string; ghlAccountId: string }[]>();
    for (const r of rows) if (r.status === "connected") byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), { id: r._id, ghlAccountId: r.ghlAccountId }]);
    return [...byOrg.entries()].map(([orgId, accounts]) => ({ orgId, accounts }));
  },
});

export const writeStats = internalMutation({
  args: { id: v.id("socialAccounts"), followers: v.optional(v.number()), reach: v.optional(v.number()) },
  handler: async (ctx, { id, followers, reach }) => {
    await ctx.db.patch(id, { stats: { followers, reach, refreshedAt: Date.now() } });
  },
});

/** Daily cron: pull follower/reach stats from GHL for every connected
 *  account, grouped by org first so one org's accountStats call never
 *  carries another org's ghlAccountId - one GHL location hosts every
 *  studio's Connected Accounts. */
export const refreshStatsAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.marketing.results.orgsWithAccounts, {});
    for (const g of groups) {
      const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId: g.orgId });
      const ghl = ghlFromEnv(org);
      if (!ghl) continue;
      const stats = await accountStats(ghl, g.accounts.map((a) => a.ghlAccountId));
      for (const a of g.accounts) {
        const s = stats[a.ghlAccountId];
        if (s) await ctx.runMutation(internal.marketing.results.writeStats, { id: a.id as never, followers: s.followers, reach: s.reach });
      }
    }
  },
});
