import { query } from "../_generated/server";
import { v } from "convex/values";

/** Display-only fields for the studio-branded card image at
 *  /api/brand-card/[postId]. Deliberately excludes anything that isn't
 *  meant to render on the card - no ids, no internal status, no secrets.
 *  The post id is unguessable, so this query is public with no auth check:
 *  GHL's Social Planner fetches the rendered PNG server to server, signed
 *  out, so the underlying data query has to be reachable the same way. */
export const data = query({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", post.orgId)).first();
    if (!org) return null;
    const room = post.roomId ? await ctx.db.get(post.roomId) : null;
    const promo = post.promoId ? await ctx.db.get(post.promoId) : null;
    const logoUrl = org.logoId ? await ctx.storage.getUrl(org.logoId) : null;
    const rate = room?.hourlyRateCents ?? 0;
    return {
      studioName: org.name,
      accent: org.accentColor ?? "#FDB913",
      logoUrl,
      roomName: room?.name ?? null,
      rateLabel: rate ? `$${Math.round(rate / 100)}/hr` : null,
      promoCode: promo?.code ?? null,
      promoPct: promo?.pct ?? null,
      windowLabel: promo?.label ?? null,
    };
  },
});
