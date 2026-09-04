import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";
import { stripEmDashes } from "./lib/text";

/* ============================================================
   Post-session reviews / testimonials.

   The growth loop: ~24h after a session completes, the client is
   emailed a link to /review/<sessionId> (see automation.ts). This
   file owns the public submit surface, the studio-side management
   list, and the published feed the booking page renders for social
   proof.

   Trust model: the review link carries the sessionId. Convex ids are
   unguessable, so the id itself is the capability. `submit` is public
   (no Clerk login) and derives the org + artist FROM THE SESSION, never
   from caller arguments, so a public caller can never write a review
   into another studio's org. One review per session (idempotent).
   ============================================================ */

const REVIEW_CAP = 12; // latest N published reviews shown as social proof

/** Resolve an orgId from either an explicit orgId or a booking slug. */
async function resolveOrgId(
  ctx: QueryCtx,
  args: { orgId?: string; slug?: string },
): Promise<string | null> {
  if (args.orgId) return args.orgId;
  if (args.slug) {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug!))
      .first();
    return org?.orgId ?? null;
  }
  return null;
}

/** Normalize a rating to an integer in 1-5, or throw. */
function cleanRating(rating: number): number {
  const r = Math.round(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    throw new ConvexError("Please choose a rating from 1 to 5 stars.");
  }
  return r;
}

// ── Public submit ───────────────────────────────────────────────────────

/** Public: submit a review for a completed session. The org + artist are
 *  derived from the session (never trusted from args), so a public caller can
 *  only ever write into the studio that ran the session. Idempotent - a second
 *  submit for the same session is rejected. */
export const submit = mutation({
  args: {
    sessionId: v.id("sessions"),
    rating: v.number(),
    text: v.optional(v.string()),
    authorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new ConvexError("This review link is no longer valid.");
    if (session.status !== "completed") {
      throw new ConvexError("Reviews open once your session is complete.");
    }

    // One review per session. Blocks a double-submit (refresh / re-open link).
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    if (existing) {
      throw new ConvexError("Thanks - a review for this session was already submitted.");
    }

    const rating = cleanRating(args.rating);
    const text = args.text?.trim() ? stripEmDashes(args.text.trim()).slice(0, 2000) : undefined;

    // Author name: prefer what they typed, else fall back to the artist on the
    // session. Never accept an orgId/artistId from the caller.
    let authorName = args.authorName?.trim() ? args.authorName.trim().slice(0, 120) : undefined;
    if (!authorName) {
      const artist = await ctx.db.get(session.artistId);
      authorName = artist?.name;
    }

    const id = await ctx.db.insert("reviews", {
      orgId: session.orgId, // derived from the session, NOT from args
      artistId: session.artistId,
      sessionId: args.sessionId,
      rating,
      text,
      authorName,
      status: "published",
      source: "post_session",
      at: Date.now(),
    });
    return { ok: true, reviewId: id };
  },
});

/** Public: has this session already been reviewed? Lets the review page show a
 *  "thank you" state on a second visit instead of a broken submit. */
export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return { valid: false as const };
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", session.orgId))
      .first();
    return {
      valid: true as const,
      studioName: org?.name ?? "the studio",
      completed: session.status === "completed",
      alreadyReviewed: Boolean(existing),
      sessionTitle: session.title,
    };
  },
});

// ── Studio-side management ──────────────────────────────────────────────

/** Studio members: every review (published + hidden) for management. */
export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    return await ctx.db
      .query("reviews")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(200);
  },
});

/** Studio members: publish or hide a review (moderation for the public feed). */
export const setStatus = mutation({
  args: {
    reviewId: v.id("reviews"),
    status: v.union(v.literal("published"), v.literal("hidden")),
  },
  handler: async (ctx, { reviewId, status }) => {
    // branding.edit == controls public-facing studio content (booking page).
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const review = await ctx.db.get(reviewId);
    if (!review || review.orgId !== orgId) throw new ConvexError("Review not found.");
    await ctx.db.patch(reviewId, { status });
    return { ok: true };
  },
});

// ── Public feed (social proof on the booking page) ──────────────────────

/** Public: published reviews for a studio, latest first, capped. Returns only
 *  author / rating / text / date - never internal ids or hidden rows. */
export const publicForOrg = query({
  args: { orgId: v.optional(v.string()), slug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = await resolveOrgId(ctx, args);
    if (!orgId) return [];
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "published"))
      .order("desc")
      .take(REVIEW_CAP);
    return rows.map((r) => ({
      rating: r.rating,
      text: r.text,
      authorName: r.authorName,
      at: r.at,
    }));
  },
});

/** Public: average rating + count over published reviews, for the booking-page
 *  header ("4.9 from 37 reviews"). */
export const stats = query({
  args: { orgId: v.optional(v.string()), slug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = await resolveOrgId(ctx, args);
    if (!orgId) return { avg: 0, count: 0 };
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "published"))
      .collect();
    const count = rows.length;
    if (count === 0) return { avg: 0, count: 0 };
    const sum = rows.reduce((s, r) => s + r.rating, 0);
    return { avg: Math.round((sum / count) * 10) / 10, count };
  },
});
