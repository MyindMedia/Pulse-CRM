import { signatureHtml, type SignatureKey, type SignatureMode } from "./signatures";

/* Outreach email templates and the pure renderer. No network, no database.

   The product is Pulse OS, the studio operating system (never a CRM); the phone
   companion is the Pulse app. Outreach rule (2026-10-10): the first cold email to
   a studio comes from Lawrence (lawrence_first). MaxB sends every follow-up and
   any later message in that thread (maxb_followup_1..3, maxb_reply). No accolade
   claims anywhere. Layout is the original Pulse email design from the 01-04
   studio emails (620px dark card, centred logo header, gold button). */

export type PersonaKey = "maxb" | "lawrence";

export type TemplateKey = "lawrence_first" | "maxb_followup_1" | "maxb_followup_2" | "maxb_followup_3" | "maxb_reply";

export const PERSONAS: Record<PersonaKey, {
  label: string; fromName: string; fromEmail: string; replyTo: string; signature: SignatureKey; templates: TemplateKey[];
}> = {
  maxb: {
    label: "MaxB (Roverto Benson, Outreach Lead)",
    fromName: "MaxB | Pulse",
    fromEmail: "info@studiopulse.tech",
    replyTo: "info@studiopulse.tech",
    signature: "roverto",
    templates: ["maxb_followup_1", "maxb_followup_2", "maxb_followup_3", "maxb_reply"],
  },
  lawrence: {
    label: "Lawrence Berment (Founder)",
    fromName: "Lawrence Berment",
    fromEmail: "lawrenceb@studiopulse.tech",
    replyTo: "lawrenceb@studiopulse.tech",
    signature: "lawrence",
    templates: ["lawrence_first"],
  },
};

/* Every outreach email names both inboxes in Reply-To, so a studio's reply to
   Lawrence's first email or to a MaxB follow-up reaches both of them. */
export const THREAD_REPLY_TO = [PERSONAS.lawrence.fromEmail, PERSONAS.maxb.fromEmail];

/* The sequence: step 0 is Lawrence's first email, steps 1-3 are MaxB's follow-ups,
   due this many days after step 0 was accepted by the provider. */
export const SEQUENCE_TEMPLATES: readonly TemplateKey[] = ["lawrence_first", "maxb_followup_1", "maxb_followup_2", "maxb_followup_3"];
export const FOLLOWUP_DAYS: readonly number[] = [0, 3, 7, 14];

export const LOGO_URL = "https://studiopulse.tech/pulse-logo-main.png";
export const SITE_URL = "https://studiopulse.tech";
/** What the CTA line says when no verified booking link is set yet (approval is then blocked). */
const DEMO_FALLBACK = "studiopulse.tech/demo";

export type Template = {
  key: TemplateKey;
  name: string;
  persona: PersonaKey;
  /** 0-3 for the sequence, null for a MaxB reply sent by hand. */
  step: number | null;
  /** A reply in Lawrence's thread: subject is "Re: <step-0 subject>", no subject override. */
  threaded: boolean;
  /** The per-prospect opening line is required (step 0). */
  requiresObservation: boolean;
  subject: (studio: string) => string;
  preheader: (studio: string) => string;
  greeting: (studio: string) => string;
  /** The only paragraphs a body override may replace. */
  middle: readonly string[];
  offer?: string;
  closing: (demo: string) => string;
  cta: string;
  signoff: readonly string[];
};

const MAXB_SIGNOFF = ["MaxB (Roverto Benson)", "Outreach Lead, Pulse OS"] as const;
const hi = (studio: string) => `Hi ${studio} team,`;

