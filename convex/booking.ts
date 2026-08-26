import { query, mutation, action, internalQuery, QueryCtx } from "./_generated/server";
import { recordBooked } from "./bookingFunnel";
import { fireRules } from "./agentRules";
import { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { notify, notifyTeam } from "./lib/notify";
import { normalizePhone } from "./lib/phone";
import { money } from "./lib/money";
import { stripeClient } from "./lib/stripe";
import { ensureInquiryFromBooking } from "./opportunities";
import { whitelabelFor } from "./usage";
import {
  bookedUnits,
  gearAvailable,
  engineerAvailable,
  unitsOf,
  addOnsTotalCents,
} from "./lib/gearRental";
import { normalizeEmail, sameEmail } from "./lib/emailKey";
import { resolveCode, recordRedemption } from "./promos";

/* Staff roles a client can request to run their session, on the public page. */
const ENGINEER_ROLES = new Set(["owner", "engineer", "assistant_engineer", "producer"]);

/* ============================================================
   Booking - the public studio-booking backend (the /book pages).
   No auth required. These functions derive the org from the slug
   or from the entity itself (room / session) rather than from the
   caller, so any studio's booking page is publicly viewable.
   ============================================================ */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;
const HOLD_MINUTES = 60;

const serviceV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
);

async function photoOf(ctx: QueryCtx, item: Doc<"equipment">): Promise<string | null> {
  if (item.photoId) return await ctx.storage.getUrl(item.photoId);
  return item.photoUrl ?? null;
}

const defaults = (room: Doc<"rooms">) => ({
  minimumHours: room.minimumHours ?? 2,
  depositPct: room.depositPct ?? 30,
  hourlyRateCents: room.hourlyRateCents ?? 0,
  // Undefined means deposit: every room that predates the switch was sold
  // that way, and a silent flip to paid-in-full is a studio's pricing changed
  // without them touching it.
  paymentMode: room.paymentMode ?? ("deposit" as const),
});

/** The studio's branding block for the public page. */
async function brand(ctx: QueryCtx, org: Doc<"orgs"> | null) {
  return {
    name: org?.name ?? "Pulse Studio",
    tagline: org?.tagline ?? "Book your session.",
    accentColor: org?.accentColor ?? "#fdb913",
    palette: org?.brandPalette ?? null,
    logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    heroUrl: org?.bookingHeroId ? await ctx.storage.getUrl(org.bookingHeroId) : null,
    generatedHeroUrl: org?.generatedHeroId ? await ctx.storage.getUrl(org.generatedHeroId) : null,
    headline: org?.bookingHeadline ?? null,
    intro: org?.bookingIntro ?? null,
    depositPolicy: org?.depositPolicyText ?? null,
  };
}

/** Social proof for the public page: the studio's curated testimonials plus
 *  its published post-session reviews (rating average + a short recent feed).
 *  Read the reviews table directly server-side so the booking page always has
 *  proof-of-work without a cross-module dependency. A page selling $100+/hr
 *  time converts far better with real ratings + quotes than on price alone. */
async function socialProof(ctx: QueryCtx, org: Doc<"orgs"> | null, orgId: string) {
  const testimonials = org?.testimonials ?? [];
  const published = await ctx.db
    .query("reviews")
    .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "published"))
    .collect();
  const count = published.length;
  const average = count ? published.reduce((s, r) => s + r.rating, 0) / count : 0;
  const reviews = published
    .sort((a, b) => b.at - a.at)
    .slice(0, 6)
    .map((r) => ({
      rating: r.rating,
      text: r.text ?? null,
      authorName: r.authorName ?? null,
      at: r.at,
    }));
  return {
    testimonials,
    reviews,
    reviewStats: { count, average: Math.round(average * 10) / 10 },
  };
}

/** Public engineer profiles: the studio's engineers who have published a bio
 *  or notable credits, shown as proof-of-work where a client picks who runs
 *  their session. Only profiles with real content are surfaced. */
