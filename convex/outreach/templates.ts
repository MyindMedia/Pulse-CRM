import { signatureHtml, type SignatureKey, type SignatureMode } from "./signatures";

/* Outreach email templates and the pure renderer. No network, no database.

   Copy is Version B, the MaxB-authored canonical pitch from Lawrence's
   pulse-outreach EMAILS.md, with one edit he asked for (2026-10-01): the founder line says
   "a Grammy-nominated producer" and no longer names credits or artists. Layout is the original Pulse email
   design from the 01-04 studio emails (620px dark card, centred logo header,
   gold button), which Lawrence prefers over the pulse-outreach preview layout. */

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
      "I’m MaxB, reaching out for Lawrence “ThaMyind” Berment, a Grammy-nominated producer. He built Pulse for the business behind the music.",
      "Open to 15 minutes with Lawrence? He’ll show you how your bookings, inventory and financials can work together, so there’s less to manage between sessions.",
    ],
    cta: "See Pulse in action",
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

  const sig = signatureHtml(persona.signature, input.signatureMode ?? "image");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(t.subject)}</title>
<style>@media only screen and (max-width:480px){.pad{padding:28px 20px !important}.head{padding:32px 20px 26px !important}.hl{font-size:23px !important}}</style></head>
<body bgcolor="#0a0a0b" style="margin:0; padding:0; background:#0a0a0b; font-family:'Segoe UI', -apple-system, Helvetica, Arial, sans-serif;">
<div style="display:none;max-height:0;overflow:hidden">A personal invitation to see Pulse around ${esc(studio)}'s workflow.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0a0a0b" style="background:#0a0a0b;width:100%"><tr><td align="center" bgcolor="#0a0a0b" style="background:#0a0a0b">
<table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" bgcolor="#0d0d0f" style="width:100%;max-width:620px;background:#0d0d0f;border:1px solid #232326;border-radius:16px;border-collapse:separate">
<tr><td class="head" align="center" bgcolor="#0d0d0f" style="background:#0d0d0f;padding:48px 44px 36px;text-align:center;border-bottom:1px solid #232326;border-radius:16px 16px 0 0">
  <img src="${LOGO_URL}" alt="Pulse" width="220" style="display:block;margin:0 auto;width:220px;max-width:100%;height:auto;border:0" />
  <div style="margin-top:18px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#b9b8b4">The studio operating system</div>
</td></tr>
<tr><td class="pad" align="center" bgcolor="#0d0d0f" style="background:#0d0d0f;padding:44px;text-align:center;border-radius:0 0 16px 16px">
      <div class="hl" style="font-size:27px;line-height:1.3;color:#ffffff;font-weight:700;letter-spacing:-0.01em;margin-bottom:18px">
        Your studio has a sound. <span style="color:#fdb913">Now give it a system.</span>
      </div>
${paragraphs.map((p) => `      <p style="font-size:15px;line-height:1.75;color:#d6d5d2;margin:0 0 18px">${esc(p)}</p>`).join("\n")}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:34px auto"><tr><td align="center" bgcolor="#fdb913" style="background:#fdb913;border-radius:12px">
  <a href="${esc(cta)}" style="display:inline-block;padding:16px 40px;font-size:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#0a0a0b;text-decoration:none">${t.cta}</a>
</td></tr></table>
<div style="margin-top:8px;text-align:left">${sig}</div>
<div style="margin-top:30px;padding-top:24px;border-top:1px solid #232326;text-align:center">
  <div style="font-size:12px;color:#8f8c86">Built by a Grammy-nominated producer, not a SaaS company.</div>
  <div style="margin-top:6px"><a href="${SITE_URL}" style="color:#fdb913;text-decoration:none;font-size:13px">studiopulse.tech</a></div>
  <div style="margin-top:14px;font-size:11px;line-height:1.6;color:#8f8c86">Pulse<br>${esc(addressLine)}<br>Not relevant? Reply <strong>unsubscribe</strong> and we will stop contacting you.</div>
</div>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    paragraphs.join("\n\n"),
    meeting ? `Choose a time: ${meeting}` : `Reply to this email to find a time.`,
    t.textSignoff.join("\n") + `\n${SITE_URL}`,
    `Pulse | ${addressLine}\nNot relevant? Reply 'unsubscribe' and we will stop contacting you.`,
  ].join("\n\n");

  // Campaign rule from the workflow doc: no em dashes anywhere in what recipients read.
  const readable = [t.subject, paragraphs.join("\n"), text, addressLine].join("\n");
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
