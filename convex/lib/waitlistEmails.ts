/* ============================================================
   Waitlist nurture content - the 3-email sequence sent to Pulse's
   own owned-channel marketing list (the `subscribers` table).

   Cadence: Day 0 (welcome), Day 2 (the problem/story), Day 5 (the ask).
   The human-readable source of this copy lives at repo-root
   WAITLIST_EMAILS.md; keep the two in sync when the copy changes.

   Rendering goes through renderWaitlistEmail(); the shared shell keeps
   inline styles (email clients strip <style>) and a light background for
   deliverability, with the obsidian/gold brand as accents. All outbound
   copy is em-dash-stripped again at the send point (convex/lib/email.ts).
   ============================================================ */
import { escapeHtml } from "./text";

const DAY = 86_400_000;

export type WaitlistStep = "day0" | "day2" | "day5";

/** The steps in send order. The nurture sweep relies on this ordering to
    short-circuit once a not-yet-due step is reached. */
export const WAITLIST_STEPS: WaitlistStep[] = ["day0", "day2", "day5"];

/** How long after signup each step becomes due. */
export const STEP_DELAY_MS: Record<WaitlistStep, number> = {
  day0: 0,
  day2: 2 * DAY,
  day5: 5 * DAY,
};

interface WaitlistEmail {
  subject: string;
  preheader: string; // hidden inbox-preview line
  heading: string;
  /** Body paragraphs (plain strings; rendered as <p>). */
  body: string[];
  cta: { label: string; path: string };
}

const EMAILS: Record<WaitlistStep, WaitlistEmail> = {
  day0: {
    subject: "You're on the list. Here's what Pulse does.",
    preheader: "The operating system for recording studios - the quick version.",
    heading: "Welcome to Pulse",
    body: [
      "Thanks for joining the list. You'll hear from us a few times over the next week, then only when there's something worth your inbox.",
      "Pulse is the operating system for recording studios: bookings, rooms, staff, inventory and payments in one place, with the busywork automated. Clients book and pay online, deposits and reminders fire on their own, and your calendar, your rooms and your team stay in sync without the spreadsheet juggling.",
      "The studios running on Pulse spend less time chasing confirmations and more time in the room. Over the next couple of emails we'll show you exactly how.",
    ],
    cta: { label: "See how it works", path: "/#features" },
  },
  day2: {
    subject: "The money studios lose without noticing",
    preheader: "No-shows, forgotten deposits, and the follow-ups nobody sends.",
    heading: "Where studio revenue leaks",
    body: [
      "Most studios don't lose money on the sessions they book. They lose it on the ones that quietly fall apart: the no-show that never paid a deposit, the reminder nobody sent, the balance that went uncollected, the open slot no one backfilled.",
      "Pulse closes those leaks automatically. Deposits are required up front, reminders go out at 24 hours and 2 hours, unpaid holds release themselves, and the waitlist backfills a cancellation before the slot goes cold.",
      "Every dollar Pulse recovers gets tallied, so at the end of the month you can see exactly what the automation earned back for you.",
    ],
    cta: { label: "See the numbers", path: "/#features" },
  },
  day5: {
    subject: "Ready to run your whole studio on Pulse?",
    preheader: "Pick a plan, connect Stripe, take your first booking today.",
    heading: "Take your first booking on Pulse",
    body: [
      "You've seen what Pulse does and where it pays for itself. Getting started takes about ten minutes: pick a plan, connect your Stripe, and your online booking page is live.",
      "No long setup, no migration project. Bring one room and one client to start, and add the rest of your studio as you go.",
      "If you'd rather see it first, just reply to this email and we'll walk you through it personally.",
    ],
    cta: { label: "Get started", path: "/#contact" },
  },
};

function appBaseUrl(): string {
  return (process.env.APP_URL ?? "https://studiopulse.tech").replace(/\/$/, "");
}

/** Build the one-click unsubscribe URL served by GET /unsubscribe on the
    Convex HTTP router (convex/http.ts). CONVEX_SITE_URL is the .convex.site
    origin; fall back to a relative link if it isn't set. */
function unsubscribeUrl(email: string): string {
  const site = process.env.CONVEX_SITE_URL?.replace(/\/$/, "");
  const path = `/unsubscribe?email=${encodeURIComponent(email)}`;
  return site ? `${site}${path}` : path;
}

function shell(email: WaitlistEmail, recipient: string): string {
  const app = appBaseUrl();
  const paras = email.body
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#2a2a2a">${escapeHtml(p)}</p>`,
    )
    .join("");
  const ctaHref = `${app}${email.cta.path}`;
  const unsub = unsubscribeUrl(recipient);

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f2ee;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f2ee;">${escapeHtml(email.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e2da;">
        <tr>
          <td style="background:#0d0d0f;padding:26px 32px;">
            <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:0.02em;color:#ffffff;">Pulse</span>
            <span style="font-size:12px;color:#fdb913;letter-spacing:0.14em;text-transform:uppercase;padding-left:10px;">for studios</span>
          </td>
        </tr>
        <tr>
          <td style="padding:34px 32px 8px;">
            <h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#0d0d0f;">${escapeHtml(email.heading)}</h1>
            ${paras}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;">
              <tr><td style="border-radius:9px;background:#fdb913;">
                <a href="${ctaHref}" style="display:inline-block;padding:13px 26px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:#0d0d0f;text-decoration:none;">${escapeHtml(email.cta.label)}</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 32px 30px;border-top:1px solid #eeeae2;">
            <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#8a8577;">
              Pulse by Myind Sound - the operating system for recording studios.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#8a8577;">
              You're getting this because you joined the Pulse waitlist.
              <a href="${unsub}" style="color:#8a8577;text-decoration:underline;">Unsubscribe</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Render one nurture step for a recipient. Returns null for an unknown step so
    the delivering action can no-op safely. */
export function renderWaitlistEmail(
  step: WaitlistStep,
  args: { email: string },
): { subject: string; html: string } | null {
  const tpl = EMAILS[step];
  if (!tpl) return null;
  return { subject: tpl.subject, html: shell(tpl, args.email) };
}