async function engineerProfiles(ctx: QueryCtx, orgId: string) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const profiles = await Promise.all(
    members
      .filter(
        (m) =>
          ENGINEER_ROLES.has(m.role) &&
          ((m.bio && m.bio.trim().length > 0) || (m.credits && m.credits.length > 0)),
      )
      .map(async (m) => ({
        id: m._id,
        name: m.name,
        role: m.role,
        bio: m.bio ?? null,
        credits: m.credits ?? [],
        photoUrl: m.photoId ? await ctx.storage.getUrl(m.photoId) : (m.clerkImageUrl ?? null),
      })),
  );
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/** Public studio front. `slug` selects a studio; omitted → the active org. */
export const studioFront = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    let org: Doc<"orgs"> | null;
    if (slug) {
      org = await ctx.db
        .query("orgs")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!org) return null;
    } else {
      const orgId = await currentOrg(ctx);
      org = await ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first();
    }
    const orgId = org?.orgId ?? (await currentOrg(ctx));

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const bookable = rooms.filter((r) => r.status !== "retired" && r.bookable !== false);
    const cards = await Promise.all(
      bookable.map(async (room) => {
        const gear = (
          await ctx.db
            .query("equipment")
            .withIndex("by_org_room", (q) =>
              q.eq("orgId", orgId).eq("installedInRoomId", room._id),
            )
            .collect()
        ).filter(
          (g) => !g.hideOnBooking && org?.showGearOnBooking !== false && room.showGear !== false,
        );
        const gearPhotos = (await Promise.all(gear.map((g) => photoOf(ctx, g)))).filter(
          (p): p is string => Boolean(p),
        );
        // Lead with the room hero shot (uploaded storage photo first, then the
        // legacy seeded URL), then gear photos as supporting frames.
        const heroShot = room.heroImageId
          ? await ctx.storage.getUrl(room.heroImageId)
          : room.heroImageUrl ?? null;
        const photos = [...(heroShot ? [heroShot] : []), ...gearPhotos].slice(0, 6);
        return {
          ...room,
          ...defaults(room),
          gearCount: gear.length,
          gearPreview: gear.slice(0, 4).map((g) => g.name),
          photos,
        };
      }),
    );
    /* The service catalogue, for a studio that sells what it DOES rather than
       where it does it. Only shipped when the studio has switched to it and
       has services to show - a catalogue page with nothing on it is worse
       than the rooms it replaced. */
    const services = await serviceCards(ctx, orgId, bookable);
    const catalog = org?.bookingCatalog === "services" && services.length > 0
      ? ("services" as const)
      : ("rooms" as const);

    const proof = await socialProof(ctx, org, orgId);
    return {
      orgId,
      org: await brand(ctx, org),
      whitelabel: await whitelabelFor(ctx, orgId),
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      catalog,
      services,
      rooms: cards.sort((a, b) => b.hourlyRateCents - a.hourlyRateCents),
      // Social proof + engineer credits - the conversion layer.
      testimonials: proof.testimonials,
      reviews: proof.reviews,
      reviewStats: proof.reviewStats,
      engineers: await engineerProfiles(ctx, orgId),
    };
  },
});

/* A service card: the product, with the room folded away behind it.

   The room id is deliberately NOT returned. A client picking "Podcast" does
   not need to know which four walls that happens in, and the moment the page
   knows, someone will render it. */
