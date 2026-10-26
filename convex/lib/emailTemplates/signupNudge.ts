/* Reminders for someone who started a trial on the pricing page and did not
   finish checkout. Three of them, then silence. Written to a studio owner,
   short, one button each.

   Returns the message BODY only. sendEmail wraps it in the shared Pulse layout
   (header, footer, postal address), so this template has no frame of its own. */

import { escapeEmailHtml } from "./layout";

const FONT = "Inter,'Segoe UI',Arial,sans-serif";

const h1 = (t: string) =>
  `<h1 style="margin:0 0 10px 0;font-family:${FONT};font-size:22px;line-height:1.3;color:#101015;">${t}</h1>`;
const p = (t: string) =>
  `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:#3a3a42;">${t}</p>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px 0;"><tr><td align="center" bgcolor="#fdb913" style="background:#fdb913;border-radius:11px;">
<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:800;color:#1a1405;text-decoration:none;">${label}</a>
</td></tr></table>`;
const small = (t: string) =>
  `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6e6e76;">${t}</p>`;

export type NudgeArgs = {
  /** 0, 1 or 2: which reminder this is. */
  step: number;
  studioName: string;
  tierName: string;
  trialDays: number;
  resumeUrl: string;
  unsubscribeUrl: string;
  demoUrl: string;
};

export function signupNudgeSubject(step: number, studioName: string): string {
  const name = studioName.trim();
  if (step === 0) return name ? `${name} is one step from Pulse` : "Your Pulse trial is one step away";
  if (step === 1) return "What Pulse runs for your studio";
  return "Last reminder about your Pulse trial";
}

export function signupNudgeHtml(a: NudgeArgs): string {
  const resume = escapeEmailHtml(a.resumeUrl);
  const unsub = escapeEmailHtml(a.unsubscribeUrl);
  const demo = escapeEmailHtml(a.demoUrl);
  const studio = escapeEmailHtml(a.studioName.trim() || "your studio");
  const tier = escapeEmailHtml(a.tierName);
  const footer =
    small(`You are getting this because you started a Pulse trial with this address and did not finish. We send at most three reminders.`) +
    small(`<a href="${unsub}" style="color:#6e6e76;">Stop these emails</a>`);

  if (a.step === 0) {
    return (
      h1(`Your ${tier} trial is one step away`) +
      p(`You started setting up ${studio} on Pulse and stopped at checkout. Your spot is saved: pick up where you left off and the first ${a.trialDays} days are free.`) +
      p(`Cancel any time in the trial and you pay nothing.`) +
      button(resume, "Finish setting up") +
      footer
    );
  }
  if (a.step === 1) {
    return (
      h1(`Here is what Pulse takes off your plate`) +
      p(`Bookings and deposits on your own booking page, reminders that go out on their own, client files and split sheets in one place, and the money side (payments, receipts, payouts) without a spreadsheet.`) +
      p(`Set up ${studio} in a few minutes and run your next week of sessions through it free.`) +
      button(resume, `Start my ${a.trialDays}-day trial`) +
      footer
    );
  }
  return (
    h1(`Still thinking it over?`) +
    p(`This is the last reminder about ${studio}. If you would rather see Pulse first, book a short demo and we will walk through it with your studio's setup.`) +
    button(resume, "Finish setting up") +
    p(`<a href="${demo}" style="color:#3a3a42;font-weight:600;">Or book a demo</a>`) +
    footer
  );
}
