/* ============================================================
   Jev (TypeSafe System One): what does a studio's reply to an outreach email
   want? Pure: no SDK client, no I/O, so the question, the state Jev sees and
   the one automatic action's threshold are unit-testable and are the same
   objects for every caller (convex/outreachProspects.ts triageReply).
   Docs: https://docs.typesafe.ai/primitives/choice.md
         https://docs.typesafe.ai/confidence.md

   The label is information for the owner and changes nothing. The only thing
   Pulse does on its own: when `unsubscribe` has probability >= AUTO_OPT_OUT_AT,
   the address goes on the opt-out list through the same path as "mark opted
   out", which stops the follow-ups. jev-1.13 leans toward the first option
   (docs: model-jaggedness), so the option that acts is never first.
   ============================================================ */
import type { ChoiceQuestion } from "@typesafe-ai/sdk";

export const OUTREACH_REPLY_QUESTIONS = {
  replyIntent: {
    type: "choice",
    instructions:
      "A recording studio got a cold sales email offering a demo of Pulse, software for running a studio. " +
      "`subject` and `reply` are what the studio sent back, in their own words (earlier quoted messages removed). " +
      "What does the reply want?",
    criteria: {
      interested:
        "Wants to talk or see Pulse: asks to book or schedule a demo or a call, asks about pricing or plans, or says yes or tell me more.",
      not_now:
        "A polite no for now: busy, bad timing, maybe later, check back in a few months, circle back, or a plain no thanks that does not ask to stop.",
      unsubscribe:
        "Asks to stop: unsubscribe, remove me, take me off your list, do not email or contact us again, stop emailing; or is hostile or calls the email spam.",
      wrong_person:
        "Not the right contact: wrong person, left the company or no longer works there, the studio closed, or forwards it or points to someone else.",
      question:
        "Asks something about Pulse, the offer or the sender, other than pricing, without saying yes or no.",
      auto_reply:
        "Sent automatically, not written for this email: out-of-office or vacation notice, autoresponder, ticket confirmation, or mailbox not monitored.",
    },
  },
} satisfies Record<string, ChoiceQuestion>;

export type ReplyIntent = keyof typeof OUTREACH_REPLY_QUESTIONS.replyIntent.criteria;

/** Probability of `unsubscribe` at or above which Pulse opts the address out
 *  without a person. Anything lower is a label only. */
export const AUTO_OPT_OUT_AT = 0.9;

/** The one automatic action: opt out when `unsubscribe` is at least AUTO_OPT_OUT_AT. */
export function autoOptOut(probabilities: Readonly<Record<string, number>>): boolean {
  return (probabilities.unsubscribe ?? 0) >= AUTO_OPT_OUT_AT;
}

/** The longest reply Jev reads. Replies to a cold email are short, and the
 *  quoted history (our own pitch) is removed first. */
export const MAX_REPLY_CHARS = 2000;
const MAX_SUBJECT_CHARS = 200;
/** How much of a message is searched for quoted history: the reply sits on top. */
const MAX_SCAN_CHARS = 20_000;
const MAX_HTML_SCAN_CHARS = 100_000;

/** The state Jev evaluates: the reply as data, the channel, and the studio's
 *  name when we have it. No addresses, no other prospect data. */
export function outreachReplyState(reply: { subject: string; text: string }, company?: string | null) {
  return {
    channel: "Email reply to a cold sales email that Pulse sent to a recording studio",
    ...(company ? { company } : {}),
    subject: reply.subject.slice(0, MAX_SUBJECT_CHARS),
    reply: reply.text.slice(0, MAX_REPLY_CHARS),
  };
}

/* ----------------------- the studio's own words ----------------------- */

/* Our outreach footer, which every reply quotes: "Not relevant? Reply
   unsubscribe and we will stop contacting you." It must never read as the
   studio asking to stop. */
const OUR_FOOTER = /Not relevant\?\s*Reply\s*['"]?unsubscribe['"]?\s*and we will stop contacting you\.?/gi;

/* Where quoted history starts when the mail client does not mark each quoted
   line with ">" (Outlook and Yahoo style). Everything from here on is cut. */
const HISTORY_STARTS = [
  /^[ \t]*-{2,}[ \t]*(?:Original|Forwarded) Message[ \t]*-{2,}/im,
  /^[ \t]*From:[ \t].*\n(?:[ \t]*(?:Sent|Date|To|Cc|Subject):.*(?:\n|$)){1,4}/im,
  /^[ \t]*_{10,}[ \t]*$/m,
];

/* "On <date>, <name> wrote:" (and the same line in a few other languages),
   which may wrap onto up to two more lines. The quoted lines under it start
   with ">", so removing both keeps a reply written above or below them.
   Only a line carrying a year or an address counts (see IS_ATTRIBUTION), so
   "On second thought, here is what my partner wrote:" stays. Bounded line
   lengths keep the match linear on hostile input. */
const ATTRIBUTION =
  /^[ \t]*(?:On|Le|El|Am|Il|Op|Em)\b[^\n]{0,300}(?:\n[^\n]{0,300}){0,2}?(?:wrote|a écrit|escribió|schrieb|ha scritto|schreef|escreveu)[^\n]{0,300}:[ \t]*$/gim;
const IS_ATTRIBUTION = /@|\b(?:19|20)\d\d\b/;

/** HTML mail as text, for a message with no text part. Quoted history in HTML
 *  sits in <blockquote> (Gmail, Apple Mail, Outlook on the web): dropped. */
function htmlText(html: string): string {
  let h = html;
  for (let i = 0; i < 5 && /<blockquote[\s>]/i.test(h); i++) {
    h = h.replace(/<blockquote\b[^>]*>(?:(?!<blockquote\b)[\s\S])*?<\/blockquote>/gi, " ");
  }
  return h
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|table|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** What the studio wrote in this reply, without the quoted history under it
 *  (which is our own pitch, footer included). Bounded to MAX_REPLY_CHARS. */
export function replyText(text?: string | null, html?: string | null): string {
  const raw = text?.trim() ? text : html ? htmlText(html.slice(0, MAX_HTML_SCAN_CHARS)) : "";
  let s = raw.slice(0, MAX_SCAN_CHARS).replace(/\r\n?/g, "\n");
  let cut = s.length;
  for (const re of HISTORY_STARTS) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  s = s.slice(0, cut).replace(ATTRIBUTION, (line) => (IS_ATTRIBUTION.test(line) ? "" : line));
  s = s.split("\n").filter((line) => !/^[ \t]*>/.test(line)).join("\n");
  return s
    .replace(OUR_FOOTER, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_REPLY_CHARS);
}
