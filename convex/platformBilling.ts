import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendEmail } from "./lib/email";
import { formatUsd } from "./lib/pricing";
import {
  paymentFailedHtml,
  paymentFailedSubject,
  paymentActionRequiredHtml,
  paymentActionRequiredSubject,
} from "./lib/emailTemplates/billingEmails";

/* Owner email for the platform subscription (Core / Growth / Max). Scheduled
   by billingWebhooks on invoice.payment_failed and
   invoice.payment_action_required. */

function appBase(): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://studiopulse.tech";
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
}

export const _ownerForCustomer = internalQuery({
  args: { customerId: v.string() },
  handler: async (ctx, { customerId }) => {
    const ag = await ctx.db
      .query("agencies")
      .filter((q) => q.eq(q.field("stripeCustomerId"), customerId))
      .first();
    if (!ag?.ownerEmail) return null;
    return { email: ag.ownerEmail, name: ag.name };
  },
});

export const notifyPaymentFailed = internalAction({
  args: { customerId: v.string(), amountCents: v.optional(v.number()), nextAttemptMs: v.optional(v.number()) },
  handler: async (ctx, { customerId, amountCents, nextAttemptMs }): Promise<{ status: string }> => {
    const owner = await ctx.runQuery(internal.platformBilling._ownerForCustomer, { customerId });
    if (!owner) return { status: "no_target" };
    const status = await sendEmail({
      to: owner.email,
      subject: paymentFailedSubject(owner.name, nextAttemptMs === undefined),
      html: paymentFailedHtml({
        name: owner.name,
        amountLabel: amountCents ? formatUsd(amountCents) : undefined,
        nextAttemptLabel: nextAttemptMs !== undefined ? dateLabel(nextAttemptMs) : undefined,
        manageUrl: `${appBase()}/agency/settings#billing`,
      }),
      audience: "client",
    });
    console.log(`[platformBilling] payment_failed email ${status}`);
    return { status };
  },
});

export const notifyActionRequired = internalAction({
  args: { customerId: v.string(), amountCents: v.optional(v.number()), confirmUrl: v.string() },
  handler: async (ctx, { customerId, amountCents, confirmUrl }): Promise<{ status: string }> => {
    const owner = await ctx.runQuery(internal.platformBilling._ownerForCustomer, { customerId });
    if (!owner) return { status: "no_target" };
    const status = await sendEmail({
      to: owner.email,
      subject: paymentActionRequiredSubject(owner.name),
      html: paymentActionRequiredHtml({
        name: owner.name,
        amountLabel: amountCents ? formatUsd(amountCents) : undefined,
        confirmUrl,
      }),
      audience: "client",
    });
    console.log(`[platformBilling] action_required email ${status}`);
    return { status };
  },
});
