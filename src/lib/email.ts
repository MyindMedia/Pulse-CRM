/* Server-only Resend client for owned-channel acquisition email (newsletter
   broadcasts and small batch sends). Mirrors convex/lib/email.ts exactly:
   same RESEND_API_KEY / RESEND_FROM env, same "simulated" no-op when the key
   is unset, same em-dash stripping. This lives in src/ (not convex/) because
   the newsletter send path is a Next.js route handler, not a Convex action -
   the two email surfaces are deliberately separate:
     - convex/lib/email.ts  -> per-tenant studio transactional mail
     - this file            -> Pulse's own owned-channel marketing mail

   Only import from server code (route handlers / server components). */

/** Downgrade em/en dashes to hyphens (house rule: no em dashes anywhere). */
function stripEmDashes(value: string): string {
  return value.replace(/[—–―]/g, "-");
}

const RESEND_BASE = "https://api.resend.com";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function defaultFrom(): string {
  return process.env.RESEND_FROM ?? "Pulse <support@myindsound.com>";
}

type ResendResult<T> =
  | { ok: true; status: "sent"; data: T }
  | { ok: false; status: "simulated"; reason: string }
  | { ok: false; status: "failed"; reason: string; httpStatus?: number };

async function resendFetch<T>(path: string, body: unknown): Promise<ResendResult<T>> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: "simulated", reason: "RESEND_API_KEY not set" };
  try {
    const res = await fetch(`${RESEND_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as T & { message?: string }) : ({} as T);
    if (!res.ok) {
      const reason =
        (json as { message?: string })?.message ?? `Resend ${res.status} ${res.statusText}`;
      return { ok: false, status: "failed", reason, httpStatus: res.status };
    }
    return { ok: true, status: "sent", data: json };
  } catch (e) {
    return { ok: false, status: "failed", reason: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Send one issue directly to an explicit recipient list via Resend's batch
 * endpoint (max 100 per request; we chunk). Good for a dry-run send to a
 * handful of addresses before firing the full broadcast.
 */
export async function sendNewsletterBatch(args: {
  recipients: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}): Promise<{ status: "sent" | "simulated" | "failed"; delivered: number; failed: number; errors: string[] }> {
  const recipients = [...new Set(args.recipients.map((r) => r.trim()).filter(Boolean))];
  if (recipients.length === 0) {
    return { status: "failed", delivered: 0, failed: 0, errors: ["no recipients"] };
  }
  if (!resendConfigured()) {
    return { status: "simulated", delivered: 0, failed: recipients.length, errors: ["RESEND_API_KEY not set"] };
  }

  const from = args.from ?? defaultFrom();
  const subject = stripEmDashes(args.subject);
  const html = stripEmDashes(args.html);

  const chunks: string[][] = [];
  for (let i = 0; i < recipients.length; i += 100) chunks.push(recipients.slice(i, i + 100));

  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const chunk of chunks) {
    const payload = chunk.map((to) => ({
      from,
      to: [to],
      subject,
      html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }));
    const res = await resendFetch<{ data?: unknown[] }>("/emails/batch", payload);
    if (res.ok) delivered += chunk.length;
    else {
      failed += chunk.length;
      errors.push(res.reason);
    }
  }
  return { status: failed === 0 ? "sent" : delivered > 0 ? "sent" : "failed", delivered, failed, errors };
}

/**
 * Create and immediately send a Resend Broadcast to a managed Audience - the
 * "full waitlist" path. The subscriber list lives in Resend (Audiences), so
 * Newsletter Issue #1 goes out without a human touching the Resend dashboard.
 * Requires RESEND_AUDIENCE_ID (or an explicit audienceId).
 */
export async function sendNewsletterBroadcast(args: {
  subject: string;
  html: string;
  audienceId?: string;
  name?: string;
  from?: string;
  replyTo?: string;
}): Promise<{ status: "sent" | "simulated" | "failed"; broadcastId?: string; reason?: string }> {
  const audienceId = args.audienceId ?? process.env.RESEND_AUDIENCE_ID;
  if (!audienceId) {
    return { status: "failed", reason: "RESEND_AUDIENCE_ID not set (needed for broadcast mode)" };
  }
  if (!resendConfigured()) {
    return { status: "simulated", reason: "RESEND_API_KEY not set" };
  }

  const created = await resendFetch<{ id: string }>("/broadcasts", {
    audience_id: audienceId,
    from: args.from ?? defaultFrom(),
    subject: stripEmDashes(args.subject),
    html: stripEmDashes(args.html),
    name: args.name ?? stripEmDashes(args.subject),
    ...(args.replyTo ? { reply_to: args.replyTo } : {}),
  });
  if (!created.ok) return { status: "failed", reason: created.reason };

  const broadcastId = created.data.id;
  const sent = await resendFetch<{ id: string }>(`/broadcasts/${broadcastId}/send`, {});
  if (!sent.ok) return { status: "failed", broadcastId, reason: sent.reason };

  return { status: "sent", broadcastId };
}
