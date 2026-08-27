import { escapeEmailHtml } from "./layout";

/* The early-access invite.

   Dark, gold-accented, and short. It has one job: get a named person to open
   one link. Email-safe tables and inline styles only, because half of these
   will open in Outlook.

   The code is printed as well as linked. A link that dies in a corporate mail
   scanner still leaves the recipient something they can type. */

const GOLD = "#fdb913";
const GOLD_INK = "#241900";
const INK = "#0d0d10";
const CARD = "#16161a";
const TEXT = "#f2efe9";
const FAINT = "#8b857a";
const HAIR = "#2a2a30";

export function betaInviteSubject(studioName?: string): string {
  return studioName
    ? `${studioName}, here is your early look at Pulse`
    : "Your early look at Pulse";
}

export function betaInviteHtml(args: {
  recipientName?: string;
  accessUrl: string;
  code: string;
  fromName?: string;
  expiresLabel?: string | null;
  /** Convex HTTP origin, for the open pixel. Omit it and no pixel is added. */
  trackingOrigin?: string | null;
}): string {
  const hello = args.recipientName
    ? `Hi ${escapeEmailHtml(args.recipientName)},`
    : "Hi,";
  const from = escapeEmailHtml(args.fromName ?? "Lawrence at Myind Sound");
  const url = args.accessUrl;
  const code = escapeEmailHtml(args.code);

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${CARD};border:1px solid ${HAIR};border-radius:14px;overflow:hidden;">

      <tr><td style="padding:26px 28px 0 28px;">
        <p style="margin:0;font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${GOLD};">Pulse</p>
        <p style="margin:4px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${FAINT};">Early access</p>
      </td></tr>

      <tr><td style="padding:20px 28px 0 28px;">
        <h1 style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:24px;line-height:1.25;font-weight:700;color:${TEXT};">
          You are on the early list for Pulse
        </h1>
      </td></tr>

      <tr><td style="padding:14px 28px 0 28px;">
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">${hello}</p>
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">
          Pulse is the studio operating system we have been building: the booking page, the deposits, the no-show protection, the invoices that chase themselves. It is not public yet.
        </p>
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">
          This link opens the full feature list, everything shipped and everything coming. You will be asked to sign a short confidentiality agreement first, because none of it is announced.
        </p>
      </td></tr>

      <tr><td align="center" style="padding:8px 28px 4px 28px;">
        <a href="${url}" style="display:inline-block;background:${GOLD};color:${GOLD_INK};font-family:Inter,Segoe UI,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;padding:13px 30px;border-radius:9999px;">
          Open the preview
        </a>
      </td></tr>

      <tr><td style="padding:18px 28px 0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${HAIR};border-radius:9px;background:#101014;">
          <tr><td style="padding:12px 14px;">
            <p style="margin:0 0 4px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${FAINT};">Your access code</p>
            <p style="margin:0;font-family:'Courier New',monospace;font-size:19px;letter-spacing:3px;color:${GOLD};">${code}</p>
          </td></tr>
        </table>
        <p style="margin:10px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:12px;line-height:1.6;color:${FAINT};">
          This code is yours. Please do not pass it on${args.expiresLabel ? `. It stops working after ${escapeEmailHtml(args.expiresLabel)}` : ""}.
        </p>
      </td></tr>

      <tr><td style="padding:20px 28px 0 28px;">
        <p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">
          If it looks useful, reply and tell me what is missing. That is genuinely why you are getting it first.
        </p>
        <p style="margin:12px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">${from}</p>
      </td></tr>

      <tr><td style="padding:22px 28px 24px 28px;">
        <div style="border-top:1px solid ${HAIR};padding-top:14px;">
          <p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.6;color:#5f5a52;">
            If the button does not work, paste this into your browser:<br/>
            <span style="color:${FAINT};word-break:break-all;">${url}</span>
          </p>
          <p style="margin:10px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;color:#5f5a52;">
            Pulse by ThaMyind &middot; studiopulse.tech
          </p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
${
  args.trackingOrigin
    ? `<img src="${args.trackingOrigin}/beta/open.gif?c=${encodeURIComponent(args.code)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`
    : ""
}
</body></html>`;
}
