import { httpAction, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { verifySvix } from "./mail/svix";
import { attachmentStorage, fromWebhook, fromReceived, type ReceivedWebhook, type ReceivedEmail, type InboundMessage } from "./mail/inbound";
import { mailAgencyId } from "./mail";
import { storeBytes, isR2NotConfigured } from "./media";

/* ============================================================
   POST /resend/inbound: Resend Receiving webhook (`email.received`).

   1. Fail closed: 503 when RESEND_WEBHOOK_SECRET or the mail agency is unset.
   2. Verify the Svix signature over the raw body (401 on failure).
   3. Dedupe by Resend email id (Svix retries are answered 200).
   4. Fetch the full message (the webhook is metadata only). If that fails,
      store what the webhook carried and retry the body with backoff.
   5. Store (route + thread in mail._ingest), then copy attachments to R2.
   Docs: openspec/changes/email-inboxes/design.md
   ============================================================ */

const MAX_BODY_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
/** Body retries after a metadata-only store: 1m, 5m, 30m, 2h, 6h. */
export const HYDRATE_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fetchJson<T>(url: string, key: string): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, "User-Agent": "PulseMail/1.0" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchReceived(resendEmailId: string): Promise<ReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return await fetchJson<ReceivedEmail>(`https://api.resend.com/emails/receiving/${encodeURIComponent(resendEmailId)}`, key);
}

export const resendInbound = httpAction(async (ctx, req) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "Inbound email is not enabled" });
  const agencyId = mailAgencyId();
  if (!agencyId) return json(503, { error: "Inbound email is not enabled" });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "Body too large" });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Body too large" });

  const check = await verifySvix(
    secret,
    { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    raw,
  );
  if (!check.ok) return json(401, { error: "Invalid signature" });

  let event: ReceivedWebhook;
  try { event = JSON.parse(raw) as ReceivedWebhook; } catch { return json(400, { error: "Invalid JSON" }); }
  if (event.type !== "email.received") return json(200, { ignored: event.type ?? "unknown" });

  const meta = fromWebhook(event, Date.now());
  if (!meta) return json(400, { error: "Missing email_id" });

  const existing = await ctx.runQuery(internal.mail._byResendId, { resendEmailId: meta.resendEmailId });
  if (existing) return json(200, { duplicate: true });

  const full = await fetchReceived(meta.resendEmailId);
  const msg: InboundMessage = full ? fromReceived(meta.resendEmailId, full, Date.now(), meta) : meta;
  const out = await ctx.runMutation(internal.mail._ingest, { agencyId, msg });
  if (out.status === "stored") {
    if (msg.bodyStatus === "pending") {
      await ctx.scheduler.runAfter(HYDRATE_BACKOFF_MS[0], internal.mailInbound._hydrate, { messageId: out.messageId, resendEmailId: meta.resendEmailId, attempt: 1 });
    } else if (msg.attachments.length) {
      await ctx.scheduler.runAfter(0, internal.mailInbound._copyAttachments, { messageId: out.messageId });
    }
  }
  return json(200, { status: out.status, routed: out.status === "stored" ? out.routed : undefined });
});

/** Fetches the body for a message stored from webhook metadata only. */
export const _hydrate = internalAction({
  args: { messageId: v.id("mailMessages"), resendEmailId: v.string(), attempt: v.number() },
  handler: async (ctx, a) => {
    const full = await fetchReceived(a.resendEmailId);
    if (!full) {
      const final = a.attempt >= HYDRATE_BACKOFF_MS.length;
      await ctx.runMutation(internal.mail._hydrateFailed, { messageId: a.messageId, final });
      if (!final) {
        await ctx.scheduler.runAfter(HYDRATE_BACKOFF_MS[a.attempt], internal.mailInbound._hydrate, { ...a, attempt: a.attempt + 1 });
      }
      return null;
    }
    const msg = fromReceived(a.resendEmailId, full, Date.now());
    await ctx.runMutation(internal.mail._applyBody, { messageId: a.messageId, msg });
    if (msg.attachments.length) await ctx.scheduler.runAfter(0, internal.mailInbound._copyAttachments, { messageId: a.messageId });
    return null;
  },
});

type AttachmentListing = { data?: Array<{ id?: string; size?: number; download_url?: string; content_type?: string; filename?: string }> };

async function downloadBlob(url: string): Promise<Blob | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) return null;
    return new Blob([buf], { type: "application/octet-stream" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Copies attachment bytes to R2 (shared private bucket, `agency:<id>` scope),
 *  as application/octet-stream with Content-Disposition: attachment.
 *  Never to Convex storage: with R2 unset the attachment is marked skipped. */
export const _copyAttachments = internalAction({
  args: { messageId: v.id("mailMessages") },
  handler: async (ctx: ActionCtx, { messageId }) => {
    const job = await ctx.runQuery(internal.mail._attachmentJob, { messageId });
    if (!job || job.pending.length === 0) return null;
    const key = process.env.RESEND_API_KEY;
    const set = (index: number, status: "stored" | "skipped" | "failed", note?: string, fileRef?: Id<"mediaFiles">, size?: number) =>
      ctx.runMutation(internal.mail._setAttachment, { messageId, index, status, note, fileRef, size });
    if (!key) {
      for (const p of job.pending) await set(p.index, "skipped", "No Resend key on the server");
      return null;
    }
    const listing = await fetchJson<AttachmentListing>(`https://api.resend.com/emails/receiving/${encodeURIComponent(job.resendEmailId)}/attachments`, key);
    const byId = new Map((listing?.data ?? []).map((d) => [d.id, d]));
    let handled = 0;
    for (const p of job.pending) {
      if (handled >= MAX_ATTACHMENTS) { await set(p.index, "skipped", `Only the first ${MAX_ATTACHMENTS} attachments are copied`); continue; }
      handled++;
      const item = p.resendId ? byId.get(p.resendId) : undefined;
      if (!item?.download_url) { await set(p.index, "failed", "Resend did not return a download link"); continue; }
      if ((item.size ?? 0) > MAX_ATTACHMENT_BYTES) { await set(p.index, "skipped", "Larger than 25 MB", undefined, item.size); continue; }
      const blob = await downloadBlob(item.download_url);
      if (!blob) { await set(p.index, "failed", "Download failed"); continue; }
      try {
        // The sender's declared type stays on the message row only; R2 serves
        // the bytes as an opaque download (mail/inbound.ts attachmentStorage).
        const { mimeType, disposition } = attachmentStorage(p.filename);
        const ref = await storeBytes(ctx, {
          scope: `agency:${job.agencyId}`, purpose: "document", blob, fileName: p.filename, mimeType, disposition,
          actor: "mail-inbound", noFallback: true, untrusted: true,
        });
        await set(p.index, "stored", undefined, ref as Id<"mediaFiles">, blob.size);
      } catch (err) {
        await set(p.index, isR2NotConfigured(err) ? "skipped" : "failed", isR2NotConfigured(err) ? "R2 is not configured" : "Could not store the file");
      }
    }
    return null;
  },
});
