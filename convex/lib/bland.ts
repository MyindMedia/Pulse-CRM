/* Bland AI client for the confirmation call. Request shape follows
   https://docs.bland.ai/api-v1/post/calls (read 2026-10-07). The API key is the
   BLAND_API_KEY Convex env var and is never in code or in a stored body. */

import { DISPOSITIONS, SUMMARY_PROMPT } from "../outreach/callScript";

export const BLAND_CALLS_URL = "https://api.bland.ai/v1/calls";

export type BlandCallInput = {
  phone: string; // E.164
  task: string;
  firstSentence: string;
  from: string; // E.164, from config
  voice?: string;
  maxDurationMinutes: number;
  webhook: string;
  externalId: string;
  metadata: Record<string, string>;
};

/** The exact JSON body POSTed to Bland. Dry run stores this same object. */
export function buildCallBody(i: BlandCallInput): Record<string, unknown> {
  return {
    phone_number: i.phone,
    task: i.task,
    first_sentence: i.firstSentence,
    from: i.from,
    ...(i.voice ? { voice: i.voice } : {}),
    max_duration: i.maxDurationMinutes,
    record: false,
    // Let the callee speak first so a voicemail greeting is not talked over.
    wait_for_greeting: true,
    // Never leave a message with an AI voice on a stranger's voicemail.
    voicemail: { action: "hangup" },
    webhook: i.webhook,
    // Only the post-call webhook; no live event stream.
    webhook_events: [],
    dispositions: DISPOSITIONS,
    summary_prompt: SUMMARY_PROMPT,
    external_id: i.externalId,
    metadata: i.metadata,
  };
}

/** Where Bland posts results. Needs BLAND_WEBHOOK_SECRET; null when it cannot be formed. */
export function webhookUrl(env: Record<string, string | undefined> = process.env, redact = false): string | null {
  const secret = env.BLAND_WEBHOOK_SECRET;
  const base = env.BLAND_WEBHOOK_BASE ?? env.CONVEX_SITE_URL;
  if (!secret || !base) return null;
  return `${base.replace(/\/$/, "")}/bland/events?secret=${redact ? "REDACTED" : encodeURIComponent(secret)}`;
}

export type BlandResult =
  | { ok: true; callId: string }
  | { ok: false; error: string };

/** POST one call. Never throws; the caller records the outcome. No retry here. */
export async function placeCall(
  body: Record<string, unknown>,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<BlandResult> {
  if (!apiKey) return { ok: false, error: "BLAND_API_KEY is not set" };
  try {
    const res = await fetchImpl(BLAND_CALLS_URL, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    let json: { status?: string; call_id?: string; message?: string } = {};
    try { json = (await res.json()) as typeof json; } catch { /* non-JSON body */ }
    if (res.ok && json.status === "success" && typeof json.call_id === "string" && json.call_id) {
      return { ok: true, callId: json.call_id };
    }
    // Never echo the response body wholesale: keep a short, fixed-shape message.
    return { ok: false, error: `Bland answered ${res.status}${json.message ? `: ${String(json.message).slice(0, 160)}` : ""}` };
  } catch {
    return { ok: false, error: "Could not reach Bland (timed out or network error)" };
  }
}
