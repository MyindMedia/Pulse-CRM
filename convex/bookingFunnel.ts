import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { currentOrgWithCapability } from "./lib/tenant";

/* ============================================================
   Booking funnel.

   The revenue half of this story already existed - Pulse knew what a
   booking was worth. What it could not say was what the booking page
   CONVERTED, because nothing ever recorded a visit.

   Privacy stance, deliberately narrow: no IP, no cookie, no
   fingerprint, no PII. The browser mints a random key per session and
   sends it with each step. That is enough to count distinct people
   through four stages and nothing else. Rows age out on their own.
   ============================================================ */

const STEPS = ["page", "room", "checkout", "booked"] as const;
type Step = (typeof STEPS)[number];

/** "YYYY-MM-DD" in UTC. Aggregation buckets; not shown to anyone. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** A visitorKey is client-minted, so treat it as untrusted: bound the length
 *  and strip anything that is not URL-safe before it reaches an index. */
function cleanKey(raw: string): string | null {
  const k = raw.trim().slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "");
  return k.length >= 8 ? k : null;
}

function cleanTag(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().slice(0, 64);
  return v || undefined;
}

/**
 * Record one funnel step. PUBLIC and unauthenticated by design - it is called
 * from the booking page by people who do not have accounts.
 *
 * Deduped per (visitor, step, room) so a page refresh or a back-button does
 * not inflate the numbers, and capped per org per day so an open endpoint
 * cannot be used to write unbounded rows.
 */
export const track = mutation({
  args: {
    slug: v.string(),
    visitorKey: v.string(),
    step: v.union(v.literal("page"), v.literal("room"), v.literal("checkout")),
    roomId: v.optional(v.id("rooms")),
    ref: v.optional(v.string()),
    code: v.optional(v.string()),
    utmSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = cleanKey(args.visitorKey);
    if (!key) return { ok: false as const };

    // Org comes from the slug, never from the caller.
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!org) return { ok: false as const };
    const orgId = org.orgId;
    const now = Date.now();
    const day = dayKey(now);

    // Dedupe: the same person hitting the same step for the same room again
    // is the same person, not a second visit.
    const existing = await ctx.db
      .query("bookingVisits")
      .withIndex("by_org_visitor", (q) => q.eq("orgId", orgId).eq("visitorKey", key))
      .collect();
    if (existing.some((r) => r.step === args.step && r.roomId === args.roomId)) {
      return { ok: true as const, deduped: true };
    }

    // Volume guard. Generous for real traffic, finite for anyone abusive.
    const today = await ctx.db
      .query("bookingVisits")
      .withIndex("by_org_day", (q) => q.eq("orgId", orgId).eq("day", day))
      .collect();
    if (today.length >= 5000) return { ok: false as const };

    await ctx.db.insert("bookingVisits", {
      orgId,
      visitorKey: key,
      step: args.step,
      day,
      roomId: args.roomId,
      ref: cleanTag(args.ref),
      code: cleanTag(args.code),
      utmSource: cleanTag(args.utmSource),
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/** Server-written completion step. Called by createBooking, never by a client,
 *  so the "booked" count can never be inflated from outside. */
export async function recordBooked(
  ctx: MutationCtx,
  orgId: string,
  visitorKey: string | undefined,
  sessionId: Id<"sessions">,
  amountCents: number,
  extra: { ref?: string; code?: string } = {},
): Promise<void> {
  if (!visitorKey) return;
  const key = cleanKey(visitorKey);
  if (!key) return;
  const now = Date.now();
  await ctx.db.insert("bookingVisits", {
    orgId,
    visitorKey: key,
    step: "booked",
    day: dayKey(now),
    sessionId,
    amountCents,
    ref: cleanTag(extra.ref),
    code: cleanTag(extra.code),
    createdAt: now,
  });
}

/**
 * The funnel over a day range: distinct people at each stage, the drop between
 * stages, and what the page actually earned.
 *
 * Counts DISTINCT visitors per step, not rows - one person opening four rooms
 * is one person considering, not four.
 */
export const funnel = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const window = Math.min(Math.max(days ?? 30, 1), 365);
    const since = dayKey(Date.now() - (window - 1) * 86_400_000);

    const rows = await ctx.db
      .query("bookingVisits")
      .withIndex("by_org_day", (q) => q.eq("orgId", orgId).gte("day", since))
      .collect();

    const per: Record<Step, Set<string>> = {
      page: new Set(), room: new Set(), checkout: new Set(), booked: new Set(),
    };
    let revenueCents = 0;
    const bySource = new Map<string, { visitors: Set<string>; booked: Set<string>; cents: number }>();

    for (const r of rows) {
      per[r.step].add(r.visitorKey);
      if (r.step === "booked") revenueCents += r.amountCents ?? 0;

      const src = r.ref ? "referral" : r.code ? "promo" : r.utmSource || "direct";
      let bucket = bySource.get(src);
      if (!bucket) {
        bucket = { visitors: new Set(), booked: new Set(), cents: 0 };
        bySource.set(src, bucket);
      }
      bucket.visitors.add(r.visitorKey);
      if (r.step === "booked") {
        bucket.booked.add(r.visitorKey);
        bucket.cents += r.amountCents ?? 0;
      }
    }

    const counts = {
      page: per.page.size,
      room: per.room.size,
      checkout: per.checkout.size,
      booked: per.booked.size,
    };
    const rate = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

    return {
      windowDays: window,
      counts,
      // Percentage of the previous stage that carried on.
      stepRates: {
        pageToRoom: rate(counts.room, counts.page),
        roomToCheckout: rate(counts.checkout, counts.room),
        checkoutToBooked: rate(counts.booked, counts.checkout),
      },
      conversionRate: rate(counts.booked, counts.page),
      revenueCents,
      // The sentence this whole feature exists to be able to say.
      headline:
        counts.page === 0
          ? "No booking page visits recorded yet."
          : `Your booking page earned $${(revenueCents / 100).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })} from ${counts.booked} booking${counts.booked === 1 ? "" : "s"}, out of ${counts.page} visit${counts.page === 1 ? "" : "s"}.`,
      sources: [...bySource.entries()]
        .map(([source, b]) => ({
          source,
          visitors: b.visitors.size,
          booked: b.booked.size,
          revenueCents: b.cents,
          conversionRate: rate(b.booked.size, b.visitors.size),
        }))
        .sort((a, b) => b.revenueCents - a.revenueCents || b.visitors - a.visitors),
    };
  },
});
