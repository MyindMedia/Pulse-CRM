import { query, action, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { currentOrg, currentOrgWithCapability, currentMoneySight, currentActor } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { requireFeature, orgHasFeature } from "./lib/entitlements";
import { stripeClient } from "./lib/stripe";
import { money } from "./lib/money";

/* ============================================================
   Prepaid hour-block packages ("10 hours, 15% off"). The studio
   sells a block; the client buys it (Stripe Connect checkout on
   the studio's own account); a packageCredit is created on
   purchase completion; the operator draws hours down against
   future sessions from the session sheet.

   Two tables (already in schema):
     - packageProducts  the sellable blocks the studio offers
     - packageCredits   a client's purchased, drawing-down balance

   Product management is gated like other finance presets
   (invoices.read to view, invoices.send to mutate). Redemption is
   session work (sessions.edit). Nothing here rewires the public
   createBooking flow - redemption is STUDIO-INITIATED, lower risk.

   Plan gate: SELLING (products, pay links, in-person sales) needs the
   Growth "packages" entitlement, the plan the price list names. USING
   hours a client already paid for (applying them to a session, taking
   them off on completion, putting them back) is never plan-gated: a
   studio that downgrades must not trap money its clients prepaid.

   Draw-down: staff choose a block for a session ("Pay with prepaid
   hours"). From then on the session counts as paid for the hours the
   block covers (prepaidCoverForSession): no background job chases,
   bills, releases or forfeits it for them. One prepaid hour pays one
   session hour at the session's price. Nothing comes off until STAFF
   complete the session (never the cron); then exactly the covered
   hours come off, once. Voiding a completed session (completed ->
   cancelled) or refunding it puts the hours back.
   ============================================================ */

function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

// ── Product CRUD ────────────────────────────────────────────

/** The studio's package products (newest first). */
export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.read", { orgId });
    await requireFeature(ctx, orgId, "packages");
    const rows = await ctx.db
      .query("packageProducts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((p) => (activeOnly ? p.active : true))
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * Public list of a studio's active packages, resolved by slug. No auth - this
 * is the read a public booking / buy-a-block surface uses. Returns [] for an
 * unknown slug rather than throwing.
 */
export const listActivePublic = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!org) return [];
    if (!(await orgHasFeature(ctx, org.orgId, "packages"))) return [];
    const rows = await ctx.db
      .query("packageProducts")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    return rows
      .filter((p) => p.active)
      .sort((a, b) => a.priceCents - b.priceCents)
      .map((p) => ({
        _id: p._id,
        name: p.name,
        hours: p.hours,
        priceCents: p.priceCents,
        description: p.description ?? null,
      }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    hours: v.number(),
    priceCents: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    await requireFeature(ctx, orgId, "packages");
    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the package a name.");
    if (!Number.isFinite(args.hours) || args.hours <= 0) {
      throw new ConvexError("Hours must be positive.");
    }
    if (!Number.isFinite(args.priceCents) || args.priceCents <= 0) {
      throw new ConvexError("Price must be positive.");
    }
    return ctx.db.insert("packageProducts", {
      orgId,
      name,
      hours: args.hours,
      priceCents: Math.round(args.priceCents),
      description: args.description?.trim() || undefined,
      active: true,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("packageProducts"),
    name: v.optional(v.string()),
    hours: v.optional(v.number()),
    priceCents: v.optional(v.number()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    await requireFeature(ctx, orgId, "packages");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Package not found.");
    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ConvexError("Give the package a name.");
      clean.name = name;
    }
    if (patch.hours !== undefined) {
      if (!Number.isFinite(patch.hours) || patch.hours <= 0) {
        throw new ConvexError("Hours must be positive.");
      }
      clean.hours = patch.hours;
    }
    if (patch.priceCents !== undefined) {
      if (!Number.isFinite(patch.priceCents) || patch.priceCents <= 0) {
        throw new ConvexError("Price must be positive.");
      }
      clean.priceCents = Math.round(patch.priceCents);
    }
    if (patch.description !== undefined) {
      clean.description = patch.description.trim() || undefined;
    }
    if (patch.active !== undefined) clean.active = patch.active;
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("packageProducts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    await requireFeature(ctx, orgId, "packages");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Package not found.");
    await ctx.db.delete(id);
  },
});

// ── Credits (sold blocks) ──────────────────────────────────

/** All credits sold, most recent first, joined to the buyer's name. */
export const soldCredits = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.read", { orgId });
    const rows = await ctx.db
      .query("packageCredits")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    rows.sort((a, b) => b.purchasedAt - a.purchasedAt);
    return Promise.all(
      rows.map(async (c) => {
        const artist = await ctx.db.get(c.artistId);
        return {
          _id: c._id,
          name: c.name,
          artistId: c.artistId,
          artistName: artist?.name ?? "Unknown client",
          hoursTotal: c.hoursTotal,
          hoursRemaining: c.hoursRemaining,
          priceCents: c.priceCents,
          status: c.status,
          purchasedAt: c.purchasedAt,
          source: c.source ?? "stripe",
          paymentMethod: c.paymentMethod ?? null,
          recordedByName: c.recordedByName ?? null,
        };
      }),
    );
  },
});

