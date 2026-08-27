import { mutation, query, internalMutation, internalAction, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "../lib/tenant";
import { assertWithinLimit, recordUsage, periodFor } from "../usage";
import { stripEmDashes } from "../lib/text";
import { validateForPlatform, type MediaKind } from "./rules";
import { ghlFromEnv, createScheduledPost, deletePost, listPosts, type GhlPostInput } from "../lib/ghl";

export const APP_HOST = process.env.PULSE_PUBLIC_HOST ?? "https://pulse.myindsound.com";

export function buildTrackedLink(a: { host: string; slug: string; roomId?: string; postId: string; code?: string }): string {
  const path = a.roomId ? `/book/${a.slug}/${a.roomId}` : `/book/${a.slug}`;
  const q = new URLSearchParams({ src: a.postId });
  if (a.code) q.set("code", a.code);
  return `${a.host}${path}?${q.toString()}`;
}

const postInput = {
  template: v.union(v.literal("session_bts"), v.literal("before_after"), v.literal("client_win"), v.literal("room_gear"), v.literal("tip"), v.literal("rate_promo"), v.literal("open_slot"), v.literal("engineer_story"), v.literal("custom")),
  caption: v.string(),
  captionOverrides: v.optional(v.record(v.string(), v.string())),
  media: v.array(v.object({ storageId: v.optional(v.id("_storage")), brandCard: v.optional(v.union(v.literal("rate_card"), v.literal("open_slot"), v.literal("promo"))), type: v.union(v.literal("image"), v.literal("video")) })),
  accountIds: v.array(v.id("socialAccounts")),
  scheduledFor: v.number(),
  timezone: v.string(),
  promoId: v.optional(v.id("promos")),
  artistId: v.optional(v.id("artists")),
  roomId: v.optional(v.id("rooms")),
  ghlType: v.union(v.literal("post"), v.literal("story"), v.literal("reel")),
  includeBookingLink: v.boolean(),
};

/** Shared validation for create/update: accounts belong to this org, media
 *  and caption satisfy every chosen platform. Throws the first problem. */
async function validateInput(ctx: MutationCtx, orgId: string, input: { caption: string; media: { type: MediaKind }[]; accountIds: Id<"socialAccounts">[]; includeBookingLink: boolean; scheduledFor: number; promoId?: Id<"promos"> }) {
  if (input.accountIds.length === 0) throw new Error("Pick at least one account.");
  if (input.scheduledFor < Date.now() + 5 * 60_000) throw new Error("Schedule at least five minutes from now.");
  const accounts: Doc<"socialAccounts">[] = [];
  for (const id of input.accountIds) {
    const a = await ctx.db.get(id);
    if (!a || a.orgId !== orgId || a.status === "removed") {
      throw new ConvexError({ code: "FOREIGN_ACCOUNT", message: "One of the selected accounts is not one of this studio's connected accounts." });
    }
    accounts.push(a);
  }
  if (input.promoId) {
    const p = await ctx.db.get(input.promoId);
    if (!p || p.orgId !== orgId) throw new Error("That promo does not belong to this studio.");
  }
  const media = input.media.map((m) => m.type);
  for (const a of accounts) {
    const problems = validateForPlatform(a.platform, { caption: input.caption, media, hasLink: input.includeBookingLink });
    if (problems.length) throw new Error(problems.join(" "));
  }
  return accounts;
}

export const create = mutation({
  args: postInput,
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.edit");
    await validateInput(ctx, orgId, args);
    const actor = await currentActor(ctx);
    const now = Date.now();
    const { includeBookingLink, ...rest } = args;
    const id = await ctx.db.insert("socialPosts", {
      orgId, ...rest, caption: stripEmDashes(args.caption), status: "draft", submittedBy: actor, createdAt: now, updatedAt: now,
    });
    if (includeBookingLink) await ctx.db.patch(id, { link: await linkFor(ctx, orgId, id, args.roomId, args.promoId) });
    return id;
  },
});

