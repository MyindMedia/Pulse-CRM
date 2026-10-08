/* Outbound mail from a mailbox: body rendering and the Resend request body.

   - Shared mailboxes (support@, info@, ...) are client-facing and wear the Pulse
     layout (brandEmail).
   - A personal mailbox with a signature (lawrenceb@) sends a plain-looking body,
     then the owner's existing outreach signature, then a small Pulse footer.
     The signature comes from convex/outreach/signatures.ts unchanged; this file
     never edits or copies it.
   Em dashes are stripped from everything that goes out. */

import { brandEmail, PULSE_BRAND } from "../lib/emailLayout";
import { escapeHtml, stripEmDashes } from "../lib/text";
import { signatureHtml, inlineImagesFor, type SignatureKey } from "../outreach/signatures";

export type MailboxForSend = {
  address: string;
  fromName: string;
  kind: "shared" | "personal";
  signature?: SignatureKey;
};

const FONT = "Arial,Helvetica,sans-serif";

/** Plain text to safe HTML paragraphs. Blank lines split paragraphs; single newlines become <br>. */
export function textToHtml(text: string, style = ""): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px 0;${style}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** The small Pulse footer under a personal email. */
export function pulseFooterHtml(): string {
  const { tagline, address, siteHost, siteUrl } = PULSE_BRAND;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border-top:1px solid #e7e7ea"><tr><td style="padding-top:10px;font-family:${FONT};font-size:11px;line-height:1.6;color:#6e6e76">` +
    `${escapeHtml(tagline)}<br>${escapeHtml(address)}<br><a href="${siteUrl}" style="color:#8a6400;text-decoration:underline">${siteHost}</a>` +
    `</td></tr></table>`;
}

export function renderBody(mailbox: MailboxForSend, subject: string, body: string): { html: string; text: string } {
  const cleanBody = stripEmDashes(body).trim();
  const footerText = `${PULSE_BRAND.tagline}\n${PULSE_BRAND.address}\n${PULSE_BRAND.siteUrl}`;
  if (mailbox.kind === "personal" && mailbox.signature) {
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
      `<body style="margin:0;padding:16px;background:#ffffff">` +
      `<div style="font-family:${FONT};font-size:14px;line-height:1.6;color:#1a1a1f;max-width:640px">${textToHtml(cleanBody)}</div>` +
      `<div style="margin-top:18px">${signatureHtml(mailbox.signature, "image")}</div>` +
      pulseFooterHtml() +
      `</body></html>`;
    const text = `${cleanBody}\n\n${mailbox.fromName}\n\n${footerText}`;
    return { html, text };
  }
  const bodyHtml = `${textToHtml(cleanBody)}\n<p style="margin:18px 0 0 0;">${escapeHtml(mailbox.fromName)}</p>`;
  return { html: brandEmail({ title: subject, bodyHtml }), text: `${cleanBody}\n\n${mailbox.fromName}\n\n${footerText}` };
}

export type OutboundInput = {
  mailbox: MailboxForSend;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
};

export type ResendPayload = {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: string; content_type: string; content_id: string }>;
};

/** Quote a display name for a From header when it carries specials. */
function fromHeader(name: string, address: string): string {
  const clean = stripEmDashes(name).replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return address;
  return /[(),.:;@[\]\\]/.test(clean) ? `"${clean}" <${address}>` : `${clean} <${address}>`;
}

/** The Resend request body for a message as stored (used by the delivery action). */
export function payloadFromStored(
  sender: { fromName: string; address: string },
  m: { to: string[]; cc?: string[]; subject: string; html: string; text: string; inReplyTo?: string; references?: string[] },
): ResendPayload {
  const headers: Record<string, string> = {};
  if (m.inReplyTo) headers["In-Reply-To"] = m.inReplyTo;
  const refs = m.references?.length ? m.references : m.inReplyTo ? [m.inReplyTo] : [];
  if (refs.length) headers["References"] = refs.join(" ");
  const images = inlineImagesFor(m.html);
  return {
    from: fromHeader(sender.fromName, sender.address),
    to: m.to,
    ...(m.cc?.length ? { cc: m.cc } : {}),
    subject: m.subject,
    html: m.html,
    text: m.text,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(images.length
      ? { attachments: images.map((i) => ({ filename: i.filename, content: i.base64, content_type: i.contentType, content_id: i.contentId })) }
      : {}),
  };
}

export function buildOutboundPayload(input: OutboundInput): { payload: ResendPayload; html: string; text: string; subject: string } {
  const subject = stripEmDashes(input.subject).replace(/[\r\n]+/g, " ").trim() || "(no subject)";
  const { html, text } = renderBody(input.mailbox, subject, input.body);
  const payload = payloadFromStored(input.mailbox, { to: input.to, cc: input.cc, subject, html, text, inReplyTo: input.inReplyTo, references: input.references });
  return { payload, html, text, subject };
}