/** Active credits for one client (used on the session sheet). */
export const creditsForArtist = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const sight = await currentMoneySight(ctx);
    const rows = await ctx.db
      .query("packageCredits")
      .withIndex("by_org_artist", (q) => q.eq("orgId", orgId).eq("artistId", artistId))
      .collect();
    return rows
      .filter((c) => c.status === "active" && c.hoursRemaining > 0)
      .sort((a, b) => a.purchasedAt - b.purchasedAt)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        hoursTotal: c.hoursTotal,
        hoursRemaining: c.hoursRemaining,
        // What the block cost per hour (reporting only: an hour of the block
        // pays an hour of the session at the session's price).
        perHourCents: !sight.money ? null : c.hoursTotal > 0 ? Math.round(c.priceCents / c.hoursTotal) : 0,
      }));
  },
});

/**
 * Apply N hours of a client's active credit to a session. Reduces the session's
 * charged amount by the credit's per-hour value and decrements the balance.
 * Never overdraws a credit and never crosses orgs. Studio-initiated.
 */
export const redeem = mutation({
  args: {
    sessionId: v.id("sessions"),
    creditId: v.id("packageCredits"),
    hours: v.number(),
  },
  handler: async (ctx, { sessionId, creditId, hours }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new ConvexError("Hours to apply must be positive.");
    }
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) throw new ConvexError("Session not found.");
    const credit = await ctx.db.get(creditId);
    if (!credit || credit.orgId !== orgId) throw new ConvexError("Credit not found.");
    if (credit.status !== "active" || credit.hoursRemaining <= 0) {
      throw new ConvexError("This package has no hours left.");
    }
    // The credit belongs to the session's client.
    if (credit.artistId !== session.artistId) {
      throw new ConvexError("That package belongs to a different client.");
    }

    const hoursApplied = Math.min(hours, credit.hoursRemaining);
    const perHour = credit.hoursTotal > 0 ? credit.priceCents / credit.hoursTotal : 0;
    const valueCents = Math.min(session.rateCents, Math.round(perHour * hoursApplied));

    const hoursRemaining = Math.max(0, credit.hoursRemaining - hoursApplied);
    await ctx.db.patch(creditId, {
      hoursRemaining,
      status: hoursRemaining <= 0 ? "depleted" : "active",
    });
    const newRate = Math.max(0, session.rateCents - valueCents);
    await ctx.db.patch(sessionId, { rateCents: newRate });
    // Kept so the hours can be put back if the session is voided or refunded.
    await ctx.db.insert("packageDrawdowns", {
      orgId,
      creditId,
      sessionId,
      artistId: session.artistId,
      hours: hoursApplied,
      valueCents,
      kind: "manual",
      status: "applied",
      appliedAt: Date.now(),
    });

    await ctx.db.insert("activity", {
      orgId,
      kind: "session.package.redeemed",
      summary: `Applied ${hoursApplied}h from "${credit.name}" to "${session.title}" - ${money(valueCents)} covered`,
      entityType: "session",
      entityId: sessionId,
      accent: "positive",
    });
    return { hoursApplied, valueCents, hoursRemaining, rateCents: newRate };
  },
});

// ── Purchase (Stripe Connect checkout) ─────────────────────

export const _purchaseContext = internalQuery({
  args: { productId: v.id("packageProducts"), artistId: v.id("artists") },
  handler: async (ctx, { productId, artistId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    await requireFeature(ctx, orgId, "packages");
    const product = await ctx.db.get(productId);
    if (!product || product.orgId !== orgId || !product.active) return null;
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      orgId,
      slug: org?.slug ?? "",
      productName: product.name,
      hours: product.hours,
      priceCents: product.priceCents,
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
    };
  },
});