async function serviceCards(
  ctx: QueryCtx,
  orgId: string,
  bookableRooms: Doc<"rooms">[],
) {
  const live = new Set(bookableRooms.map((r) => String(r._id)));
  const rows = (
    await ctx.db
      .query("bookableServices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  )
    .filter((s) => s.active && live.has(String(s.roomId)))
    .sort((a, b) => a.order - b.order);

  return await Promise.all(
    rows.map(async (s) => ({
      _id: s._id,
      name: s.name,
      blurb: s.blurb ?? null,
      pricingMode: s.pricingMode,
      priceCents: s.priceCents,
      minimumHours: s.minimumHours ?? null,
      blockHours: s.blockHours ?? null,
      heroUrl: s.heroImageId
        ? await ctx.storage.getUrl(s.heroImageId)
        : s.heroImageUrl ?? null,
    })),
  );
}

/** One service, with the room it consumes resolved for the availability
 *  picker and its own add-ons. The room's name is returned for the studio's
 *  own surfaces; the public page shows the service. */
export const service = query({
  args: { serviceId: v.id("bookableServices") },
  handler: async (ctx, { serviceId }) => {
    const svc = await ctx.db.get(serviceId);
    if (!svc || !svc.active) return null;
    const room = await ctx.db.get(svc.roomId);
    if (!room || room.status === "retired") return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", svc.orgId))
      .first();

    /* Add-ons for THIS service. A podcast booking offers podcast edits; a
       vocal session does not offer a green screen film crew. */
    const addOns = (
      await Promise.all((svc.addOnFeeIds ?? []).map((id) => ctx.db.get(id)))
    )
      .filter((f): f is Doc<"feeTemplates"> => Boolean(f?.active))
      .map((f) => ({ _id: f._id, label: f.label, amountCents: f.amountCents, description: f.description ?? null }));

    const showGear = org?.showGearOnBooking !== false && room.showGear !== false;
    const gear = showGear
      ? (
          await ctx.db
            .query("equipment")
            .withIndex("by_org_room", (q) =>
              q.eq("orgId", svc.orgId).eq("installedInRoomId", svc.roomId),
            )
            .collect()
        ).filter((g) => !g.hideOnBooking)
      : [];

    return {
      _id: svc._id,
      orgId: svc.orgId,
      name: svc.name,
      blurb: svc.blurb ?? null,
      pricingMode: svc.pricingMode,
      priceCents: svc.priceCents,
      // The picker speaks in hours and an hourly rate. A flat service is its
      // block at its price, which is the same booking with the maths done.
      hourlyRateCents:
        svc.pricingMode === "hourly"
          ? svc.priceCents
          : Math.round(svc.priceCents / Math.max(1, svc.blockHours ?? 1)),
      minimumHours:
        svc.pricingMode === "flat"
          ? svc.blockHours ?? 1
          : svc.minimumHours ?? room.minimumHours ?? 1,
      blockHours: svc.blockHours ?? null,
      depositPct: svc.depositPct ?? room.depositPct ?? 30,
      // Inherited from the room: how a studio takes money is a property of the
      // studio, not of which product was bought.
      paymentMode: defaults(room).paymentMode,
      offerEngineer: room.offerEngineer !== false,
      heroUrl: svc.heroImageId
        ? await ctx.storage.getUrl(svc.heroImageId)
        : svc.heroImageUrl ?? null,
      // The room is the resource, not the product: its id is needed to read
      // availability, its name is not shown to the client.
      roomId: svc.roomId,
      roomName: room.name,
      studioName: org?.name ?? "Pulse Studio",
      depositPolicy: org?.depositPolicyText ?? null,
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      showGear,
      equipment: await Promise.all(
        gear
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (g) => ({
            _id: g._id,
            name: g.name,
            category: g.category,
            condition: g.condition,
            photo: await photoOf(ctx, g),
          })),
      ),
      addOns,
    };
  },
});

/** One bookable room with its installed-gear gallery. Org derived from the room. */
export const room = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status === "retired") return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", room.orgId))
      .first();
    /* The gear list is a studio's choice. A room whose kit is half in storage,
       or a studio that would rather talk about gear on a call, turns it off -
       and then it is not shipped to the browser either, because a list hidden
       with CSS is one devtools panel away from published. Undefined means on:
       a studio that never touched the switch has always shown its gear. */
    /* Two switches and a per-piece opt-out. The studio can publish no gear at
       all, a single room can stay quiet while the others list theirs, and any
       one piece can sit out - and none of it is SENT when it is not shown. */
    const showGear = org?.showGearOnBooking !== false && room.showGear !== false;
    const gear = showGear
      ? (
          await ctx.db
            .query("equipment")
            .withIndex("by_org_room", (q) =>
              q.eq("orgId", room.orgId).eq("installedInRoomId", roomId),
            )
            .collect()
        ).filter((g) => !g.hideOnBooking)
      : [];
    const equipment = await Promise.all(
      gear.map(async (g) => ({
        _id: g._id,
        name: g.name,
        category: g.category,
        condition: g.condition,
        photo: await photoOf(ctx, g),
      })),
    );
    const proof = await socialProof(ctx, org, room.orgId);
    return {
      ...room,
      ...defaults(room),
      heroUrl: room.heroImageId
        ? await ctx.storage.getUrl(room.heroImageId)
        : (room.heroImageUrl ?? null),
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      studioName: org?.name ?? "Pulse Studio",
      depositPolicy: org?.depositPolicyText ?? null,
      showGear,
      paymentMode: defaults(room).paymentMode,
      offerEngineer: room.offerEngineer !== false,
      equipment: equipment.sort((a, b) => a.name.localeCompare(b.name)),
      // Social proof for the room page trust strip.
      testimonials: proof.testimonials,
      reviews: proof.reviews,
      reviewStats: proof.reviewStats,
    };
  },
});

/** Validate one promo code against the room's studio. PUBLIC (org derived
 *  from the room, like the other booking queries) - it answers for the ONE
 *  submitted code only and never exposes the org's full code list to
 *  anonymous viewers. The client uses this for display; createBooking
 *  re-validates server-side and recomputes the authoritative amounts. */
export const validateCode = query({
  args: { roomId: v.id("rooms"), code: v.string() },
  handler: async (ctx, { roomId, code }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status === "retired") return { valid: false as const };
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", room.orgId))
      .first();
    const match = await resolveCode(ctx, org, code, roomId, Date.now());
    if (!match) return { valid: false as const };
    return { valid: true as const, code: match.code, pct: match.pct, label: match.label, ...(match.expiresAt ? { expiresAt: match.expiresAt } : {}) };
  },
});

