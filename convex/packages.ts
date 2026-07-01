import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  MutationCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { currentOrg, currentOrgWithCapability } from "./lib/tenant";
import { requireCapability } from "./lib/access";
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
          artistName: artist?.name ?? "Unknown client",
          hoursTotal: c.hoursTotal,
          hoursRemaining: c.hoursRemaining,
          priceCents: c.priceCents,
          status: c.status,
          purchasedAt: c.purchasedAt,
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
        // Per-hour value the studio credits back when hours are applied.
        perHourCents: c.hoursTotal > 0 ? Math.round(c.priceCents / c.hoursTotal) : 0,
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
    const product = await ctx.db.get(productId);
    if (!product || product.orgId !== orgId || !product.active) return null;
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      orgId,
      slug: org?.slug ?? "",
      productName: product.name,
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

    const back = `${appUrl()}/packages`;
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
        success_url: `${back}?package=paid`,
        cancel_url: `${back}?package=cancelled`,
        metadata: { kind: "package", productId, artistId, orgId: c.orgId },
      },
      { stripeAccount: c.stripeAccountId }, // charge on the studio's own account
    );
    return { url: checkout.url ?? null };
  },
});

/**
 * Create a packageCredit from a completed purchase. Plain helper (imported by
 * billingWebhooks) so the credit-creation path is shared and testable. The
 * webhook's event-id guard provides idempotency; this never double-charges the
 * ledger by itself, but callers should gate on the event ledger.
 */
export async function applyPackagePurchase(
  ctx: MutationCtx,
  args: {
    orgId: string;
    productId: Id<"packageProducts">;
    artistId: Id<"artists">;
    stripeReference?: string;
  },
): Promise<Id<"packageCredits"> | null> {
  const product = await ctx.db.get(args.productId);
  if (!product || product.orgId !== args.orgId) return null;
  const artist = await ctx.db.get(args.artistId);
  if (!artist || artist.orgId !== args.orgId) return null;

  const creditId = await ctx.db.insert("packageCredits", {
    orgId: args.orgId,
    artistId: args.artistId,
    productId: args.productId,
    name: product.name,
    hoursTotal: product.hours,
    hoursRemaining: product.hours,
    priceCents: product.priceCents,
    status: "active",
    purchasedAt: Date.now(),
    stripeReference: args.stripeReference,
  });
  await ctx.db.insert("activity", {
    orgId: args.orgId,
    kind: "package.purchased",
    summary: `${artist.name} bought "${product.name}" - ${product.hours}h for ${money(product.priceCents)}`,
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