/**
 * Sell a package to a client. Creates a Stripe Checkout Session charged DIRECTLY
 * on the studio's connected account (funds land in the studio's Stripe). The
 * metadata carries kind/productId/artistId/orgId so the webhook can create the
 * credit on completion. Returns { url: null } when Stripe isn't connected so the
 * caller can fall back gracefully.
 */
export const purchaseCheckout = action({
  args: { productId: v.id("packageProducts"), artistId: v.id("artists") },
  handler: async (ctx, { productId, artistId }): Promise<{ url: string | null }> => {
    const c = await ctx.runQuery(internal.packages._purchaseContext, { productId, artistId });
    if (!c) throw new ConvexError("Package or client not found.");
    if (!c.configured || !c.stripeAccountId || !c.chargesEnabled) return { url: null };

    // The client pays, so the client lands on a public page, not the staff
    // /packages screen (which would ask them to sign in).
    const back = `${appUrl()}/pay/package?studio=${encodeURIComponent(c.slug)}`;
    const checkout = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `Package - ${c.productName}` },
              unit_amount: c.priceCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${back}&status=paid`,
        cancel_url: `${back}&status=cancelled`,
        // hours + priceCents are what the client was offered: if the studio
        // reprices the package before the client pays, the credit still
        // matches what was paid.
        metadata: {
          kind: "package",
          productId,
          artistId,
          orgId: c.orgId,
          hours: String(c.hours),
          priceCents: String(c.priceCents),
          // Kept so the hours are still created if the package is deleted
          // before the client pays.
          productName: c.productName.slice(0, 200),
        },
      },
      { stripeAccount: c.stripeAccountId }, // charge on the studio's own account
    );
    return { url: checkout.url ?? null };
  },
});

/**
 * Create a packageCredit from a completed purchase (Stripe) or an in-person
 * sale the studio recorded (manual). Plain helper (imported by billingWebhooks)
 * so both paths share one credit-creation path. The webhook's event-id guard
 * and the Stripe-reference check below make the Stripe path idempotent; the
 * manual path is idempotent through `saleKey` (see recordSale).
 */
export async function applyPackagePurchase(
  ctx: MutationCtx,
  args: {
    orgId: string;
    productId: Id<"packageProducts">;
    artistId: Id<"artists">;
    stripeReference?: string;
    source?: "stripe" | "manual";
    /** What the client was sold, when it differs from the product today. */
    hours?: number;
    priceCents?: number;
    recordedBy?: Id<"members">;
    recordedByName?: string;
    paymentMethod?: string;
    note?: string;
    saleKey?: string;
    /** The package name the client was sold (pay-link metadata), used when
     *  the product was deleted after the link was sent. */
    name?: string;
  },
): Promise<Id<"packageCredits"> | null> {
  const source = args.source ?? "stripe";
  const product = await ctx.db.get(args.productId);
  if (product && product.orgId !== args.orgId) return null;
  // A paid pay link still becomes hours if the package was deleted after the
  // link was sent: hours and price come from what the client was offered.
  if (
    !product &&
    !(source === "stripe" &&
      args.hours !== undefined && Number.isFinite(args.hours) && args.hours > 0 &&
      args.priceCents !== undefined && Number.isFinite(args.priceCents) && args.priceCents > 0)
  ) {
    return null;
  }
  const artist = await ctx.db.get(args.artistId);
  if (!artist || artist.orgId !== args.orgId) return null;
  const productName = product?.name ?? (args.name?.trim().slice(0, 200) || "Prepaid hours");

  // A Stripe payment creates at most one credit, even if it arrives under a
  // second event id.
  if (source === "stripe" && args.stripeReference) {
    const existing = await ctx.db
      .query("packageCredits")
      .withIndex("by_org_artist", (q) => q.eq("orgId", args.orgId).eq("artistId", args.artistId))
      .collect();
    const dup = existing.find((c) => c.stripeReference === args.stripeReference);
    if (dup) return dup._id;
  }

  const hours = args.hours !== undefined && Number.isFinite(args.hours) && args.hours > 0 ? args.hours : (product?.hours ?? 0);
  const priceCents =
    args.priceCents !== undefined && Number.isFinite(args.priceCents) && args.priceCents > 0
      ? Math.round(args.priceCents)
      : (product?.priceCents ?? 0);
  const now = Date.now();

  const creditId = await ctx.db.insert("packageCredits", {
    orgId: args.orgId,
    artistId: args.artistId,
    productId: args.productId,
    name: productName,
    hoursTotal: hours,
    hoursRemaining: hours,
    priceCents,
    status: "active",
    purchasedAt: now,
    stripeReference: args.stripeReference,
    source,
    recordedBy: args.recordedBy,
    recordedByName: args.recordedByName,
    paymentMethod: args.paymentMethod,
    note: args.note,
    saleKey: args.saleKey,
  });
  await ctx.db.insert("revenueEntries", {
    orgId: args.orgId,
    sourceType: "package",
    sourceId: creditId,
    provider: source,
    providerReference: source === "stripe" ? args.stripeReference : `manual:${creditId}`,
    incomeCategory: "packages_prepaid",
    amountCents: priceCents,
    currency: "USD",
    collectedAt: now,
  });
  await ctx.db.insert("activity", {
    orgId: args.orgId,
    kind: "package.purchased",
    summary:
      source === "manual"
        ? `${args.recordedByName ?? "Staff"} recorded ${artist.name} paying ${money(priceCents)} (${paymentMethodLabel(args.paymentMethod)}) for "${productName}" - ${hours}h`
        : `${artist.name} bought "${productName}" - ${hours}h for ${money(priceCents)}`,
    entityType: "artist",
    entityId: args.artistId,
    accent: "positive",
  });
  return creditId;
}

/** Internal wrapper so tests (and future callers) can create a credit directly. */
export const _applyPurchase = internalMutation({
  args: {
    orgId: v.string(),
    productId: v.id("packageProducts"),
    artistId: v.id("artists"),
    stripeReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => applyPackagePurchase(ctx, args),
});

// ── In-person sale ─────────────────────────────────────────

const PAYMENT_METHODS = ["cash", "card_in_person", "bank_transfer", "check", "other"] as const;
const paymentMethodV = v.union(
  v.literal("cash"),
  v.literal("card_in_person"),
  v.literal("bank_transfer"),
  v.literal("check"),
  v.literal("other"),
);

function paymentMethodLabel(method: string | undefined): string {
  switch (method) {
    case "cash": return "cash";
    case "card_in_person": return "card in person";
    case "bank_transfer": return "bank transfer";
    case "check": return "check";
    default: return "other";
  }
}

/**
 * Record that a client paid for a block in person (cash, card machine, bank
 * transfer, check). Creates the credit with who recorded it and how it was
 * paid. `saleKey` is a one-time key the dialog makes when it opens: a double
 * click or a retry sends the same key and gets the same credit back, never a
 * second one. Finance role (invoices.send) and the Growth packages plan.
 */
export const recordSale = mutation({
  args: {
    productId: v.id("packageProducts"),
    artistId: v.id("artists"),
    paymentMethod: paymentMethodV,
    note: v.optional(v.string()),
    saleKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ creditId: Id<"packageCredits">; duplicate: boolean }> => {
    const viewer = await requireCapability(ctx, "invoices.send");
    const orgId = viewer.orgId;
    if (!orgId) throw new ConvexError("Open a studio first.");
    await requireFeature(ctx, orgId, "packages");
    if (!(PAYMENT_METHODS as readonly string[]).includes(args.paymentMethod)) {
      throw new ConvexError("Choose how the client paid.");
    }
    const saleKey = args.saleKey.trim();
    if (saleKey.length < 8 || saleKey.length > 100) throw new ConvexError("Reopen the dialog and try again.");
    const note = args.note?.trim().slice(0, 500) || undefined;

    const product = await ctx.db.get(args.productId);
    if (!product || product.orgId !== orgId) throw new ConvexError("Package not found.");
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new ConvexError("Client not found.");

    // Same key: the first click already recorded it.
    const prior = await ctx.db
      .query("packageCredits")
      .withIndex("by_org_sale_key", (q) => q.eq("orgId", orgId).eq("saleKey", saleKey))
      .first();
    if (prior) {
      if (prior.artistId !== args.artistId || prior.productId !== args.productId) {
        throw new ConvexError("Reopen the dialog and try again.");
      }
      return { creditId: prior._id, duplicate: true };
    }
    if (!product.active) throw new ConvexError("This package is hidden. Show it before selling it.");

    const memberId =
      viewer.kind === "studio_member" ? ctx.db.normalizeId("members", String(viewer.memberId)) : null;
    const creditId = await applyPackagePurchase(ctx, {
      orgId,
      productId: args.productId,
      artistId: args.artistId,
      source: "manual",
      recordedBy: memberId ?? undefined,
      recordedByName: await currentActor(ctx),
      paymentMethod: args.paymentMethod,
      note,
      saleKey,
    });
    if (!creditId) throw new ConvexError("Package or client not found.");
    return { creditId, duplicate: false };
  },
});

// ── What a client has left ─────────────────────────────────

/** Every block a client bought, with what is left (client profile). */
export const balanceForArtist = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.read");
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;
    const sight = await currentMoneySight(ctx);
    const rows = await ctx.db
      .query("packageCredits")
      .withIndex("by_org_artist", (q) => q.eq("orgId", orgId).eq("artistId", artistId))
      .collect();
    rows.sort((a, b) => b.purchasedAt - a.purchasedAt);
    const hoursRemaining = rows
      .filter((c) => c.status === "active")
      .reduce((sum, c) => sum + c.hoursRemaining, 0);
    return {
      hoursRemaining: roundHours(hoursRemaining),
      canSell: await orgHasFeature(ctx, orgId, "packages"),
      credits: rows.map((c) => ({
        _id: c._id,
        name: c.name,
        hoursTotal: c.hoursTotal,
        hoursRemaining: c.hoursRemaining,
        status: c.status,
        purchasedAt: c.purchasedAt,
        priceCents: sight.money ? c.priceCents : null,
        source: c.source ?? "stripe",
      })),
    };
  },
});

// ── Draw-down on completion ────────────────────────────────

/** Hours to two decimals (a 90-minute session is 1.5h). */
function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

/**
 * Choose (or clear, with creditId null) the prepaid block that pays for this
 * session. Nothing comes off until the session is completed. Session work
 * (sessions.edit), like applying hours by hand. Not plan-gated: the client
 * already paid for these hours.
 */
export const chooseForSession = mutation({
  args: { sessionId: v.id("sessions"), creditId: v.union(v.id("packageCredits"), v.null()) },
  handler: async (ctx, { sessionId, creditId }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) throw new ConvexError("Session not found.");
    if (session.status === "completed" || session.status === "cancelled" || session.status === "no_show") {
      throw new ConvexError("This session is closed. Apply hours by hand instead.");
    }
    if (creditId === null) {
      if (session.packageCreditId) await ctx.db.patch(sessionId, { packageCreditId: undefined });
      return { ok: true as const };
    }
    const credit = await ctx.db.get(creditId);
    if (!credit || credit.orgId !== orgId) throw new ConvexError("Credit not found.");
    if (credit.artistId !== session.artistId) {
      throw new ConvexError("That package belongs to a different client.");
    }
    if (credit.status !== "active" || credit.hoursRemaining <= 0) {
      throw new ConvexError("This package has no hours left.");
    }
    if (session.packageCreditId === creditId) return { ok: true as const };
    await ctx.db.patch(sessionId, { packageCreditId: creditId });
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.package.chosen",
      summary: `"${session.title}" will be paid from "${credit.name}" when it is completed`,
      entityType: "session",
      entityId: sessionId,
      accent: "neutral",
    });
    return { ok: true as const };
  },
});

/** The block chosen for a session and every draw against it (session sheet). */
export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.read");
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    const sight = await currentMoneySight(ctx);
    const chosen = session.packageCreditId ? await ctx.db.get(session.packageCreditId) : null;
    const rows = await ctx.db
      .query("packageDrawdowns")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const draws = [];
    for (const r of rows) {
      if (r.orgId !== orgId) continue;
      const credit = await ctx.db.get(r.creditId);
      draws.push({
        _id: r._id,
        creditName: credit?.name ?? "Prepaid block",
        hours: r.hours,
        valueCents: sight.money ? r.valueCents : null,
        kind: r.kind,
        status: r.status,
        appliedAt: r.appliedAt,
        returnedAt: r.returnedAt ?? null,
        returnReason: r.returnReason ?? null,
      });
    }
    return {
      chosen:
        chosen && chosen.orgId === orgId
          ? { _id: chosen._id, name: chosen.name, hoursRemaining: chosen.hoursRemaining, status: chosen.status }
          : null,
      draws,
    };
  },
});

// ── What a chosen block covers ─────────────────────────────

type DbCtx = { db: QueryCtx["db"] };

/** Statuses a session can still be paid, chased or completed in. */
function isOpenSession(s: Doc<"sessions">): boolean {
  return s.status === "tentative" || s.status === "confirmed" || s.status === "in_progress";
}

/** Cash already in for a session. max() not sum: ledger deposits set BOTH
 *  amountPaidCents and depositPaid (same rule as automation.ts). */
function cashPaidCents(s: Doc<"sessions">): number {
  return Math.max(s.amountPaidCents ?? 0, s.depositPaid ? s.depositCents : 0);
}

export type PrepaidCover = {
  creditId: Id<"packageCredits">;
  creditName: string;
  /** Hours the block will give up when staff complete the session. */
  hours: number;
  /** What those hours are worth at the session's own price. */
  valueCents: number;
  /** Amount of invoices already raised for this session (subtracted). */
  invoicedCents: number;
};

/**
 * Hours of a chosen block already promised to OTHER open sessions that start
 * earlier (or at the same time with a lower id). Those are drawn first, so a
 * block chosen for two sessions never covers the same hour twice.
 */
async function hoursPromisedElsewhere(
  ctx: DbCtx,
  credit: Doc<"packageCredits">,
  s: Doc<"sessions">,
): Promise<number> {
  const others = await ctx.db
    .query("sessions")
    .withIndex("by_package_credit", (q) => q.eq("packageCreditId", credit._id))
    .take(200);
  let promised = 0;
  for (const o of others) {
    if (o._id === s._id || o.orgId !== s.orgId || !isOpenSession(o)) continue;
    const earlier = o.startTime < s.startTime || (o.startTime === s.startTime && o._id < s._id);
    if (!earlier) continue;
    const hours = Math.max(0, o.endTime - o.startTime) / 3_600_000;
    if (hours <= 0 || o.rateCents <= 0) continue;
    const owed = Math.max(0, o.rateCents - cashPaidCents(o));
    // Hours applied by hand already cut o.rateCents, so this is conservative
    // (it may promise a little more than o will take, never less).
    promised += Math.min(hours, owed / (o.rateCents / hours));
  }
  return promised;
}

/**
 * What the block chosen for a session pays for, worked out the same way for
 * every reader: the automation cron, the session sheet, pay links, the public
 * checkout and the completion draw. One prepaid hour pays for one hour of the
 * session at the session's own price, whatever the block cost. Cash already
 * paid and invoices already raised for the session are subtracted first, so a
 * session is never paid twice. Pure read: nothing comes off the block here.
 * Returns null when the block covers nothing.
 */
async function computeCover(ctx: DbCtx, s: Doc<"sessions">): Promise<PrepaidCover | null> {
  if (!s.packageCreditId) return null;
  const credit = await ctx.db.get(s.packageCreditId);
  if (
    !credit ||
    credit.orgId !== s.orgId ||
    credit.artistId !== s.artistId ||
    credit.status !== "active" ||
    credit.hoursRemaining <= 0
  ) {
    return null;
  }
  const rows = (
    await ctx.db
      .query("packageDrawdowns")
      .withIndex("by_session", (q) => q.eq("sessionId", s._id))
      .collect()
  ).filter((r) => r.orgId === s.orgId);
  // Drawn already, or refunded while completed: the block pays nothing more.
  if (rows.some((r) => r.kind === "completion" && (r.status === "applied" || r.returnReason === "refunded"))) {
    return null;
  }
  const applied = rows.filter((r) => r.status === "applied");
  const appliedHours = applied.reduce((sum, r) => sum + r.hours, 0);
  const appliedValue = applied.reduce((sum, r) => sum + r.valueCents, 0);
  // A voided draw left the price cut (putting hours back never raises a
  // price); count it back so a re-completed session is priced in full.
  const voidedValue = rows
    .filter((r) => r.status === "returned" && r.returnReason === "voided" && !r.repricedAt)
    .reduce((sum, r) => sum + r.valueCents, 0);
  const rateCents = s.rateCents + voidedValue;

  const sessionHours = Math.max(0, s.endTime - s.startTime) / 3_600_000;
  const need = sessionHours - appliedHours;
  const fullRate = rateCents + appliedValue;
  if (sessionHours <= 0 || need <= 0.004 || fullRate <= 0) return null;
  const perHour = fullRate / sessionHours;

  let invoicedCents = 0;
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_artist", (q) => q.eq("artistId", s.artistId))
    .collect();
  for (const inv of invoices) {
    if (inv.sessionId === s._id && inv.orgId === s.orgId && inv.status !== "void") invoicedCents += inv.amountCents;
  }
  const owed = Math.max(0, rateCents - cashPaidCents(s) - invoicedCents);
  if (owed <= 0) return null;

  const available = credit.hoursRemaining - (await hoursPromisedElsewhere(ctx, credit, s));
  if (available <= 0.004) return null;
  const owedHours = owed / perHour;
  const exact = Math.min(need, available, owedHours);
  // Every hour still owed is covered: the block pays the whole remainder, so
  // rounding never leaves a few cents for a job to chase.
  const coversAll = exact >= Math.min(need, owedHours) - 1e-9;
  const hours = Math.min(roundHours(exact), roundHours(credit.hoursRemaining));
  if (hours <= 0) return null;
  const valueCents = coversAll ? owed : Math.min(owed, Math.round(perHour * exact));
  return { creditId: credit._id, creditName: credit.name, hours, valueCents, invoicedCents };
}

/**
 * The prepaid cover of an OPEN session (tentative, confirmed, in progress).
 * Readers add `valueCents` to what the client has paid: a session paid from
 * prepaid hours is paid, so nothing chases, bills or cancels it for the hours
 * covered. A closed session has no cover here (its draw, if any, already cut
 * its rateCents).
 */
export async function prepaidCoverForSession(ctx: DbCtx, s: Doc<"sessions">): Promise<PrepaidCover | null> {
  if (!s.packageCreditId || !isOpenSession(s)) return null;
  return computeCover(ctx, s);
}

/** Just the cents, for readers that only need the number. */
export async function prepaidCoverCents(ctx: DbCtx, s: Doc<"sessions">): Promise<number> {
  return (await prepaidCoverForSession(ctx, s))?.valueCents ?? 0;
}

/**
 * Take the session's hours off the block chosen for it. Called ONLY when staff
 * complete the session (sessions.applyStatus): a background job never draws
 * hours. Takes exactly what computeCover says the block covers, so what the
 * cron and the sheet treated as paid is what comes off. Safe to call twice: a
 * session is drawn once. Returns the session as it is after the draw so the
 * caller bills only what is left. `s` is the session as it was before it was
 * marked completed.
 */
export async function drawDownOnCompletion(
  ctx: MutationCtx,
  s: Doc<"sessions">,
): Promise<Doc<"sessions">> {
  const chosenId = s.packageCreditId;
  if (!chosenId) return s;
  const rows = await ctx.db
    .query("packageDrawdowns")
    .withIndex("by_session", (q) => q.eq("sessionId", s._id))
    .collect();
  if (rows.some((r) => r.kind === "completion" && (r.status === "applied" || r.returnReason === "refunded"))) {
    return s;
  }
  // A voided draw left the price cut; the session is real again, so its price
  // comes back before the block is drawn and the rest is billed.
  const voided = rows.filter((r) => r.orgId === s.orgId && r.status === "returned" && r.returnReason === "voided" && !r.repricedAt);
  if (voided.length > 0) {
    const now = Date.now();
    for (const r of voided) await ctx.db.patch(r._id, { repricedAt: now });
    const back = voided.reduce((sum, r) => sum + r.valueCents, 0);
    await ctx.db.patch(s._id, { rateCents: s.rateCents + back });
    s = { ...s, rateCents: s.rateCents + back };
  }
  const credit = await ctx.db.get(chosenId);
  if (
    !credit ||
    credit.orgId !== s.orgId ||
    credit.artistId !== s.artistId ||
    credit.status !== "active" ||
    credit.hoursRemaining <= 0
  ) {
    await ctx.db.insert("activity", {
      orgId: s.orgId,
      kind: "session.package.skipped",
      summary: `"${s.title}" completed but its prepaid block has no hours left - bill the session as usual`,
      entityType: "session",
      entityId: s._id,
      accent: "caution",
    });
    return s;
  }
  // The same rule every reader used, so what was shown as paid is what comes
  // off (including hours promised to an earlier session on the same block).
  const cover = await computeCover(ctx, s);
  if (!cover) {
    if (rows.length === 0) {
      const invoiced = await ctx.db
        .query("invoices")
        .withIndex("by_artist", (q) => q.eq("artistId", s.artistId))
        .collect();
      if (invoiced.some((inv) => inv.sessionId === s._id && inv.status !== "void")) {
        await ctx.db.insert("activity", {
          orgId: s.orgId,
          kind: "session.package.skipped",
          summary: `"${s.title}" completed - no prepaid hours taken: the session was already invoiced or paid`,
          entityType: "session",
          entityId: s._id,
          accent: "caution",
        });
      }
    }
    return s;
  }

  const fresh = (await ctx.db.get(credit._id)) ?? credit;
  const hours = Math.min(cover.hours, fresh.hoursRemaining);
  const hoursRemaining = roundHours(Math.max(0, fresh.hoursRemaining - hours));
  await ctx.db.patch(credit._id, {
    hoursRemaining,
    status: hoursRemaining <= 0 ? "depleted" : "active",
  });
  await ctx.db.insert("packageDrawdowns", {
    orgId: s.orgId,
    creditId: credit._id,
    sessionId: s._id,
    artistId: s.artistId,
    hours,
    valueCents: cover.valueCents,
    kind: "completion",
    status: "applied",
    appliedAt: Date.now(),
  });
  await ctx.db.patch(s._id, { rateCents: Math.max(0, s.rateCents - cover.valueCents) });
  await ctx.db.insert("activity", {
    orgId: s.orgId,
    kind: "session.package.redeemed",
    summary: `${hours}h taken off "${credit.name}" for "${s.title}" - ${money(cover.valueCents)} covered, ${hoursRemaining}h left` +
      (cover.invoicedCents > 0 ? ` (after ${money(cover.invoicedCents)} already invoiced)` : ""),
    entityType: "session",
    entityId: s._id,
    accent: "positive",
  });
  return (await ctx.db.get(s._id)) ?? s;
}

/**
 * Put back every hour drawn for a session (voided or refunded). Safe to call
 * twice: returned rows are skipped. Putting hours back never creates a cash
 * debt by itself: on a completed, cancelled or no-show session the price stays
 * as it is (a refunded session does not turn into "$X due"). Only on a session
 * that has not happened yet (hours applied by hand, then taken back) does the
 * price return to what it was, because that is undoing the apply. A voided
 * session that is completed again gets its price back then (see
 * drawDownOnCompletion), when it is a real session again.
 */
export async function returnHoursForSession(
  ctx: MutationCtx,
  s: Doc<"sessions">,
  opts: { reason: "voided" | "refunded"; byName?: string },
): Promise<{ hoursReturned: number; valueCents: number }> {
  const rows = await ctx.db
    .query("packageDrawdowns")
    .withIndex("by_session", (q) => q.eq("sessionId", s._id))
    .collect();
  let hoursReturned = 0;
  let valueCents = 0;
  const now = Date.now();
  for (const r of rows) {
    if (r.status !== "applied" || r.orgId !== s.orgId) continue;
    const credit = await ctx.db.get(r.creditId);
    if (credit && credit.orgId === s.orgId) {
      const back = roundHours(Math.min(credit.hoursTotal, credit.hoursRemaining + r.hours));
      await ctx.db.patch(credit._id, {
        hoursRemaining: back,
        status: credit.status === "expired" ? "expired" : back > 0 ? "active" : "depleted",
      });
    }
    await ctx.db.patch(r._id, {
      status: "returned",
      returnedAt: now,
      returnedByName: opts.byName,
      returnReason: opts.reason,
    });
    hoursReturned += r.hours;
    valueCents += r.valueCents;
  }
  if (hoursReturned <= 0) return { hoursReturned: 0, valueCents: 0 };
  const fresh = await ctx.db.get(s._id);
  if (fresh && isOpenSession(fresh)) await ctx.db.patch(s._id, { rateCents: fresh.rateCents + valueCents });
  await ctx.db.insert("activity", {
    orgId: s.orgId,
    kind: "session.package.returned",
    summary: `${roundHours(hoursReturned)}h put back on the client's prepaid hours - "${s.title}" ${opts.reason}`,
    entityType: "session",
    entityId: s._id,
    accent: "neutral",
  });
  return { hoursReturned: roundHours(hoursReturned), valueCents };
}

/**
 * Staff refund a session paid with prepaid hours: the hours go back on the
 * client's block. Finance role (invoices.send). Not plan-gated. A second call
 * finds nothing to return and changes nothing.
 */
export const returnHours = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) throw new ConvexError("Session not found.");
    return returnHoursForSession(ctx, session, { reason: "refunded", byName: await currentActor(ctx) });
  },
});

/** Value of prepaid hours taken off on COMPLETION for a session. The rate is
 *  cut by this much, so the session's full price is rateCents + this (used for
 *  an engineer's percentage pay and the client's lifetime value). Hours applied
 *  by hand ("Apply", kind "manual") are left out on purpose: before prepaid
 *  draw-down existed those sessions paid the engineer on the reduced rate, and
 *  changing that would change wages without a setting. */
export async function prepaidValueForSession(ctx: MutationCtx, sessionId: Id<"sessions">): Promise<number> {
  const rows = await ctx.db
    .query("packageDrawdowns")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  return rows
    .filter((r) => r.status === "applied" && r.kind === "completion")
    .reduce((sum, r) => sum + r.valueCents, 0);
}
