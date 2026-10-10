import { brandEmail } from "../emailLayout";
import { escapeEmailHtml } from "./layout";

/* Platform billing mail (Core / Growth / Max), in the Pulse client layout.

   - paymentFailed: invoice.payment_failed. First attempt and last attempt only.
   - paymentActionRequired: invoice.payment_action_required. The bank wants the
     card holder to confirm the charge (3D Secure) on Stripe's hosted page.

   Copy rules: no em dashes, American spelling, plain words. */

const GOLD = "#fdb913";
const GOLD_INK = "#241900";

function button(href: string, label: string): string {
  return `<p style="margin:24px 0 8px 0;text-align:center;">
<a href="${escapeEmailHtml(href)}" style="display:inline-block;background:${GOLD};color:${GOLD_INK};font-weight:700;font-size:15px;text-decoration:none;padding:13px 30px;border-radius:9999px;">${escapeEmailHtml(label)}</a>
</p>
<p style="margin:12px 0 0 0;font-size:12px;line-height:1.6;color:#6e6e76;">If the button does not work, paste this into your browser:<br><span style="word-break:break-all;">${escapeEmailHtml(href)}</span></p>`;
}

export function paymentFailedSubject(name: string, final: boolean): string {
  return final ? `${name}: last try to charge your card for Pulse failed` : `${name}: your card for Pulse did not go through`;
}

export function paymentFailedHtml(args: {
  name: string;
  amountLabel?: string;
  /** Next retry date, or undefined when Stripe will not retry again. */
  nextAttemptLabel?: string;
  manageUrl: string;
}): string {
  const name = escapeEmailHtml(args.name);
  const amount = args.amountLabel ? ` of ${escapeEmailHtml(args.amountLabel)}` : "";
  const next = args.nextAttemptLabel
    ? `We will try the card again on ${escapeEmailHtml(args.nextAttemptLabel)}. Your studios keep running in the meantime.`
    : "This was the last automatic try. If the plan is not paid, the subscription ends and your studios are paused. Your data stays put, and paying turns everything back on.";
  const body = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;">Your Pulse payment did not go through</h1>
<p style="margin:0 0 14px 0;">Hi,</p>
<p style="margin:0 0 14px 0;">The payment${amount} for ${name} was declined by your bank.</p>
<p style="margin:0 0 14px 0;">${next}</p>
<p style="margin:0 0 14px 0;">To fix it, update the card in your billing portal.</p>
${button(args.manageUrl, "Update your card")}`;
  return brandEmail({
    title: paymentFailedSubject(args.name, !args.nextAttemptLabel),
    preheader: "Update your card to keep your Pulse plan running.",
    bodyHtml: body,
  });
}

export function paymentActionRequiredSubject(name: string): string {
  return `${name}: confirm your Pulse payment with your bank`;
}

export function paymentActionRequiredHtml(args: { name: string; amountLabel?: string; confirmUrl: string }): string {
  const name = escapeEmailHtml(args.name);
  const amount = args.amountLabel ? ` of ${escapeEmailHtml(args.amountLabel)}` : "";
  const body = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;">Your bank needs you to confirm a payment</h1>
<p style="margin:0 0 14px 0;">Hi,</p>
<p style="margin:0 0 14px 0;">Your bank asked for a quick confirmation before it approves the Pulse payment${amount} for ${name}. It takes a minute on Stripe's secure page.</p>
<p style="margin:0 0 14px 0;">Until it is confirmed, the payment stays open.</p>
${button(args.confirmUrl, "Confirm the payment")}`;
  return brandEmail({
    title: paymentActionRequiredSubject(args.name),
    preheader: "Your bank wants you to confirm the Pulse payment.",
    bodyHtml: body,
  });
}
