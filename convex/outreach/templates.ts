import { signatureHtml, type SignatureKey, type SignatureMode } from "./signatures";

/* Outreach email templates and the pure renderer. No network, no database.

   Copy is Version B, the MaxB-authored canonical pitch from Lawrence's
   pulse-outreach EMAILS.md, unchanged. Layout is the branded dark card from
   that package's preview files. */

export type PersonaKey = "maxb" | "lawrence";

export const PERSONAS: Record<PersonaKey, {
  label: string; fromName: string; fromEmail: string; replyTo: string; signature: SignatureKey; templates: string[];
}> = {
  maxb: {
    label: "MaxB (Roverto Benson, Outreach Lead)",
    fromName: "MaxB | Pulse",
    fromEmail: "info@studiopulse.tech",
    replyTo: "info@studiopulse.tech",
    signature: "roverto",
    templates: ["maxb_system"],
  },
  // Sender and signature are set. There is no approved Lawrence-authored copy
  // yet (Version A is older, per-studio, and makes pricing claims), so no template.
  lawrence: {
    label: "Lawrence Berment (Founder)",
    fromName: "Lawrence Berment",
    fromEmail: "lawrenceb@studiopulse.tech",
    replyTo: "lawrenceb@studiopulse.tech",
    signature: "lawrence",
    templates: [],
  },
};

export const LOGO_URL = "https://studiopulse.tech/pulse-logo-main.png";
export const SITE_URL = "https://studiopulse.tech";

export const TEMPLATES = {
  maxb_system: {
    key: "maxb_system",
    name: "Your studio has a sound (MaxB)",
    persona: "maxb" as PersonaKey,
    subject: "Your studio has a sound. Now give it a system.",
    greeting: (studio: string) => `Hey ${studio} team,`,
    paragraphs: [
      "Your best work happens in the studio. Running the studio shouldn’t take you away from it.",
      "Imagine seeing what’s booked, who’s working, where your gear is, and how the business is performing, without piecing it together from separate apps and conversations.",
      "That’s the idea behind Pulse: bookings and staff scheduling, equipment inventory, invoicing, expenses and financial reporting in one connected workspace, with AI assistance to help your existing team stay on top of what needs attention.",
      "Less time keeping everything together. More time moving your studio forward.",
      "I’m MaxB, reaching out for Lawrence “ThaMyind” Berment, a Grammy-nominated producer and songwriter with credits with Kanye West and Pusha T. He built Pulse for the business behind the music.",
      "Open to 15 minutes with Lawrence? He’ll show you how your bookings, inventory and financials can work together, so there’s less to manage between sessions.",
    ],
    cta: "SEE YOUR STUDIO, CONNECTED",
    textSignoff: ["MaxB", "On behalf of Lawrence “ThaMyind” Berment", "Founder of Pulse"],
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type RenderInput = {
  template: TemplateKey;
  studio: string;
  /** One sourced observation about this studio, inserted after the greeting. Optional. */
  observation?: string;
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
};

export function renderEmail(input: RenderInput): Rendered {
  const t = TEMPLATES[input.template];
  const persona = PERSONAS[t.persona];
  const studio = input.studio.trim() || "your";
  const blockers: string[] = [];

  const meeting = input.bookingUrl?.trim();
  if (meeting && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(meeting)) throw new Error("Booking link must be a verified https URL");
  const cta = meeting || `mailto:${persona.replyTo}?subject=${encodeURIComponent(`Pulse walkthrough: ${studio}`)}`;
  if (!meeting) blockers.push("booking_link_not_verified");

  const address = input.postalAddress?.trim();
  if (!address) blockers.push("postal_address_missing");
  const addressLine = address || "[Business mailing address required before sending]";

  const paragraphs = [t.greeting(studio)];
  if (input.observation?.trim()) paragraphs.push(input.observation.trim());
  paragraphs.push(...t.paragraphs);

  const sig = signatureHtml(persona.signature, input.signatureMode ?? "original");
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 18px;color:#f6f6f5;font-size:16px;line-height:1.7">${esc(p)}</p>`)
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.subject)}</title></head>
<body style="margin:0;background:#0a0a0b;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">A personal invitation to see Pulse around ${esc(studio)}'s workflow.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0a0a0b"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#111113;border:1px solid #2a2a2e;border-radius:16px">
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid #2a2a2e"><a href="${SITE_URL}"><img src="${LOGO_URL}" alt="Pulse" width="130" style="display:block;border:0;width:130px;height:auto"></a><p style="margin:16px 0 0;color:#fdb913;font-size:11px;letter-spacing:2px">BUILT FOR THE STUDIO. BY A PRODUCER.</p></td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 24px;color:#f6f6f5;font-size:28px;line-height:1.25">Your studio has a sound.<br><span style="color:#fdb913">Now give it a system.</span></h1>${body}
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#fdb913" style="border-radius:8px"><a href="${esc(cta)}" style="display:inline-block;padding:16px 24px;color:#0a0a0b;font-weight:bold;font-size:14px;text-decoration:none">${t.cta}</a></td></tr></table>
<div style="margin-top:28px">${sig}</div></td></tr>
<tr><td style="padding:24px 32px;border-top:1px solid #2a2a2e;color:#c9c7cc;font-size:12px;line-height:1.6">Pulse<br>${esc(addressLine)}<br>Not relevant? Reply <strong>unsubscribe</strong> and we will stop contacting you.<br><a href="${SITE_URL}" style="color:#fdb913">studiopulse.tech</a></td></tr></table></td></tr></table></body></html>`;

  const text = [
    paragraphs.join("\n\n"),
    meeting ? `Choose a time: ${meeting}` : `Reply to this email to find a time.`,
    t.textSignoff.join("\n") + `\n${SITE_URL}`,
    `Pulse | ${addressLine}\nNot relevant? Reply 'unsubscribe' and we will stop contacting you.`,
  ].join("\n\n");

  // Campaign rule from the workflow doc: no em dashes anywhere in what recipients read.
  const readable = [t.subject, body, text, addressLine].join("\n");
  if (readable.includes("—")) throw new Error("Em dash is not allowed in campaign copy");

  const links = [...new Set([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]))];
  return { subject: t.subject, html, text, links, blockers, persona: t.persona };
}

/** SHA-256 hex over everything that defines what will be sent. Approval binds to this. */
export async function contentHash(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
