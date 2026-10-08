/* Shapes for Resend Receiving, and turning them into what we store. Pure.

   Webhook `email.received` carries metadata only (no body, no headers):
   https://resend.com/docs/dashboard/receiving/create-receiving-webhook
   The full message: GET https://api.resend.com/emails/receiving/{id}
   https://resend.com/docs/api-reference/emails/retrieve-received-email */

import { parseMessageIds } from "./threading";

export type WebhookAttachment = {
  id?: string;
  filename?: string;
  content_type?: string;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number;
};

export type ReceivedWebhook = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    message_id?: string;
    subject?: string;
    attachments?: WebhookAttachment[];
  };
};

export type ReceivedEmail = {
  id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string | string[] | undefined> | null;
  received_for?: string[];
  message_id?: string;
  created_at?: string;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: WebhookAttachment[];
};

/** What _ingest stores. Every field is bounded so a message fits in one Convex document. */
export type InboundMessage = {
  resendEmailId: string;
  from: string;
  to: string[];
  cc: string[];
  replyTo: string[];
  receivedFor: string[];
  subject: string;
  text?: string;
  html?: string;
  htmlTruncated?: boolean;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  receivedAt: number;
  authentication?: { spf?: string; dkim?: string; dmarc?: string };
  attachments: Array<{ resendId?: string; filename: string; contentType: string; size?: number; contentId?: string; inline: boolean }>;
  bodyStatus: "ok" | "pending";
};

export const MAX_HTML_CHARS = 400_000;
export const MAX_TEXT_CHARS = 200_000;
const MAX_LIST = 50;

const str = (v: unknown, max = 998): string => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_LIST).map((x) => x.slice(0, 320)) : [];

/** Case-insensitive header lookup; arrays joined. */
export function header(headers: ReceivedEmail["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== want || v === undefined || v === null) continue;
    return Array.isArray(v) ? v.join(" ") : String(v);
  }
  return undefined;
}

/** Inline images arrive as base64 data URIs. Bytes belong in R2 and a Convex
 *  document caps at 1 MiB, so they are removed from the stored HTML. */
export function stripDataUris(html: string): string {
  return html.replace(/(\bsrc\s*=\s*["']?)data:[^"'\s>]*/gi, "$1");
}

export function boundHtml(html: string | null | undefined): { html?: string; truncated?: boolean } {
  if (!html) return {};
  const stripped = stripDataUris(html);
  if (stripped.length <= MAX_HTML_CHARS) return { html: stripped };
  return { html: stripped.slice(0, MAX_HTML_CHARS), truncated: true };
}

function attachmentsOf(raw: WebhookAttachment[] | undefined): InboundMessage["attachments"] {
  return (raw ?? []).slice(0, 25).map((a) => ({
    resendId: typeof a.id === "string" ? a.id : undefined,
    filename: str(a.filename, 200) || "attachment",
    contentType: str(a.content_type, 120) || "application/octet-stream",
    size: typeof a.size === "number" ? a.size : undefined,
    contentId: typeof a.content_id === "string" && a.content_id ? a.content_id.slice(0, 200) : undefined,
    inline: a.content_disposition === "inline",
  }));
}

/** How an inbound attachment's bytes are stored. The sender picks the declared
 *  type, so it is never what R2 serves: a text/html or SVG "invoice" opened from
 *  its signed URL would otherwise render, scripts and all. Always
 *  application/octet-stream and a forced download; the declared type stays on
 *  the message row as metadata. The filename is reduced to a plain token so it
 *  cannot break out of the header parameter. */
export function attachmentStorage(filename: string): { mimeType: string; disposition: string } {
  const safe = filename.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^[\s.]+|\s+$/g, "").slice(0, 150) || "attachment";
  return { mimeType: "application/octet-stream", disposition: `attachment; filename="${safe}"` };
}

function parseTime(v: unknown, fallback: number): number {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : fallback;
}

/** From the webhook alone (body still to fetch). */
export function fromWebhook(w: ReceivedWebhook, now: number): InboundMessage | null {
  const d = w.data;
  if (!d || typeof d.email_id !== "string" || !d.email_id) return null;
  return {
    resendEmailId: d.email_id.slice(0, 120),
    from: str(d.from, 320),
    to: list(d.to),
    cc: list(d.cc),
    replyTo: [],
    receivedFor: list(d.received_for),
    subject: str(d.subject, 500),
    messageId: parseMessageIds(d.message_id)[0],
    references: [],
    receivedAt: parseTime(d.created_at, now),
    attachments: attachmentsOf(d.attachments),
    bodyStatus: "pending",
  };
}

/** From the full received email (the normal path). */
export function fromReceived(resendEmailId: string, e: ReceivedEmail, now: number, fallback?: InboundMessage | null): InboundMessage {
  const { html, truncated } = boundHtml(e.html);
  const text = typeof e.text === "string" && e.text ? e.text.slice(0, MAX_TEXT_CHARS) : undefined;
  const inReplyTo = parseMessageIds(header(e.headers, "in-reply-to"))[0];
  const references = parseMessageIds(header(e.headers, "references")).slice(-25);
  const auth = e.authentication
    ? { spf: str(e.authentication.spf, 40) || undefined, dkim: str(e.authentication.dkim, 40) || undefined, dmarc: str(e.authentication.dmarc, 40) || undefined }
    : undefined;
  return {
    resendEmailId,
    from: str(e.from, 320) || fallback?.from || "",
    to: e.to ? list(e.to) : fallback?.to ?? [],
    cc: e.cc ? list(e.cc) : fallback?.cc ?? [],
    replyTo: list(e.reply_to),
    receivedFor: e.received_for ? list(e.received_for) : fallback?.receivedFor ?? [],
    subject: str(e.subject, 500) || fallback?.subject || "",
    text,
    html,
    htmlTruncated: truncated,
    messageId: parseMessageIds(e.message_id ?? header(e.headers, "message-id"))[0] ?? fallback?.messageId,
    inReplyTo,
    references,
    receivedAt: parseTime(e.created_at, fallback?.receivedAt ?? now),
    authentication: auth,
    attachments: e.attachments ? attachmentsOf(e.attachments) : fallback?.attachments ?? [],
    bodyStatus: "ok",
  };
}

/** A one-line preview for lists. */
export function snippetOf(text: string | undefined, html: string | undefined): string {
  const source = text ?? (html ? html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ") : "");
  return source
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
