/* Shared branded email layout for STUDIO -> CLIENT mail (booking
   confirmations, reminders, invoice chases, client comms). Tenant-correct:
   the header carries the STUDIO's name (white-label), Pulse appears only in
   the quiet "Sent with Pulse" footer. Light card = reliable rendering in
   every client; gold accents match the brand. Email-safe tables + inline
   styles only. */

const GOLD = "#fdb913";

/** Guard the injected colour: it lands inside a style attribute, so anything
 *  that is not a plain hex is refused rather than escaped. */
function isHex(v: string | undefined): boolean {
  return typeof v === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}
const GOLD_INK = "#241900";
const HEADER = "#0d0d10";
const PAGE = "#f1f1f3";
const CARD = "#ffffff";
const CARD_BORDER = "#e7e7ea";
const TEXT = "#1a1a1f";
const FAINT = "#8a8a92";

export function escapeEmailHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Escaped text -> paragraphs with clickable links. Runs AFTER escaping so
 *  only genuine URLs become anchors (e.g. invoice payment links). */
export function textToEmailHtml(text: string): string {
  const escaped = escapeEmailHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)/g,
    (url) => `<a href="${url.replace(/&amp;/g, "&")}" style="color:#b8860b;">${url}</a>`,
  );
  return linked
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">${para
          .split("\n")
          .map((l) => l.trim())
          .join("<br/>")}</p>`,
    )
    .join("");
}

/** The studio-framed wrapper. Pass bodyHtml (already safe) OR bodyText
 *  (escaped + linkified here). Optional gold CTA button. */
export function studioEmailHtml(args: {
  studioName: string;
  bodyText?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /* White label. A studio's client mail should wear the studio's colour, not
     Pulse gold. Both fall back to the Pulse defaults, so every existing caller
     keeps working untouched. */
  accent?: string;
  accentInk?: string;
  footerText?: string;
}): string {
  const studio = escapeEmailHtml(args.studioName);
  const ACCENT = isHex(args.accent) ? args.accent! : GOLD;
  const ACCENT_INK = isHex(args.accentInk) ? args.accentInk! : GOLD_INK;
  const content = args.bodyHtml ?? textToEmailHtml(args.bodyText ?? "");
  const cta =
    args.ctaLabel && args.ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px auto 4px auto;"><tr><td align="center" style="background-color:${ACCENT};border-radius:11px;">
<a href="${escapeEmailHtml(args.ctaUrl)}" style="display:inline-block;padding:12px 30px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;color:${ACCENT_INK};text-decoration:none;">${escapeEmailHtml(args.ctaLabel)}</a>
</td></tr></table>`
      : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${PAGE};font-family:Inter,Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD};border-radius:14px;overflow:hidden;border:1px solid ${CARD_BORDER};">
<tr><td align="center" style="background:${HEADER};border-bottom:3px solid ${ACCENT};padding:22px 40px;">
<span style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:17px;font-weight:800;color:#ffffff;letter-spacing:0.02em;">${studio}</span>
</td></tr>
<tr><td style="padding:30px 36px 22px 36px;">
${content}
${cta}
</td></tr>
<tr><td align="center" style="padding:14px 36px 22px 36px;border-top:1px solid ${CARD_BORDER};">
${
  args.footerText
    ? `<p style="margin:0 0 6px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.6;color:${FAINT};">${escapeEmailHtml(args.footerText)}</p>`
    : ""
}<p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.6;color:${FAINT};">Sent with <span style="color:#b8860b;font-weight:700;">Pulse</span> &middot; the studio operating system</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}


/** Black or white, whichever is readable on an accent. A CTA button nobody
 *  can read is the classic white-label email failure. */
export function readableEmailInk(hex: string | undefined): string {
  if (!isHex(hex)) return GOLD_INK;
  let h = hex!.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return lum > 0.45 ? "#1a1a1f" : "#ffffff";
}
