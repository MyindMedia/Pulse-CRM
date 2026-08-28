import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { buildTrackedLink } from "./posts";
import { readTrackingParams, withTracking } from "@/lib/tracking-links";

/* The round trip nobody owned.

   posts.test.ts proves buildTrackedLink emits ?src= and ?code=.
   results.test.ts proves perPost counts bookingVisits rows that already carry
   a postId. Both passed while the wire between them was cut: a post with no
   room links to /book/<slug>, and the studio front page dropped both params
   on the way to the room, so the visitor paid full price and the post that
   drove the booking reported nothing.

   This test walks the whole path in one go - link, front page, room link,
   booking, readback - and pins the failure mode as well as the fix. It
   deliberately reaches across convex/ into src/lib, because the seam IS the
   thing under test. */

const DAY = 86_400_000;
const OWNER = "u_own";
const SLUG = "studio";

async function seed(t: ReturnType<typeof convexTest>, now: number) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Vault", slug: SLUG, plan: "studio", tier: "pro", status: "active",
    });
    await ctx.db.insert("members", {
      orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
    const roomId = await ctx.db.insert("rooms", {
      orgId: "org1", name: "A", hourlyRateCents: 10_000, depositPct: 50, status: "available", bookable: true,
    });
    const promoId = await ctx.db.insert("promos", {
      orgId: "org1", code: "SAVE20", pct: 20, startsAt: now - DAY, endsAt: now + 30 * DAY,
      redemptions: 0, source: "owner", active: true, createdBy: OWNER, createdAt: now,
    });
    // The default composer post: a promo, no room. This is the shape that
    // produces a room-less tracked link.
    const postId = await ctx.db.insert("socialPosts", {
      orgId: "org1", template: "rate_promo", status: "published", caption: "20 off this week",
      media: [], accountIds: [], scheduledFor: now - DAY, timezone: "UTC", ghlType: "post",
      submittedBy: OWNER, createdAt: now - DAY, updatedAt: now - DAY, publishedAt: now - DAY,
      promoId,
    });
    return { roomId, promoId, postId };
  });
}

/** The hop the visitor's browser makes: land on the tracked link, then click
 *  a room card. Returns the query the room page would read. */
function clickRoomCardFrom(trackedLink: string, slug: string, roomId: string) {
  const landed = new URL(trackedLink);
  const carried = readTrackingParams(landed.search);
  const roomHref = withTracking(`/book/${slug}/${roomId}`, carried);
  return new URLSearchParams(roomHref.split("?")[1] ?? "");
}

describe("tracked link to attributed booking", () => {
  it("carries src and code from a room-less post link through the front page into the booking", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const { roomId, postId, promoId } = await seed(t, now);

    // 1. The composer's default: a post with no room. The link lands on the
    //    studio front, one level above the page that reads these params.
    const link = buildTrackedLink({
      host: "https://studiopulse.tech", slug: SLUG, postId, code: "SAVE20",
    });
    expect(link).toBe(`https://studiopulse.tech/book/${SLUG}?src=${postId}&code=SAVE20`);

    // 2. Visitor lands, clicks a room card.
    const roomQuery = clickRoomCardFrom(link, SLUG, roomId);
    expect(roomQuery.get("src")).toBe(postId);
    expect(roomQuery.get("code")).toBe("SAVE20");

    // 3. The funnel step the room page fires, reading the live URL.
    await t.mutation(api.bookingFunnel.track, {
      slug: SLUG, visitorKey: "visitor-aaaaaaaa", step: "page",
      src: postId, code: "SAVE20",
    });

    // 4. The booking, with exactly what the room page has in hand.
    await t.mutation(api.booking.createBooking, {
      roomId,
      clientName: "Ari",
      clientEmail: "ari@example.com",
      startTime: now + 7 * DAY,
      durationHours: 4,
      visitorKey: "visitor-aaaaaaaa",
      src: roomQuery.get("src") ?? undefined,
      discountCode: roomQuery.get("code") ?? undefined,
    });

    // The advertised discount was actually applied: 4h at $100 is $400 list,
    // billed $320. A dropped ?code= is a silent full-price charge.
    const session = await t.run((ctx) => ctx.db.query("sessions").first());
    expect(session).toMatchObject({ listValueCents: 40_000, rateCents: 32_000 });

    // 5. Results reports the booking against the post that drove it.
    const owner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    const rows = await owner.query(api.marketing.results.perPost, {
      from: now - 30 * DAY, to: now + 30 * DAY,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      postId, clicks: 1, bookings: 1, revenueCents: 32_000, redemptions: 1,
    });

    const promo = await t.run((ctx) => ctx.db.get(promoId));
    expect(promo?.redemptions).toBe(1);
  });

  it("reports nothing when the front page drops the params, which is the defect this path had", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const { roomId, postId } = await seed(t, now);

    const link = buildTrackedLink({
      host: "https://studiopulse.tech", slug: SLUG, postId, code: "SAVE20",
    });
    // The old room-card href: ?ref= only, so src and code die at the click.
    const roomQuery = new URLSearchParams(
      (`/book/${SLUG}/${roomId}`).split("?")[1] ?? "",
    );
    expect(link).toContain("src=");
    expect(roomQuery.get("src")).toBeNull();

    await t.mutation(api.booking.createBooking, {
      roomId,
      clientName: "Ari",
      clientEmail: "ari@example.com",
      startTime: now + 7 * DAY,
      durationHours: 4,
      visitorKey: "visitor-bbbbbbbb",
      src: roomQuery.get("src") ?? undefined,
      discountCode: roomQuery.get("code") ?? undefined,
    });

    // Full price, and the post that sold the discount gets no credit.
    const session = await t.run((ctx) => ctx.db.query("sessions").first());
    expect(session?.rateCents).toBe(40_000);

    const owner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    const rows = await owner.query(api.marketing.results.perPost, {
      from: now - 30 * DAY, to: now + 30 * DAY,
    });
    expect(rows[0]).toMatchObject({ bookings: 0, revenueCents: 0, redemptions: 0 });
  });

  it("carries the same params onto a services-first studio's link", () => {
    // The services catalogue is the other route off the front page, and it
    // dropped src and code exactly the same way.
    const link = buildTrackedLink({
      host: "https://studiopulse.tech", slug: SLUG, postId: "p1", code: "SAVE20",
    });
    const carried = readTrackingParams(new URL(link).search);
    expect(withTracking(`/book/${SLUG}/s/svc1`, carried)).toBe(
      `/book/${SLUG}/s/svc1?src=p1&code=SAVE20`,
    );
  });
});
