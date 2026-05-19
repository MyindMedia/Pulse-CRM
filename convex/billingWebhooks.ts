import { internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { tierForPriceId } from "./lib/stripe";

/* ============================================================
   Stripe webhook handlers. Idempotent via auditEvents-keyed
   event ledger (one row per event.id with action="stripe.event").
   Each handler patches Convex state and returns early.
   ============================================================ */

const eventV = v.object({
  id: v.string(),
  type: v.string(),
  data: v.any(),
});

async function alreadyProcessed(ctx: MutationCtx, eventId: string): Promise<boolean> {
  const existing = await ctx.db
    .query("auditEvents")
    .filter((q) =>
      q.and(
        q.eq(q.field("action"), "stripe.event"),
        q.eq(q.field("viewerId"), eventId),
      ),
    )
    .first();
  return Boolean(existing);
}

async function markProcessed(ctx: MutationCtx, eventId: string, eventType: string) {
  await ctx.db.insert("auditEvents", {
    viewerType: "guest",
    viewerId: eventId,
    action: "stripe.event",
    result: "allow",
    reason: eventType,
  });
}

export const handle = internalMutation({
  args: { event: eventV },
  handler: async (ctx, { event }) => {
    if (await alreadyProcessed(ctx, event.id)) return { duplicate: true };
    const e = event as { id: string; type: string; data: { object: Record<string, unknown> } };
    const obj = e.data.object;

    if (e.type === "checkout.session.completed") {
      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      const meta = (obj.metadata as Record<string, string>) ?? {};
      const intendedTier = (meta.intendedTier as "studio" | "pro" | "agency") ?? "studio";
      const clerkUserId = meta.clerkUserId as string;
      const agencyName = (meta.intendedAgencyName as string) || "My Agency";
      const ownerEmail = (obj.customer_email as string) ?? "";

      if (intendedTier !== "studio") {
        const slug =
          agencyName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") ||
          `ag-${Date.now()}`;
        const agencyId = `agency_${slug}_${Date.now().toString(36)}`;
        await ctx.db.insert("agencies", {
          agencyId,
          name: agencyName,
          slug,
          plan: intendedTier,
          status: "trial",
          ownerClerkUserId: clerkUserId,
          ownerEmail,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        });
        await ctx.db.insert("agencyMembers", {
          agencyId,
          clerkUserId,
          email: ownerEmail,
          name: ownerEmail,
          role: "owner",
          status: "active",
          invitedAt: Date.now(),
        });
      }
    }

    if (e.type === "customer.subscription.updated") {
      const stripeCustomerId = obj.customer as string;
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? [];
      const priceId = items[0]?.price?.id;
      const tier = priceId ? tierForPriceId(priceId) : null;
      const ag = await ctx.db
        .query("agencies")
        .filter((q) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
        .first();
      if (ag && tier && (tier === "pro" || tier === "agency")) {
        await ctx.db.patch(ag._id, {
          plan: tier,
          status: obj.status === "active" ? "active" : "trial",
        });
      }
    }

    if (e.type === "customer.subscription.deleted") {
      const stripeCustomerId = obj.customer as string;
      const ag = await ctx.db
        .query("agencies")
        .filter((q) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
        .first();
      if (ag) {
        await ctx.db.patch(ag._id, { status: "paused" });
        const subs = await ctx.db
          .query("orgs")
          .withIndex("by_agency", (q) => q.eq("agencyId", ag.agencyId))
          .collect();
        for (const s of subs) {
          if (s.status !== "paused") await ctx.db.patch(s._id, { status: "paused" });
        }
      }
    }

    await markProcessed(ctx, event.id, e.type);
    return { duplicate: false };
  },
});
