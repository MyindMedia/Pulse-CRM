import { brandEmail } from "../emailLayout";
import { escapeEmailHtml } from "./layout";
import { TRIAL_TERMS } from "../pricing";

/* Trial mail, in the Pulse client layout (brandEmail).

   Two messages:
   - trialWillEnd: Stripe's customer.subscription.trial_will_end, three days
     before the card saved at checkout is charged. Says the date, the amount
     when we know it, and how to cancel before then.
   - trialCardRequired: for a trial that started before the card rule. The
     trial keeps running; a card is needed before it ends.

   Copy rules: no em dashes, American spelling, plain words. */

const GOLD = "#fdb913";
const GOLD_INK = "#241900";

function button(href: string, label: string): string {
  return `<p style="margin:24px 0 8px 0;text-align:center;">
<a href="${escapeEmailHtml(href)}" style="display:inline-block;background:${GOLD};color:${GOLD_INK};font-weight:700;font-size:15px;text-decoration:none;padding:13px 30px;border-radius:9999px;">${escapeEmailHtml(label)}</a>
</p>
<p style="margin:12px 0 0 0;font-size:12px;line-height:1.6;color:#6e6e76;">If the button does not work, paste this into your browser:<br><span style="word-break:break-all;">${escapeEmailHtml(href)}</span></p>`;
}

function hello(ownerName?: string): string {
  return ownerName ? `Hi ${escapeEmailHtml(ownerName)},` : "Hi,";
}

export function trialWillEndSubject(studioName: string): string {
  return `${studioName}: your Pulse trial ends in 3 days`;
}

export function trialWillEndHtml(args: {
  ownerName?: string;
  studioName: string;
  endsOnLabel: string;
  /** e.g. "$149/month". Omitted when the amount is not known here. */
  priceLabel?: string;
  manageUrl: string;
}): string {
  const studio = escapeEmailHtml(args.studioName);
  const charge = args.priceLabel
    ? `On ${escapeEmailHtml(args.endsOnLabel)} the card you saved will be charged ${escapeEmailHtml(args.priceLabel)}, and the plan renews on its normal schedule after that.`
    : `On ${escapeEmailHtml(args.endsOnLabel)} the card you saved will be charged, and the plan renews on its normal schedule after that.`;
  const body = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;">Your trial for ${studio} ends in 3 days</h1>
<p style="margin:0 0 14px 0;">${hello(args.ownerName)}</p>
<p style="margin:0 0 14px 0;">${charge} There is nothing you need to do to keep going.</p>
<p style="margin:0 0 14px 0;">${escapeEmailHtml(TRIAL_TERMS.cancel)} Everything you set up stays where it is either way.</p>
${button(args.manageUrl, "Review your plan")}`;
  return brandEmail({
    title: trialWillEndSubject(args.studioName),
    preheader: `Your card is charged on ${args.endsOnLabel}. Cancel before then if you do not want to continue.`,
    bodyHtml: body,
  });
}

export function trialCardRequiredSubject(studioName: string): string {
  return `${studioName}: add a card before your Pulse trial ends`;
}

export function trialCardRequiredHtml(args: {
  ownerName?: string;
  studioName: string;
  endsOnLabel: string;
  addCardUrl: string;
}): string {
  const studio = escapeEmailHtml(args.studioName);
  const body = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;">Add a card to keep ${studio} running</h1>
<p style="margin:0 0 14px 0;">${hello(args.ownerName)}</p>
<p style="margin:0 0 14px 0;">Your free trial keeps running until ${escapeEmailHtml(args.endsOnLabel)}. To carry on after that, add a card before the trial ends. You are not charged until ${escapeEmailHtml(args.endsOnLabel)}.</p>
<p style="margin:0 0 14px 0;">${escapeEmailHtml(TRIAL_TERMS.autoRenew)} ${escapeEmailHtml(TRIAL_TERMS.cancel)}</p>
<p style="margin:0 0 14px 0;">Your bookings, clients and settings stay exactly where they are.</p>
${button(args.addCardUrl, "Add a card")}`;
  return brandEmail({
    title: trialCardRequiredSubject(args.studioName),
    preheader: `Add a card before ${args.endsOnLabel} to keep your studio running.`,
    bodyHtml: body,
  });
}

/* For a studio the old "add a card" flow left on a paid plan with a card saved
   but no subscription behind it: nothing has ever charged that card. We ask
   them to confirm the plan; confirming opens Stripe Checkout and charges then.
   Nothing is charged by this email. */

export function planConfirmSubject(studioName: string): string {
  return `${studioName}: please confirm your Pulse plan`;
}

export function planConfirmHtml(args: {
  ownerName?: string;
  studioName: string;
  planName: string;
  /** e.g. "$99/month". Omitted when the amount is not known here. */
  priceLabel?: string;
  interval: "month" | "year";
  confirmUrl: string;
}): string {
  const studio = escapeEmailHtml(args.studioName);
  const plan = escapeEmailHtml(args.planName);
  const price = args.priceLabel ? ` at ${escapeEmailHtml(args.priceLabel)}` : "";
  const body = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;">Confirm your plan for ${studio}</h1>
<p style="margin:0 0 14px 0;">${hello(args.ownerName)}</p>
<p style="margin:0 0 14px 0;">${studio} is on the ${plan} plan${price}. A card was saved for it, but billing for the plan was never switched on, so that card has not been charged.</p>
<p style="margin:0 0 14px 0;">Please confirm the plan to keep everything running. When you confirm, your card is charged for the first ${args.interval} and the plan renews automatically after that. You can update your card or cancel any time from the billing page.</p>
<p style="margin:0 0 14px 0;">We will not charge anything until you confirm. Your bookings, clients and settings stay exactly where they are.</p>
${button(args.confirmUrl, "Confirm my plan")}`;
  return brandEmail({
    title: planConfirmSubject(args.studioName),
    preheader: `Confirm the ${args.planName} plan to keep ${args.studioName} running. Nothing is charged until you do.`,
    bodyHtml: body,
  });
}