async function linkFor(ctx: MutationCtx, orgId: string, postId: Id<"socialPosts">, roomId?: Id<"rooms">, promoId?: Id<"promos">) {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  const promo = promoId ? await ctx.db.get(promoId) : null;
  return buildTrackedLink({ host: APP_HOST, slug: org?.slug ?? orgId, roomId, postId, code: promo?.code });
}

export const update = mutation({
  args: { id: v.id("socialPosts"), ...postInput },
  handler: async (ctx, { id, ...args }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.edit");
    const post = await ctx.db.get(id);
    if (!post || post.orgId !== orgId) throw new Error("Not found");
    if (post.status !== "draft" && post.status !== "approved" && post.status !== "failed") throw new Error(`A ${post.status} post cannot be edited. Cancel it and create a new one.`);
    await validateInput(ctx, orgId, args);
    const { includeBookingLink, ...rest } = args;
    await ctx.db.patch(id, {
      ...rest, caption: stripEmDashes(args.caption), status: "draft", approvedBy: undefined, approvedAt: undefined, failure: undefined, updatedAt: Date.now(),
      link: includeBookingLink ? await linkFor(ctx, orgId, id, args.roomId, args.promoId) : undefined,
    });
  },
});

/** Shared approval body: the post's own guards (draft/failed status, OK to
 *  feature, monthly cap metered once per period) plus the schedule kick.
 *  Called from the UI mutation with the caller's own identity, and from the
 *  approval inbox (an opsActions row) with the actor already resolved. */
export async function approvePost(ctx: MutationCtx, orgId: string, id: Id<"socialPosts">, actor: string) {
  const post = await ctx.db.get(id);
  if (!post || post.orgId !== orgId) throw new Error("Not found");
  if (post.status !== "draft" && post.status !== "failed") throw new Error(`Cannot approve a ${post.status} post.`);
  // AI drafts (the rate-cut sweep) are created with accountIds: [] - the owner
  // picks accounts in the composer before approving. A post must never be
  // approved with none picked: payloadContext/schedule would see accounts
  // length equal to post.accountIds length (0 === 0), the mismatch guard would
  // never fire, and the post would be marked "scheduled" (then "published" by
  // the status-sync cron) having reached no network at all.
  if (post.accountIds.length === 0) throw new Error("Pick at least one connected account before approving this post.");
  if (post.template === "client_win") {
    const artist = post.artistId ? await ctx.db.get(post.artistId) : null;
    if (!artist?.okToFeature) throw new Error("This artist has not given the OK to feature. Ask them, tick it on their profile, then approve.");
  }
  // Meter a post once per period: a retry after a failure or a re-approve
  // after an edit reuses the same scheduling slot it already paid for this
  // period, so it must not burn the cap again. A post approved again in a
  // later period (its status looped back to draft/failed and enough time
  // passed) correctly meters again, since it now occupies a slot that period.
  const period = periodFor("social_posts");
  const alreadyMetered = post.meteredPeriod === period;
  if (!alreadyMetered) await assertWithinLimit(ctx, orgId, "social_posts", 1);
  await ctx.db.patch(id, {
    status: "approved", approvedBy: actor, approvedAt: Date.now(), failure: undefined, updatedAt: Date.now(),
    ...(alreadyMetered ? {} : { meteredPeriod: period }),
  });
  if (!alreadyMetered) await recordUsage(ctx, orgId, "social_posts", 1);
  await ctx.scheduler.runAfter(0, internal.marketing.posts.schedule, { id });
}

export const approve = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    await approvePost(ctx, orgId, id, await currentActor(ctx));
  },
});

