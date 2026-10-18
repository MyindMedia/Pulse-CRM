import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { isOptOut } from "./callPolicy";
import { extractAnswers } from "./callScript";

/* POST /bland/events
   Bland posts the post-call result here. Guarded by BLAND_WEBHOOK_SECRET, taken from
   ?secret=, or the x-pulse-secret / Authorization: Bearer header. 503 while the secret is
   unset (never open), 401 when wrong. The body is untrusted: only fields we read are
   copied. Transcripts are scanned for a stop request, and on the first completed event the
   customer's answers are texted to the owner; they are never written to a table. */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** Constant-time equality over SHA-256 digests (fixed length, so no length leak). */
export async function secretMatches(presented: string | null | undefined, secret: string): Promise<boolean> {
  if (!presented) return false;
  const [a, b] = await Promise.all([digest(presented), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function presentedSecret(req: Request): string | null {
  const q = new URL(req.url).searchParams.get("secret");
  if (q) return q;
  const h = req.headers.get("x-pulse-secret");
  if (h) return h;
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

const str = (x: unknown, max = 200): string | undefined => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);

export const blandEvents = httpAction(async (ctx, req) => {
  const secret = process.env.BLAND_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "Not enabled" });
  if (!(await secretMatches(presentedSecret(req), secret))) return json(401, { error: "Unauthorized" });
  const raw = await req.text();
  if (raw.length > 2 * 1024 * 1024) return json(413, { error: "Body too large" });
  let p: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    p = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Bad JSON" });
  }
  const callId = str(p.call_id ?? p.c_id, 100);
  if (!callId) return json(400, { error: "call_id required" });
  const status = str(p.status, 40)?.toLowerCase();
  const errorMessage = str(p.error_message);
  const failed = Boolean(errorMessage) || status === "failed" || status === "error" || status === "canceled" || status === "cancelled";
  const meta = p.metadata && typeof p.metadata === "object" ? (p.metadata as Record<string, unknown>) : {};
  const length = typeof p.call_length === "number" && Number.isFinite(p.call_length) ? p.call_length : undefined;
  const r = await ctx.runMutation(internal.outreachCalls._applyEvent, {
    blandCallId: callId,
    externalId: str(p.external_id, 100) ?? str(meta.call_id, 100),
    completed: p.completed === true || status === "completed",
    failed,
    errorMessage,
    answeredBy: str(p.answered_by, 40),
    // An agent call (MaxB) extracts a founder_brief: what the studio said, for the demo.
    summary: str((p.variables as Record<string, unknown> | undefined)?.founder_brief, 600) ?? str(p.summary, 600),
    disposition: str(p.disposition_tag, 60),
    callLengthMin: length,
    optOut: isOptOut(p),
  });
  if (r.firstCompletion) {
    try {
      await ctx.runAction(internal.outreachCalls._textBrief, { callId: r.firstCompletion, answers: extractAnswers(p.transcripts) });
    } catch {
      // The call result is saved; a failed text must not make Bland retry it.
    }
  }
  // 200 even for a call we do not know, so Bland does not retry forever and nothing is revealed.
  return json(200, { ok: true, matched: r.found });
});
