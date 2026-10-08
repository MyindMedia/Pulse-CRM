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