export const TEMPLATES: Record<TemplateKey, Template> = {
  lawrence_first: {
    key: "lawrence_first",
    name: "First email (Lawrence)",
    persona: "lawrence",
    step: 0,
    threaded: false,
    requiresObservation: true,
    subject: (studio) => `A question about running ${studio}`,
    preheader: (studio) => `A short note from Lawrence about running ${studio}.`,
    greeting: hi,
    middle: [
      "I’m Lawrence, a producer who’s run studios. For years I juggled a booking app, a spreadsheet and deposit texts to know who was in which room.",
      "So I built Pulse OS, the studio operating system: bookings, deposits, staff scheduling, gear, invoicing and reporting in one place. On their phones, your team gets the Pulse app: checklists, clock in/out, session notes.",
    ],
    offer: "Founding studios get 50% off the first 3 months.",
    closing: (demo) => `Open to a 15-minute demo? Pick a time at ${demo}.`,
    cta: "Book a 15-minute demo",
    signoff: ["Lawrence Berment", "Founder, Pulse OS"],
  },
  maxb_followup_1: {
    key: "maxb_followup_1",
    name: "Day 3 follow-up (MaxB)",
    persona: "maxb",
    step: 1,
    threaded: true,
    requiresObservation: false,
    subject: (studio) => `Following up for ${studio}`,
    preheader: () => "Following up on Lawrence’s note.",
    greeting: hi,
    middle: [
      "Following up on Lawrence’s note from a few days ago. I’m MaxB, and I work with Lawrence on Pulse OS, the studio operating system.",
    ],
    closing: (demo) => `If a 15-minute demo would help, pick a time at ${demo}.`,
    cta: "Book a 15-minute demo",
    signoff: MAXB_SIGNOFF,
  },
  maxb_followup_2: {
    key: "maxb_followup_2",
    name: "Day 7 follow-up (MaxB)",
    persona: "maxb",
    step: 2,
    threaded: true,
    requiresObservation: false,
    subject: (studio) => `Following up for ${studio}`,
    preheader: () => "One thing studios like about Pulse OS.",
    greeting: hi,
    middle: [
      "MaxB here, I work with Lawrence. One thing studios like about Pulse OS: a client books and pays the deposit, then the room and engineer show up on everyone’s schedule and in the Pulse app.",
    ],
    offer: "Founding studios still get 50% off the first 3 months.",
    closing: (demo) => `Worth 15 minutes? The demo is at ${demo}.`,
    cta: "Book a 15-minute demo",
    signoff: MAXB_SIGNOFF,
  },
  maxb_followup_3: {
    key: "maxb_followup_3",
    name: "Day 14 follow-up (MaxB)",
    persona: "maxb",
    step: 3,
    threaded: true,
    requiresObservation: false,
    subject: (studio) => `Following up for ${studio}`,
    preheader: () => "My last note for now.",
    greeting: hi,
    middle: [
      "MaxB again, I work with Lawrence. I don’t want to crowd your inbox, so this is my last note for now.",
    ],
    closing: (demo) => `If Pulse OS is ever worth a look, reply anytime, or grab a 15-minute demo at ${demo}.`,
    cta: "Book a 15-minute demo",
    signoff: MAXB_SIGNOFF,
  },
  maxb_reply: {
    key: "maxb_reply",
    name: "Reply in the thread (MaxB)",
    persona: "maxb",
    step: null,
    threaded: true,
    requiresObservation: false,
    subject: (studio) => `Pulse OS for ${studio}`,
    preheader: () => "A note from MaxB at Pulse OS.",
    greeting: hi,
    middle: [
      "MaxB here, I work with Lawrence on Pulse OS. Happy to answer any questions, or set up a time to walk you through it.",
    ],
    closing: (demo) => `The 15-minute demo is at ${demo}.`,
    cta: "Book a 15-minute demo",
    signoff: MAXB_SIGNOFF,
  },
};

export const isTemplateKey = (k: string): k is TemplateKey => Object.prototype.hasOwnProperty.call(TEMPLATES, k);