/** Hourly availability for a room on one day. `dayStart` is local midnight. */
export const availability = query({
  args: { roomId: v.id("rooms"), dayStart: v.number() },
  handler: async (ctx, { roomId, dayStart }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return { slots: [], booked: [] };

    const sameDay = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", room.orgId).gte("startTime", dayStart).lt("startTime", dayStart + DAY),
      )
      .collect();
    const booked = sameDay.filter(
      (s) => s.roomId === roomId && s.status !== "cancelled" && s.status !== "no_show",
    );

    const now = Date.now();
    const slots = [];
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      const start = dayStart + h * HOUR;
      const end = start + HOUR;
      const taken = booked.some((b) => b.startTime < end && b.endTime > start);
      slots.push({ hour: h, startTime: start, available: !taken && start > now });
    }
    return {
      slots,
      // PUBLIC endpoint: return only busy time blocks, never the session title -
      // titles embed the client's name ("{client} - {room}") and would leak the
      // studio's whole client list to anonymous viewers.
      booked: booked.map((b) => ({ start: b.startTime, end: b.endTime })),
    };
  },
});

/** Add-on options for a specific room + time window: which engineers are free
 *  and which premium gear can be rented, each priced and conflict-checked
 *  against overlapping sessions so a single unit is never double-booked. Public
 *  (org derived from the room). Re-runs as the client changes their time. */
export const addOnOptions = query({
  args: { roomId: v.id("rooms"), startTime: v.number(), durationHours: v.number() },
  handler: async (ctx, { roomId, startTime, durationHours }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return { engineers: [], gear: [] };
    const orgId = room.orgId;
    const endTime = startTime + durationHours * HOUR;

    // Sessions that could overlap the window (load a day of lead-in, then
    // filter precisely inside the pure helpers).
    const around = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", startTime - DAY).lt("startTime", endTime),
      )
      .collect();

    /* A studio that does not offer the choice does not ship its roster: names,
       photos, bios and credits are staff data, and a list nobody is allowed to
       pick from is a list that should not have been sent. */
    const members = room.offerEngineer === false
      ? []
      : await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
    const engineers = await Promise.all(
      members
        .filter((m) => ENGINEER_ROLES.has(m.role))
        .map(async (m) => ({
          id: m._id,
          name: m.name,
          role: m.role,
          // Bio + notable credits are the proof-of-work shown at the point a
          // client is choosing who runs their session.
          bio: m.bio ?? null,
          credits: m.credits ?? [],
          photoUrl: m.photoId ? await ctx.storage.getUrl(m.photoId) : (m.clerkImageUrl ?? null),
          available: engineerAvailable(m._id, startTime, endTime, around),
        })),
    );
    engineers.sort(
      (a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name),
    );

    const equip = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const gear = await Promise.all(
      equip
        .filter((e) => e.rentable)
        .map(async (e) => {
          const booked = bookedUnits(e._id, startTime, endTime, around);
          return {
            id: e._id,
            name: e.name,
            category: e.category,
            priceCents: e.rentalPriceCents ?? 0,
            photo: await photoOf(ctx, e),
            quantity: unitsOf(e),
            bookedUnits: booked,
            available: gearAvailable(e, booked),
          };
        }),
    );
    gear.sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));

    return { engineers, gear };
  },
});

/** Session + payment state - drives the checkout / confirmation page. */
export const booking = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const [room, artist, payments, org, engineer] = await Promise.all([
      session.roomId ? ctx.db.get(session.roomId) : null,
      ctx.db.get(session.artistId),
      ctx.db
        .query("payments")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect(),
      ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", session.orgId))
        .first(),
      session.engineerId ? ctx.db.get(session.engineerId) : null,
    ]);
    const paid = session.amountPaidCents ?? 0;
    return {
      ...session,
      roomName: room?.name ?? "Studio",
      clientName: artist?.name ?? "Guest",
      clientEmail: artist?.email ?? null,
      engineerName: engineer?.name ?? null,
      addOns: session.addOns ?? [],
      serviceAddOns: session.serviceAddOns ?? [],
      // The checkout page must not offer a deposit the studio does not accept.
      paymentMode: room ? defaults(room).paymentMode : ("deposit" as const),
      payments: payments.sort((a, b) => a._creationTime - b._creationTime),
      paidCents: paid,
      balanceCents: Math.max(0, session.rateCents - paid),
      fullyPaid: paid >= session.rateCents,
      // True when this studio collects real card payments on its own
      // connected Stripe account - the checkout page then routes through
      // hosted Stripe Checkout and never shows the simulated card form.
      stripeCheckout: Boolean(
        process.env.STRIPE_SECRET_KEY && org?.stripeAccountId && org?.stripeChargesEnabled,
      ),
    };
  },
});

