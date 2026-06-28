import { query, mutation, action, internalQuery, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { notify, notifyTeam } from "./lib/notify";
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
        const gear = await ctx.db
          .query("equipment")
          .withIndex("by_org_room", (q) =>
            q.eq("orgId", orgId).eq("installedInRoomId", room._id),
          )
          .collect();
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
    return {
      orgId,
      org: await brand(ctx, org),
      whitelabel: await whitelabelFor(ctx, orgId),
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      rooms: cards.sort((a, b) => b.hourlyRateCents - a.hourlyRateCents),
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
    const gear = await ctx.db
      .query("equipment")
      .withIndex("by_org_room", (q) =>
        q.eq("orgId", room.orgId).eq("installedInRoomId", roomId),
      )
      .collect();
    const equipment = await Promise.all(
      gear.map(async (g) => ({
        _id: g._id,
        name: g.name,
        category: g.category,
        condition: g.condition,
        photo: await photoOf(ctx, g),
      })),
    );
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
      equipment: equipment.sort((a, b) => a.name.localeCompare(b.name)),
    };
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
      booked: booked.map((b) => ({ start: b.startTime, end: b.endTime, title: b.title })),
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

    const members = await ctx.db
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
    roomId: v.id("rooms"),
    clientName: v.string(),
    clientEmail: v.string(),
    clientPhone: v.optional(v.string()),
    startTime: v.number(),
    durationHours: v.number(),
    serviceType: v.optional(serviceV),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
    // Add-ons: a requested engineer + premium gear rented for this session.
    engineerId: v.optional(v.id("members")),
    addOnEquipmentIds: v.optional(v.array(v.id("equipment"))),
    gearRequestNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found.");
    if (room.status === "retired" || room.bookable === false) {
      throw new Error("This room is not open for booking.");
    }
    const orgId = room.orgId;
    const cfg = defaults(room);
    if (args.durationHours < cfg.minimumHours) {
      throw new Error(`This room has a ${cfg.minimumHours}-hour minimum.`);
    }
    const endTime = args.startTime + args.durationHours * HOUR;
    if (args.startTime <= Date.now()) throw new Error("Pick a start time in the future.");

    const around = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", args.startTime - DAY).lt("startTime", endTime),
      )
      .collect();
    const clash = around.some(
      (s) =>
        s.roomId === args.roomId &&
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
    const addOnTotalCents = addOnsTotalCents(addOns);
    const gearRequestNote = args.gearRequestNote?.trim() || undefined;

    const leadSource = args.source ?? "web_booking";
    const email = args.clientEmail.trim().toLowerCase();
    const existing = (
      await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).find((a) => a.email?.toLowerCase() === email);
    let artistId;
    const clientName = args.clientName.trim();
    if (existing) {
      artistId = existing._id;
      await ctx.db.patch(existing._id, {
        phone: args.clientPhone ?? existing.phone,
        lastContactAt: Date.now(),
        // Only stamp the lead-source if this artist had none (first touch wins).
        source: existing.source ?? leadSource,
      });
    } else {
      artistId = await ctx.db.insert("artists", {
        orgId,
        name: clientName,
        type: "artist",
        email: args.clientEmail.trim(),
        phone: args.clientPhone,
        genres: [],
        tags: ["Booked online"],
        status: "lead",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
        lastContactAt: Date.now(),
        source: leadSource,
      });
    }

    const rateCents = cfg.hourlyRateCents * args.durationHours + addOnTotalCents;
    const depositCents = Math.round((rateCents * cfg.depositPct) / 100);
    const sessionId = await ctx.db.insert("sessions", {
      orgId,
      title: `${args.clientName.trim()} - ${room.name}`,
      artistId,
      serviceType: args.serviceType ?? "recording",
      roomId: args.roomId,
      startTime: args.startTime,
      endTime,
      status: "tentative",
      rateCents,
      depositCents,
      depositPaid: false,
      intakeCompleted: false,
      notes: args.notes,
      amountPaidCents: 0,
      source: "public_booking",
      holdExpiresAt: Date.now() + HOLD_MINUTES * 60_000,
      ...(engineerId ? { engineerId } : {}),
      ...(addOns.length ? { addOns } : {}),
      ...(gearRequestNote ? { gearRequestNote } : {}),
    });

    // Lead→booking funnel: open an `inquiry` opportunity for this lead so the
    // deal lands on the pipeline board alongside the held session.
    await ensureInquiryFromBooking(ctx, {
      orgId,
      artistId,
      artistName: clientName,
      serviceType: args.serviceType ?? "recording",
      valueCents: rateCents,
      source: leadSource,
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
    // Internal team: a new booking request just landed, with any engineer
    // request, rented gear, and a free-text gear ask to follow up on.
    const addOnLine = addOns.length
      ? `\nGear add-ons: ${addOns.map((a) => `${a.name} (${money(a.priceCents)})`).join(", ")}.`
      : "";
    const engineerLine = engineerName ? `\nRequested engineer: ${engineerName}.` : "";
    const requestLine = gearRequestNote ? `\nGear request to follow up: "${gearRequestNote}".` : "";
    await notifyTeam(ctx, {
      orgId,
      subject: `New booking - ${room.name}, ${new Date(args.startTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      body: `${args.clientName} (${args.clientEmail.trim()}) requested ${args.durationHours}h in ${room.name}. The room is held pending the ${money(depositCents)} deposit.${engineerLine}${addOnLine}${requestLine}`,
      kind: "booking.created",
      sessionId,
    });
    // Personally notify the requested engineer so they know to expect it.
    if (engineerEmail) {
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: engineerEmail,
        subject: `You were requested - ${room.name}`,
        body: `${args.clientName} requested you for a ${args.durationHours}-hour session in ${room.name} on ${new Date(args.startTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. It is held pending their deposit.`,
        kind: "booking.engineer_requested",
        sessionId,
      });
    }

    return {
      sessionId,
      rateCents,
      depositCents,
      depositPct: cfg.depositPct,
      addOnTotalCents,
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
