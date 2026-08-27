import { escapeEmailHtml } from "./layout";
import {
  PLAN_LIMITS, SELLABLE_TIERS, ANNUAL_DISCOUNT_PCT, annualPerMonthCents,
} from "../plans";

/* "Your beta year is nearly up" - sent at 30, 7 and 1 days out.

   The end of the beta is a lock screen. Nobody should meet that cold, so
   this exists to make the last month boring: here is the date, here is what
   it costs, here is the button, and your work is not going anywhere. The
   reassurance is not padding - the first fear on reading "your free access
   ends" is that the data ends with it. */

const GOLD = "#fdb913";
const GOLD_INK = "#241900";
const INK = "#0d0d10";
const CARD = "#16161a";
const TEXT = "#f2efe9";
const FAINT = "#8b857a";
const HAIR = "#2a2a30";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

export function betaEndingSubject(studioName: string, daysLeft: number): string {
  if (daysLeft <= 1) return `${studioName}: your Pulse beta ends tomorrow`;
  return `${studioName}: ${daysLeft} days left on your Pulse beta`;
}

export function betaEndingHtml(args: {
  ownerName?: string;
  studioName: string;
  daysLeft: number;
  endsOnLabel: string;
  chooseUrl: string;
}): string {
  const hello = args.ownerName ? `Hi ${escapeEmailHtml(args.ownerName)},` : "Hi,";
  const studio = escapeEmailHtml(args.studioName);
  const urgent = args.daysLeft <= 7;
  const headline =
    args.daysLeft <= 1
      ? `${studio}: your beta ends tomorrow`
      : `${studio}: ${args.daysLeft} days left on your beta`;

  const rows = SELLABLE_TIERS.map((t) => {
    const p = PLAN_LIMITS[t];
    return `<tr>
      <td style="padding:9px 0;border-bottom:1px solid ${HAIR};font-family:Inter,Segoe UI,Arial,sans-serif;font-size:13px;color:${TEXT};">
        ${escapeEmailHtml(p.label)}
      </td>
      <td align="right" style="padding:9px 0;border-bottom:1px solid ${HAIR};font-family:Inter,Segoe UI,Arial,sans-serif;font-size:13px;color:${FAINT};">
        ${money(p.priceCents)}/mo &middot; ${money(annualPerMonthCents(t))}/mo yearly
      </td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${CARD};border:1px solid ${HAIR};border-radius:14px;overflow:hidden;">

      <tr><td style="padding:26px 28px 0 28px;">
        <p style="margin:0;font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${GOLD};">Pulse</p>
        <p style="margin:4px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${FAINT};">Beta programme</p>
      </td></tr>

      <tr><td style="padding:20px 28px 0 28px;">
        <h1 style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:24px;line-height:1.25;font-weight:700;color:${TEXT};">
          ${headline}
        </h1>
      </td></tr>

      <tr><td style="padding:14px 28px 0 28px;">
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">${hello}</p>
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">
          Your free year on Pulse runs out on ${escapeEmailHtml(args.endsOnLabel)}. Pick a plan before then and nothing changes: no interruption, no re-setup, no lost work.
        </p>
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">
          Your studio, your bookings, your clients and your numbers all stay exactly where they are. This is a payment step, not a migration.
        </p>
      </td></tr>

      <tr><td style="padding:4px 28px 0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        <p style="margin:10px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:12px;color:${FAINT};">
          Yearly saves ${ANNUAL_DISCOUNT_PCT}%.
        </p>
      </td></tr>

      <tr><td align="center" style="padding:18px 28px 4px 28px;">
        <a href="${args.chooseUrl}" style="display:inline-block;background:${GOLD};color:${GOLD_INK};font-family:Inter,Segoe UI,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;padding:13px 30px;border-radius:9999px;">
          ${urgent ? "Choose your plan now" : "Choose your plan"}
        </a>
      </td></tr>

      <tr><td style="padding:20px 28px 0 28px;">
        <p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">
          If the price is the problem, reply and say so. You were early, and that counts for something.
        </p>
      </td></tr>

      <tr><td style="padding:22px 28px 24px 28px;">
        <div style="border-top:1px solid ${HAIR};padding-top:14px;">
          <p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.6;color:#5f5a52;">
            If the button does not work, paste this into your browser:<br/>
            <span style="color:${FAINT};word-break:break-all;">${args.chooseUrl}</span>
          </p>
          <p style="margin:10px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;color:#5f5a52;">
            Pulse by ThaMyind &middot; studiopulse.tech
          </p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