/** Everything an action needs to build the GHL payload, in one read. */
export const payloadContext = internalQuery({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const post = await ctx.db.get(id);
    if (!post) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", post.orgId)).first();
    const accounts = [];
    for (const aid of post.accountIds) {
      const a = await ctx.db.get(aid);
      if (a && a.orgId === post.orgId && a.status !== "removed") accounts.push({ ghlAccountId: a.ghlAccountId, platform: a.platform });
    }
    const media: { url: string; type: string }[] = [];
    for (const m of post.media) {
      if (m.storageId) {
        const url = await ctx.storage.getUrl(m.storageId);
        if (url) media.push({ url, type: m.type === "video" ? "video/mp4" : "image/jpeg" });
      } else if (m.brandCard) {
        media.push({ url: `${APP_HOST}/api/brand-card/${post._id}?kind=${m.brandCard}&v=${post.updatedAt}`, type: "image/png" });
      }
    }
    const promo = post.promoId ? await ctx.db.get(post.promoId) : null;
    return { post, org: org ? { ghl: org.ghl ?? undefined, slug: org.slug } : null, accounts, media, promo };
  },
});

export const schedule = internalAction({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const c = await ctx.runQuery(internal.marketing.posts.payloadContext, { id });
    if (!c || c.post.status !== "approved") return;
    // Invariant re-checked at the boundary: every id is this org's own.
    if (c.accounts.length !== c.post.accountIds.length) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "failed", failure: "An account on this post is no longer connected." });
      return;
    }
    const g = ghlFromEnv(c.org);
    if (!g) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "scheduled", ghlPostId: `simulated:${id}` });
      return;
    }
    const summary = c.post.link ? `${c.post.caption}\n\n${c.post.link}` : c.post.caption;
    const input: GhlPostInput = {
      accountIds: c.accounts.map((a) => a.ghlAccountId),
      summary,
      media: c.media,
      scheduleDate: new Date(c.post.scheduledFor).toISOString(),
      type: c.post.ghlType,
    };
    if (c.accounts.some((a) => a.platform === "google") && c.promo) {
      input.gmbPostDetails = {
        title: c.promo.label ?? `${c.promo.pct}% off`,
        offerDetails: { couponCode: c.promo.code, redeemOnlineUrl: c.post.link, termsConditions: "Valid on new bookings only." },
        startDate: new Date(c.promo.startsAt).toISOString(), endDate: new Date(c.promo.endsAt).toISOString(),
      };
    }
    if (c.accounts.some((a) => a.platform.startsWith("tiktok"))) {
      input.tiktokPostDetails = { privacyLevel: "PUBLIC_TO_EVERYONE", enableComment: true };
    }
    const r = await createScheduledPost(g, input);
    if ("error" in r) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "failed", failure: r.error });
      return;
    }
    await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "scheduled", ghlPostId: r.id });
  },
});

export const markStatus = internalMutation({
  args: {
    id: v.id("socialPosts"),
    status: v.union(v.literal("scheduled"), v.literal("published"), v.literal("failed"), v.literal("approved")),
    ghlPostId: v.optional(v.string()),
    failure: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const post = await ctx.db.get(id);
    if (!post) return;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    if (patch.status === "failed") {
      await ctx.db.insert("activity", { orgId: post.orgId, kind: "social.post.failed", summary: `A scheduled post did not publish: ${patch.failure ?? "unknown error"}`, entityType: "socialPost", entityId: id, accent: "critical" });
    }
    if (patch.status === "published") {
      await ctx.db.insert("activity", { orgId: post.orgId, kind: "social.post.published", summary: `Published: ${post.caption.slice(0, 60)}`, entityType: "socialPost", entityId: id, accent: "positive" });
    }
  },
});

export const cancel = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const post = await ctx.db.get(id);
    if (!post || post.orgId !== orgId) throw new Error("Not found");
    if (post.status === "published") throw new Error("A published post cannot be cancelled from Pulse.");
    await ctx.db.patch(id, { status: "cancelled", updatedAt: Date.now() });
    if (post.status === "scheduled" && post.ghlPostId && !post.ghlPostId.startsWith("simulated:")) {
      await ctx.scheduler.runAfter(0, internal.marketing.posts.deleteInGhl, { orgId, ghlPostId: post.ghlPostId });
    }
  },
});

