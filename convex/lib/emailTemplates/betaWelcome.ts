import { escapeEmailHtml } from "./layout";

/* "Your studio is now a beta account" - sent to an EXISTING studio owner.

   Deliberately not the invite email: they already have an account and a
   password. This one has a single job, which is to get them back to the setup
   they never finished. So it links straight to /welcome and says what changed. */

const GOLD = "#fdb913";
const GOLD_INK = "#241900";
const INK = "#0d0d10";
const CARD = "#16161a";
const TEXT = "#f2efe9";
const FAINT = "#8b857a";
const HAIR = "#2a2a30";

export function betaWelcomeSubject(studioName: string): string {
  return `${studioName} is on the Pulse beta - a year on us`;
}

export function betaWelcomeHtml(args: {
  ownerName?: string;
  studioName: string;
  welcomeUrl: string;
  untilLabel: string;
}): string {
  const hello = args.ownerName ? `Hi ${escapeEmailHtml(args.ownerName)},` : "Hi,";
  const studio = escapeEmailHtml(args.studioName);
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
          ${studio} is on the beta, free for a year
        </h1>
      </td></tr>

      <tr><td style="padding:14px 28px 0 28px;">
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">${hello}</p>
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">
          Your account is now a beta account. Everything is unlocked and there is nothing to pay until ${escapeEmailHtml(args.untilLabel)}.
        </p>
        <p style="margin:0 0 14px 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${FAINT};">
          Use the same login you already have. The link below picks up your setup where you left it - your studio, rooms and booking page are all still there, so there is nothing to re-enter.
        </p>
      </td></tr>

      <tr><td align="center" style="padding:8px 28px 4px 28px;">
        <a href="${args.welcomeUrl}" style="display:inline-block;background:${GOLD};color:${GOLD_INK};font-family:Inter,Segoe UI,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;padding:13px 30px;border-radius:9999px;">
          Finish setting up
        </a>
      </td></tr>

      <tr><td style="padding:20px 28px 0 28px;">
        <p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.65;color:${TEXT};">
          You are one of a handful of studios on this. If something is missing or wrong, reply and tell me. That is the whole reason you are early.
        </p>
      </td></tr>

      <tr><td style="padding:22px 28px 24px 28px;">
        <div style="border-top:1px solid ${HAIR};padding-top:14px;">
          <p style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.6;color:#5f5a52;">
            If the button does not work, paste this into your browser:<br/>
            <span style="color:${FAINT};word-break:break-all;">${args.welcomeUrl}</span>
          </p>
          <p style="margin:10px 0 0 0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;color:#5f5a52;">
            Pulse by Myind Sound &middot; studiopulse.tech
          </p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