/** Create a held booking. Status starts "tentative" until the deposit clears. */
export const createBooking = mutation({
  args: {
    /* One of these two. `serviceId` is the service-catalogue path: the client
       picked "Podcast" and the room it consumes is looked up here, because the
       page does not know it and must not be trusted with it. `roomId` is the
       original room-first path, unchanged. */
    roomId: v.optional(v.id("rooms")),
    serviceId: v.optional(v.id("bookableServices")),
    clientName: v.string(),
    clientEmail: v.string(),
    clientPhone: v.optional(v.string()),
    startTime: v.number(),
    durationHours: v.number(),
    serviceType: v.optional(serviceV),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
    // Referral attribution: an artistId from a ?ref= share link. Validated
    // server-side (must be a real artist in THIS org); anything else is ignored
    // so a garbage ref never errors a public booking.
    ref: v.optional(v.string()),
    // Add-ons: a requested engineer + premium gear rented for this session.
    engineerId: v.optional(v.id("members")),
    addOnEquipmentIds: v.optional(v.array(v.id("equipment"))),
    /** Service add-ons (feeTemplates offered with this service). */
    addOnFeeIds: v.optional(v.array(v.id("feeTemplates"))),
    gearRequestNote: v.optional(v.string()),
    // Promo code (from ?code= links or typed in). Validated server-side
    // against orgs.discountCodes; invalid codes are a hard error, never a
    // silent full-price charge.
    discountCode: v.optional(v.string()),
    // Anonymous funnel key minted by the booking page. Optional and
    // untrusted: it only ever attributes a visit, never authorizes anything.
    visitorKey: v.optional(v.string()),
    // Post attribution: a ?src=<postId> tracked link. Its own arg, resolved
    // independently of the room/service path below.
    src: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const svc = args.serviceId ? await ctx.db.get(args.serviceId) : null;
    if (args.serviceId && !svc?.active) throw new Error("That service is no longer offered.");
    const roomId = svc ? svc.roomId : args.roomId;
    if (!roomId) throw new Error("Pick a room or a service.");
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error("Room not found.");
    if (room.status === "retired" || room.bookable === false) {
      throw new Error("This room is not open for booking.");
    }
    const orgId = room.orgId;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    /* A service prices itself. A flat service ("$150 for a two hour shoot")
       is stored as its block and its price; the picker speaks hourly, so it
       is divided back out here and multiplied by a duration the minimum has
       already pinned to the block. */
    const roomCfg = defaults(room);
    const cfg = svc
      ? {
          ...roomCfg,
          hourlyRateCents:
            svc.pricingMode === "hourly"
              ? svc.priceCents
              : Math.round(svc.priceCents / Math.max(1, svc.blockHours ?? 1)),
          minimumHours:
            svc.pricingMode === "flat"
              ? svc.blockHours ?? 1
              : svc.minimumHours ?? roomCfg.minimumHours,
          depositPct: svc.depositPct ?? roomCfg.depositPct,
        }
      : roomCfg;
    if (args.durationHours < cfg.minimumHours) {
      throw new Error(
        svc
          ? `${svc.name} has a ${cfg.minimumHours}-hour minimum.`
          : `This room has a ${cfg.minimumHours}-hour minimum.`,
      );
    }
    const endTime = args.startTime + args.durationHours * HOUR;
    if (args.startTime <= Date.now()) throw new Error("Pick a start time in the future.");

    // Abuse guard: cap public booking requests per org per hour. Each request
    // creates several rows and emails both the team and the (attacker-supplied)
    // client address, so an unbounded public endpoint is a spam + email-
    // amplification vector. 40/hour is generous for real demand.
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const bookingCounter = await ctx.db
      .query("usageCounters")
      .withIndex("by_org_period_metric", (q) =>
        q.eq("orgId", orgId).eq("period", hourBucket).eq("metric", "public_bookings"),
      )
      .first();
    if ((bookingCounter?.value ?? 0) >= 40) {
      throw new Error("Too many booking requests right now. Please try again shortly.");
    }

    const around = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", args.startTime - DAY).lt("startTime", endTime),
      )
      .collect();
    const clash = around.some(
      (s) =>
        s.roomId === roomId &&
        s.status !== "cancelled" &&
        s.status !== "no_show" &&
        s.startTime < endTime &&
        s.endTime > args.startTime,
    );
    if (clash) throw new Error("That time was just taken - pick another slot.");

    // ── Add-ons: validate the requested engineer + premium gear against the
    // SAME overlapping-sessions window, on the server. A single unit can never
    // be double-booked, and prices come from the DB, never the client. ──
    let engineerId: Id<"members"> | undefined;
    let engineerName: string | undefined;
    let engineerEmail: string | undefined;
    if (args.engineerId) {
      const m = await ctx.db.get(args.engineerId);
      if (!m || m.orgId !== orgId || !ENGINEER_ROLES.has(m.role)) {
        throw new Error("That engineer is not available to book.");
      }
      if (!engineerAvailable(m._id, args.startTime, endTime, around)) {
        throw new Error(`${m.name} was just booked for that time. Pick another engineer.`);
      }
      engineerId = m._id;
      engineerName = m.name;
      engineerEmail = m.email;
    }

    const addOns: { equipmentId: Id<"equipment">; name: string; priceCents: number }[] = [];
    for (const eqId of args.addOnEquipmentIds ?? []) {
      const item = await ctx.db.get(eqId);
      if (!item || item.orgId !== orgId || !item.rentable) {
        throw new Error("One of the gear add-ons is no longer available.");
      }
      const booked = bookedUnits(item._id, args.startTime, endTime, around);
      if (!gearAvailable(item, booked)) {
        throw new Error(
          `${item.name} was just booked for that time. Pick another option, or request it and the studio will follow up.`,
        );
      }
      addOns.push({ equipmentId: item._id, name: item.name, priceCents: item.rentalPriceCents ?? 0 });
    }
    /* Service add-ons: podcast edits, a photographer, a film crew. Priced from
       the studio's own fee templates, never from the page - and only the ones
       THIS service offers, so a vocal session cannot be sold a green screen
       crew by editing a request. */
    const offered = new Set((svc?.addOnFeeIds ?? []).map(String));
    const serviceAddOns: { feeId: Id<"feeTemplates">; label: string; amountCents: number }[] = [];
    for (const feeId of args.addOnFeeIds ?? []) {
      if (!offered.has(String(feeId))) throw new Error("That add-on is not offered with this service.");
      const fee = await ctx.db.get(feeId);
      if (!fee || fee.orgId !== orgId || !fee.active) {
        throw new Error("One of the add-ons is no longer available.");
      }
      serviceAddOns.push({ feeId: fee._id, label: fee.label, amountCents: fee.amountCents });
    }
    const serviceAddOnCents = serviceAddOns.reduce((sum, a) => sum + a.amountCents, 0);

    const addOnTotalCents = addOnsTotalCents(addOns) + serviceAddOnCents;
    const gearRequestNote = args.gearRequestNote?.trim() || undefined;

    // ── Discount code: validate against the org's owner-issued list on the
    // server, then apply to the room + add-on total below. An unknown or
    // paused code throws - the page must never show a code as applied while
    // the session silently bills full price. ──
    let discount: Awaited<ReturnType<typeof resolveCode>> = null;
    if (args.discountCode?.trim()) {
      discount = await resolveCode(ctx, org, args.discountCode, roomId, Date.now());
      if (!discount) {
        throw new Error(
          "That discount code isn't valid or is no longer active. Remove it to book at the standard rate.",
        );
      }
    }

    const leadSource = args.source ?? "web_booking";

    // ── Referral attribution: a ?ref=<artistId> share link. Resolve it to a
    // real artist in THIS org (normalizeId never throws on garbage). A valid
    // ref flips the lead source to "referral" and records who referred them -
    // a field the app never wrote before. Anything invalid is silently ignored.
    let referredByArtistId: Id<"artists"> | undefined;
    if (args.ref) {
      const refId = ctx.db.normalizeId("artists", args.ref);
      if (refId) {
        const referrer = await ctx.db.get(refId);
        if (referrer && referrer.orgId === orgId) referredByArtistId = refId;
      }
    }
    const effectiveSource = referredByArtistId ? "referral" : leadSource;

    // ── Post attribution: a ?src=<postId> tracked link. Resolve it to a real
    // socialPosts row in THIS org (normalizeId never throws on garbage).
    // Anything invalid or foreign is silently ignored. ──
    let postId: Id<"socialPosts"> | undefined;
    if (args.src) {
      const srcId = ctx.db.normalizeId("socialPosts", args.src);
      if (srcId) {
        const post = await ctx.db.get(srcId);
        if (post && post.orgId === orgId) postId = srcId;
      }
    }

    const email = args.clientEmail.trim().toLowerCase();
    const existing = (
      await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).find((a) => sameEmail(a.email, email));
    let artistId;
    const clientName = args.clientName.trim();
    if (existing) {
      artistId = existing._id;
      // First-touch attribution wins for source; only stamp a referrer when the
      // artist has none yet and the ref is not the artist referring themselves.
      const setReferrer =
        !existing.referredByArtistId && referredByArtistId && referredByArtistId !== existing._id;
      await ctx.db.patch(existing._id, {
        phone: args.clientPhone ?? existing.phone,
        lastContactAt: Date.now(),
        source: existing.source ?? effectiveSource,
        ...(setReferrer ? { referredByArtistId } : {}),
      });
    } else {
      artistId = await ctx.db.insert("artists", {
        orgId,
        name: clientName,
        type: "artist",
        email: normalizeEmail(args.clientEmail),
        phone: args.clientPhone,
        genres: [],
        tags: ["Booked online"],
        status: "lead",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
        lastContactAt: Date.now(),
        source: effectiveSource,
        ...(referredByArtistId ? { referredByArtistId } : {}),
      });
    }

    // The undiscounted (list) total, then the rate actually billed. The
    // deposit is computed off the billed rate so it stays proportional to
    // what the client owes, discounted or not.
    const listRateCents = cfg.hourlyRateCents * args.durationHours + addOnTotalCents;
    const rateCents = discount
      ? Math.round((listRateCents * (100 - discount.pct)) / 100)
      : listRateCents;
    /* What is due now. On a paid-in-full room that is the whole thing - the
       "deposit" is the price, so the hold clears the moment it is paid and no
       balance is left to chase. */
    const depositCents =
      cfg.paymentMode === "full"
        ? rateCents
        : Math.round((rateCents * cfg.depositPct) / 100);
    const sessionId = await ctx.db.insert("sessions", {
      orgId,
      title: `${args.clientName.trim()} - ${svc ? svc.name : room.name}`,
      artistId,
      /* Filed under one of the seven when the service maps to one, otherwise
         as a custom category carrying the service's name - so "Podcast" reads
         as Podcast on the calendar instead of being squeezed into a service
         type that does not describe it. */
      serviceType: svc
        ? svc.sessionServiceType ?? "custom"
        : args.serviceType ?? "recording",
      ...(svc && !svc.sessionServiceType ? { customService: svc.name } : {}),
      roomId: roomId,
      startTime: args.startTime,
      endTime,
      status: "tentative",
      rateCents,
      depositCents,
      depositPaid: false,
      intakeCompleted: false,
      notes: args.notes,
      amountPaidCents: 0,
      ...(serviceAddOns.length ? { serviceAddOns } : {}),
      source: "public_booking",
      holdExpiresAt: Date.now() + HOLD_MINUTES * 60_000,
      ...(engineerId ? { engineerId, engineerRequestStatus: "pending" as const } : {}),
      ...(addOns.length ? { addOns } : {}),
      ...(gearRequestNote ? { gearRequestNote } : {}),
      // Mark discounted sessions with the comp fields so the existing comp
      // report picks up the foregone revenue (listValue - rate) automatically.
      ...(discount
        ? {
            compType: "discounted" as const,
            listValueCents: listRateCents,
            compReason: `Code ${discount.code}`,
          }
        : {}),
    });

    // Close the booking-page funnel: this visitor got all the way through.
    // Written here rather than from the client so the booked count can never
    // be inflated from outside.
    await recordBooked(ctx, orgId, args.visitorKey, sessionId, rateCents, {
      ref: args.ref,
      code: discount?.code,
      postId,
    });
    if (discount?.promoId) await recordRedemption(ctx, discount.promoId);

    // Standing rules that fire on a new booking.
    await fireRules(ctx, orgId, "booking.created", {
      clientName: clientName,
      entityType: "session",
      entityId: sessionId,
    });

    // Lead→booking funnel: open an `inquiry` opportunity for this lead so the
    // deal lands on the pipeline board alongside the held session.
    await ensureInquiryFromBooking(ctx, {
      orgId,
      artistId,
      artistName: clientName,
      serviceType: args.serviceType ?? "recording",
      valueCents: rateCents,
      source: effectiveSource,
    });

    await ctx.db.insert("activity", {
      orgId,
      kind: "booking.created",
      summary: `Online booking held - ${room.name} for ${args.clientName.trim()}`,
      entityType: "session",
      entityId: sessionId,
      accent: "gold",
    });
    await ctx.db.insert("insights", {
      orgId,
      kind: "opportunity",
      severity: "opportunity",
      title: `New online booking - ${room.name}`,
      body: `${args.clientName.trim()} held ${args.durationHours}h. The ${money(
        depositCents,
      )} deposit holds it for ${HOLD_MINUTES} minutes.`,
      entityType: "session",
      entityId: sessionId,
      status: "new",
    });
    await notify(ctx, {
      orgId,
      channel: "email",
      recipient: args.clientEmail.trim(),
      subject: `Hold started - ${room.name}`,
      body: `Your ${args.durationHours}-hour session is held. Pay the ${money(
        depositCents,
      )} deposit within ${HOLD_MINUTES} minutes to confirm it.`,
      kind: "booking.held",
      sessionId,
    });
    // The hold is a 60-minute PAYMENT window - email alone is the wrong channel
    // for a clock-ticking action, so also text the pay link when we have a
    // phone. (The T-15 expiry nudge is scheduled elsewhere; this is the
    // immediate confirmation.)
    const phoneE164 = args.clientPhone ? normalizePhone(args.clientPhone) : null;
    if (phoneE164) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const payUrl = `${appUrl}/book/${org?.slug ?? ""}/checkout/${sessionId}`;
      await notify(ctx, {
        orgId,
        channel: "sms",
        recipient: phoneE164,
        subject: `Hold started - ${room.name}`,
        body: `${room.name} is held for you. Pay the ${money(depositCents)} deposit within ${HOLD_MINUTES} min to confirm: ${payUrl}`,
        kind: "booking.held",
        sessionId,
      });
    }
    // Internal team: a new booking request just landed, with any engineer
    // request, rented gear, and a free-text gear ask to follow up on.
    const addOnLine = addOns.length
      ? `\nGear add-ons: ${addOns.map((a) => `${a.name} (${money(a.priceCents)})`).join(", ")}.`
      : "";
    const engineerLine = engineerName ? `\nRequested engineer: ${engineerName}.` : "";
    const requestLine = gearRequestNote ? `\nGear request to follow up: "${gearRequestNote}".` : "";
    const discountLine = discount
      ? `\nDiscount code ${discount.code} applied: ${discount.pct}% off (list ${money(listRateCents)}, billed ${money(rateCents)}).`
      : "";
    await notifyTeam(ctx, {
      orgId,
      subject: `New booking - ${room.name}, ${new Date(args.startTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      body: `${args.clientName} (${args.clientEmail.trim()}) requested ${args.durationHours}h in ${room.name}. The room is held pending the ${money(depositCents)} deposit.${engineerLine}${addOnLine}${requestLine}${discountLine}`,
      kind: "booking.created",
      sessionId,
    });
    // Personally notify the requested engineer - their confirmation is what
    // finalizes the booking (managers can override from the session sheet).
    if (engineerId) {
      await ctx.db.insert("activity", {
        orgId,
        kind: "engineer.requested",
        summary: `${engineerName} requested by ${args.clientName.trim()} - awaiting confirmation`,
        actorName: engineerName,
        entityType: "session",
        entityId: sessionId,
        accent: "gold",
      });
    }
    if (engineerEmail) {
      const appUrl = process.env.APP_URL ?? "https://pulse.myindsound.com";
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: engineerEmail,
        subject: `Action needed: ${args.clientName} requested you - ${room.name}`,
        body: `${args.clientName} requested you for a ${args.durationHours}-hour session in ${room.name} on ${new Date(args.startTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.

The booking is finalized once you confirm. Review it here: ${appUrl}/schedule`,
        kind: "booking.engineer_requested",
        sessionId,
      });
    }

    // Count this booking against the per-org hourly rate limit.
    if (bookingCounter) {
      await ctx.db.patch(bookingCounter._id, { value: bookingCounter.value + 1, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("usageCounters", {
        orgId,
        period: hourBucket,
        metric: "public_bookings",
        value: 1,
        updatedAt: Date.now(),
      });
    }

    return {
      sessionId,
      rateCents,
      depositCents,
      depositPct: cfg.depositPct,
      addOnTotalCents,
      listValueCents: listRateCents,
      discountPct: discount?.pct ?? 0,
      discountCode: discount?.code ?? null,
    };
  },
});

/* ── Public deposit/balance payment via the studio's connected Stripe ──
   Resolves the org from the SESSION (no auth - public bookers). Returns a
   hosted Checkout URL, or { url: null } when the studio hasn't connected
   Stripe, so the page falls back to the simulated record path. The webhook
   (billingWebhooks: checkout.session.completed) settles the payment. */

export const _chargeContext = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", session.orgId))
      .first();
    const paid = session.amountPaidCents ?? 0;
    return {
      title: session.title,
      slug: org?.slug ?? "",
      depositCents: session.depositCents,
      balanceCents: Math.max(0, session.rateCents - paid),
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
    };
  },
});

export const payViaStripe = action({
  args: {
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("deposit"), v.literal("balance"), v.literal("full")),
  },
  handler: async (ctx, { sessionId, kind }): Promise<{ url: string | null }> => {
    const c = await ctx.runQuery(internal.booking._chargeContext, { sessionId });
    if (!c) throw new ConvexError("Booking not found.");
    // No connected Stripe (or platform Stripe unconfigured) → caller falls back
    // to the simulated path.
    if (!c.configured || !c.stripeAccountId || !c.chargesEnabled) return { url: null };

    const amount = kind === "deposit" ? Math.min(c.depositCents, c.balanceCents) : c.balanceCents;
    if (amount <= 0) return { url: null };

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const back = `${appUrl}/book/${c.slug}/checkout/${sessionId}`;
    const checkout = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `${kind === "deposit" ? "Deposit" : "Balance"} - ${c.title}` },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        success_url: `${back}?paid=1`,
        cancel_url: back,
        metadata: { sessionId, kind },
      },
      { stripeAccount: c.stripeAccountId }, // charge on the studio's own account
    );
    return { url: checkout.url ?? null };
  },
});
