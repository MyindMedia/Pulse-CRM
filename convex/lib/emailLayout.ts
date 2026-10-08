/* The one Pulse layout for CLIENT-FACING mail (invites, billing, beta access,
   client messages, anything a studio, member, prospect or customer receives).

   Table-based, inline-styled, 600px. Survives Gmail, Apple Mail and Outlook.
   Colours are explicit on every cell (with bgcolor attributes for Outlook) and
   the message declares a light-only colour scheme, so a dark-mode client does
   not invert the header or footer into something unreadable.

   Internal mail (team alerts, ops notices) does NOT use this layout. See the
   `audience` option in ./email.ts.

   Copy rule: no em dashes in anything this file emits. */

import { stripEmDashes } from "./text";

export const PULSE_BRAND = {
  name: "Pulse",
  tagline: "Pulse, the studio operating system",
  address: "835 Wilshire Blvd, Ste 500 #519, Los Angeles, CA 90017",
  siteHost: "studiopulse.tech",
  siteUrl: "https://studiopulse.tech",
  /* Existing asset in public/, gold mark on transparent. Verified 200 on
     studiopulse.tech. Absolute https only, never a relative or APP_URL-derived
     path, so a preview deploy cannot ship a broken logo. */
  logoUrl: "https://studiopulse.tech/pulse-logo-main.png",
  logoWidth: 160,
  logoHeight: 48,
} as const;

/** Marker for mail that already carries a full Pulse frame. sendEmail leaves it
 *  alone, so nothing is wrapped twice. */
export const BRANDED_META = '<meta name="pulse-branded" content="1">';
/** Marker for studio-framed (white-label) client mail. It is client-facing but
 *  deliberately wears the studio's name and colours, so it is never re-framed
 *  in Pulse chrome. */
export const TENANT_LAYOUT_META = '<meta name="pulse-tenant-layout" content="1">';

const PAGE = "#f1f1f3";
const CARD = "#ffffff";
const HEADER = "#0d0d10";
const GOLD = "#fdb913";
const TEXT = "#1a1a1f";
const FAINT = "#6e6e76";
const RULE = "#e7e7ea";
const FONT = "Inter,'Segoe UI',Arial,Helvetica,sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True when the HTML already has a Pulse frame or a studio-framed layout. */
export function isBrandedHtml(html: string): boolean {
  return /name=["']pulse-(branded|tenant-layout)["']/i.test(html);
}

/** Reduce a full HTML document to the markup inside <body>, so it can sit
 *  inside the Pulse frame. Fragments pass through unchanged. */
export function extractBodyFragment(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const inner = body ? body[1] : html;
  return inner
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .trim();
}

export function brandEmail(args: {
  /** Used for the <title> element, which some clients show as the preview. */
  title: string;
  /** Already-safe HTML for the message body. Escape untrusted text first. */
  bodyHtml: string;
  /** Hidden inbox preview line. */
  preheader?: string;
  /** Optional extra footer line (plain text, escaped here). */
  footerNote?: string;
}): string {
  const { name, tagline, address, siteHost, siteUrl, logoUrl, logoWidth, logoHeight } = PULSE_BRAND;
  const preheader = args.preheader
    ? `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE};">${esc(args.preheader)}</div>`
    : "";
  const note = args.footerNote
    ? `<p style="margin:10px 0 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};">${esc(args.footerNote)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
${BRANDED_META}
<title>${esc(args.title)}</title>
</head>
<body bgcolor="${PAGE}" style="margin:0;padding:0;background:${PAGE};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="width:100%;max-width:600px;background:${CARD};border:1px solid ${RULE};border-radius:14px;">
<tr><td align="center" bgcolor="${HEADER}" style="background:${HEADER};border-bottom:3px solid ${GOLD};border-radius:14px 14px 0 0;padding:26px 32px;">
<a href="${siteUrl}" style="text-decoration:none;"><img src="${logoUrl}" width="${logoWidth}" height="${logoHeight}" alt="${name}" style="display:block;margin:0 auto;width:${logoWidth}px;height:${logoHeight}px;border:0;outline:none;text-decoration:none;"></a>
</td></tr>
<tr><td style="padding:32px 36px 28px 36px;font-family:${FONT};font-size:15px;line-height:1.65;color:${TEXT};">
${args.bodyHtml}
</td></tr>
<tr><td align="center" bgcolor="${PAGE}" style="background:${PAGE};border-top:1px solid ${RULE};border-radius:0 0 14px 14px;padding:22px 36px;">
<p style="margin:0;font-family:${FONT};font-size:13px;font-weight:700;line-height:1.5;color:${TEXT};">${esc(tagline)}</p>
<p style="margin:6px 0 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};">${esc(address)}</p>
<p style="margin:2px 0 0 0;font-family:${FONT};font-size:12px;line-height:1.6;"><a href="${siteUrl}" style="color:#8a6400;text-decoration:underline;">${siteHost}</a></p>
${note}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Wrap a client-facing HTML body in the Pulse layout, unless it already carries
 *  a Pulse or studio frame. Used by sendEmail; exported for tests and previews. */
export function ensureBranded(html: string, title: string): string {
  if (isBrandedHtml(html)) return html;
  return brandEmail({ title: stripEmDashes(title), bodyHtml: extractBodyFragment(html) });
}