/** The template for a sequence step (0 = Lawrence, 1-3 = MaxB). */
export function templateForStep(step: number): TemplateKey {
  const k = SEQUENCE_TEMPLATES[step];
  if (!k) throw new Error(`No template for sequence step ${step}`);
  return k;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const MAX_OBSERVATION_CHARS = 400;
export const MAX_SUBJECT_CHARS = 150;
export const MAX_BODY_CHARS = 1500;

/* Copy rules for everything a recipient reads, overrides and opening lines included. */
export const AWARD_RE = /grammy|award|nominated/i;
export const CRM_RE = /\bCRM\b/i;

export type RenderInput = {
  template: TemplateKey;
  studio: string;
  /** The per-prospect opening line. Required for Lawrence's first email. */
  observation?: string;
  /** Replaces the default subject (not allowed on a threaded reply). */
  subjectOverride?: string;
  /** Plain text, blank lines between paragraphs. Replaces only the middle paragraphs. */
  bodyOverride?: string;
  /** For a threaded reply: the step-0 subject it answers. */
  threadSubject?: string;
  /** Operator-verified https booking link. Without it the button opens a reply. */
  bookingUrl?: string;
  postalAddress?: string;
  signatureMode?: SignatureMode;
};

export type Rendered = {
  subject: string;
  html: string;
  text: string;
  /** Every URL in the HTML, so a preview can show exactly where each link goes. */
  links: string[];
  /** Reasons this cannot be approved yet. */
  blockers: string[];
  persona: PersonaKey;
  replyTo: string[];
  /** Words a recipient reads in the body: greeting through sign-off (not the footer). */
  words: number;
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const paragraphsOf = (body: string) => body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map(oneLine).filter(Boolean);
const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** "https://studiopulse.tech/demo/" -> "studiopulse.tech/demo" */
const displayUrl = (u: string) => u.replace(/^https:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

export function threadedSubject(first: string): string {
  const s = oneLine(first);
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function renderEmail(input: RenderInput): Rendered {
  if (!isTemplateKey(input.template)) throw new Error("This template is no longer available. Prepare the email again.");
  const t = TEMPLATES[input.template];
  const persona = PERSONAS[t.persona];
  const studio = oneLine(input.studio) || "your";
  const blockers: string[] = [];

  const meeting = input.bookingUrl?.trim();
  if (meeting && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(meeting)) throw new Error("Booking link must be a verified https URL");
  const cta = meeting || `mailto:${persona.replyTo}?subject=${encodeURIComponent(`Pulse OS demo: ${studio}`)}`;
  if (!meeting) blockers.push("booking_link_not_verified");

  const address = input.postalAddress?.trim();
  if (!address) blockers.push("postal_address_missing");
  const addressLine = address || "[Business mailing address required before sending]";

  const observation = oneLine(input.observation ?? "");
  if (t.requiresObservation && !observation) throw new Error("Add an opening line about this studio first");
  if (observation.length > MAX_OBSERVATION_CHARS) throw new Error(`The opening line is over ${MAX_OBSERVATION_CHARS} characters`);

  const subjectOverride = oneLine(input.subjectOverride ?? "");
  let subject: string;
  if (t.threaded) {
    if (subjectOverride) throw new Error("A reply keeps the first email's subject");
    if (!input.threadSubject?.trim()) throw new Error("A reply needs the first email's subject");
    subject = threadedSubject(input.threadSubject);
  } else {
    subject = subjectOverride || t.subject(studio);
  }
  if (subject.length > MAX_SUBJECT_CHARS) throw new Error(`The subject is over ${MAX_SUBJECT_CHARS} characters`);

  const body = input.bodyOverride?.trim() ?? "";
  if (body.length > MAX_BODY_CHARS) throw new Error(`The body is over ${MAX_BODY_CHARS} characters`);
  const middle = body ? paragraphsOf(body) : [...t.middle];

  const demo = meeting ? displayUrl(meeting) : DEMO_FALLBACK;
  const paragraphs = [t.greeting(studio)];
  if (observation && !t.threaded) paragraphs.push(observation);
  paragraphs.push(...middle);
  if (t.offer) paragraphs.push(t.offer);
  paragraphs.push(t.closing(demo));

  const sig = signatureHtml(persona.signature, input.signatureMode ?? "image");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:480px){.pad{padding:28px 20px !important}.head{padding:32px 20px 26px !important}}</style></head>
<body bgcolor="#0a0a0b" style="margin:0; padding:0; background:#0a0a0b; font-family:'Segoe UI', -apple-system, Helvetica, Arial, sans-serif;">
<div style="display:none;max-height:0;overflow:hidden">${esc(t.preheader(studio))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0a0a0b" style="background:#0a0a0b;width:100%"><tr><td align="center" bgcolor="#0a0a0b" style="background:#0a0a0b">
<table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" bgcolor="#0d0d0f" style="width:100%;max-width:620px;background:#0d0d0f;border:1px solid #232326;border-radius:16px;border-collapse:separate">
<tr><td class="head" align="center" bgcolor="#0d0d0f" style="background:#0d0d0f;padding:48px 44px 36px;text-align:center;border-bottom:1px solid #232326;border-radius:16px 16px 0 0">
  <img src="${LOGO_URL}" alt="Pulse OS" width="220" style="display:block;margin:0 auto;width:220px;max-width:100%;height:auto;border:0" />
  <div style="margin-top:18px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#b9b8b4">The studio operating system</div>
</td></tr>
<tr><td class="pad" align="center" bgcolor="#0d0d0f" style="background:#0d0d0f;padding:44px;text-align:center;border-radius:0 0 16px 16px">
${paragraphs.map((p) => `      <p style="font-size:15px;line-height:1.75;color:#d6d5d2;margin:0 0 18px">${esc(p)}</p>`).join("\n")}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:34px auto"><tr><td align="center" bgcolor="#fdb913" style="background:#fdb913;border-radius:12px">
  <a href="${esc(cta)}" style="display:inline-block;padding:16px 40px;font-size:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#0a0a0b;text-decoration:none">${esc(t.cta)}</a>
</td></tr></table>
      <p style="font-size:15px;line-height:1.6;color:#d6d5d2;margin:0 0 14px">${t.signoff.map(esc).join("<br>")}</p>
<div style="margin-top:8px;text-align:left">${sig}</div>
<div style="margin-top:30px;padding-top:24px;border-top:1px solid #232326;text-align:center">
  <div style="font-size:12px;color:#8f8c86">Built by studio people, for studios.</div>
  <div style="margin-top:6px"><a href="${SITE_URL}" style="color:#fdb913;text-decoration:none;font-size:13px">studiopulse.tech</a></div>
  <div style="margin-top:14px;font-size:11px;line-height:1.6;color:#8f8c86">Pulse OS<br>${esc(addressLine)}<br>Not relevant? Reply <strong>unsubscribe</strong> and we will stop contacting you.</div>
</div>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    paragraphs.join("\n\n"),
    meeting ? `Book a 15-minute demo: ${meeting}` : `Reply to this email to find a time.`,
    t.signoff.join("\n") + `\n${SITE_URL}`,
    `Pulse OS | ${addressLine}\nNot relevant? Reply 'unsubscribe' and we will stop contacting you.`,
  ].join("\n\n");

  // Campaign rules: no em dashes, no accolade claims, and it is never called a CRM.
  const readable = [subject, t.preheader(studio), paragraphs.join("\n"), t.signoff.join("\n"), text, addressLine].join("\n");
  if (readable.includes("—")) throw new Error("Em dash is not allowed in campaign copy");
  if (AWARD_RE.test(readable)) throw new Error("Award language is not allowed in outreach copy");
  if (CRM_RE.test(readable)) throw new Error("Call it Pulse OS, the studio operating system, not a CRM");

  const links = [...new Set([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]))];
  const words = countWords([...paragraphs, ...t.signoff].join(" "));
  return { subject, html, text, links, blockers, persona: t.persona, replyTo: [...THREAD_REPLY_TO], words };
}

/** SHA-256 hex over everything that defines what will be sent. Approval binds to this. */
export async function contentHash(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