export const deleteInGhl = internalAction({
  args: { orgId: v.string(), ghlPostId: v.string() },
  handler: async (ctx, { orgId, ghlPostId }) => {
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (g) await deletePost(g, ghlPostId);
  },
});

export const list = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("socialPosts").withIndex("by_org_scheduled", (q) => q.eq("orgId", orgId).gte("scheduledFor", from).lte("scheduledFor", to)).collect();
    return rows.filter((r) => r.status !== "cancelled");
  },
});

export const get = query({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const post = await ctx.db.get(id);
    return post && post.orgId === orgId ? post : null;
  },
});

/** AI path: a Draft created by the rate-cut recommender or the ops brain.
 *  Skips platform validation when no accounts are connected yet (the owner
 *  picks accounts when they approve), so the draft still lands in the inbox. */
export const createInternal = internalMutation({
  args: { orgId: v.string(), ...postInput, sourceActionId: v.optional(v.id("opsActions")) },
  handler: async (ctx, { orgId, includeBookingLink, sourceActionId, ...rest }) => {
    const now = Date.now();
    const id = await ctx.db.insert("socialPosts", { orgId, ...rest, caption: stripEmDashes(rest.caption), status: "draft", submittedBy: "pulse-ai", sourceActionId, createdAt: now, updatedAt: now });
    if (includeBookingLink) await ctx.db.patch(id, { link: await linkFor(ctx, orgId, id, rest.roomId, rest.promoId) });
    return id;
  },
});

/** Cron: pull status for every scheduled post whose time has passed. */
export const scheduledDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialPosts").withIndex("by_org_status").collect();
    const isDue = (r: Doc<"socialPosts">) => r.status === "scheduled" && r.scheduledFor <= Date.now();
    const due = rows.filter((r) => isDue(r) && r.ghlPostId && !r.ghlPostId.startsWith("simulated:"));
    const simulated = rows.filter((r) => isDue(r) && r.ghlPostId && r.ghlPostId.startsWith("simulated:"));
    const byOrg = new Map<string, typeof due>();
    for (const r of due) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
    return {
      groups: [...byOrg.entries()].map(([orgId, posts]) => ({ orgId, posts: posts.map((p) => ({ id: p._id, ghlPostId: p.ghlPostId!, scheduledFor: p.scheduledFor })) })),
      simulated: simulated.map((p) => ({ id: p._id, scheduledFor: p.scheduledFor })),
    };
  },
});

export const syncStatusAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const { groups, simulated } = await ctx.runQuery(internal.marketing.posts.scheduledDue, {});
    for (const p of simulated) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id: p.id, status: "published", publishedAt: p.scheduledFor });
    }
    for (const group of groups) {
      const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId: group.orgId });
      const g = ghlFromEnv(org);
      if (!g) continue;
      const accounts = await ctx.runQuery(internal.marketing.accounts.ghlAccountIdsForOrg, { orgId: group.orgId });
      const from = new Date(Math.min(...group.posts.map((p) => p.scheduledFor)) - 86_400_000).toISOString();
      const to = new Date().toISOString();
      const ghlPosts = await listPosts(g, { accountIds: accounts, fromDate: from, toDate: to });
      for (const p of group.posts) {
        const remote = ghlPosts.find((r) => r._id === p.ghlPostId);
        if (!remote) continue;
        const s = remote.status.toLowerCase();
        if (s === "published" || s === "success") {
          await ctx.runMutation(internal.marketing.posts.markStatus, { id: p.id, status: "published", publishedAt: remote.publishedAt ? Date.parse(remote.publishedAt) : Date.now() });
        } else if (s === "failed" || s === "error") {
          await ctx.runMutation(internal.marketing.posts.markStatus, { id: p.id, status: "failed", failure: remote.error ?? "GHL reported a failure." });
        }
      }
    }
  },
});
