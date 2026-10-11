/* ============================================================
   Claude (Anthropic) for Pulse's AI features: the first provider tried.

   Owner rule, 2026-10-10: Pulse's worker agents run on Lawrence's own
   Anthropic key (ANTHROPIC_API_KEY on every Convex deployment, dev and
   prod). Pulse is his product, not a client deliverable, so the older
   "client products use OpenAI" rule does not apply here. lib/openai.ts
   calls this first and falls back to OpenAI, then Gemini, then the
   caller's own template, so a missing key or an outage never blocks a
   feature.

   One model, two efforts: routine copy (emails, recaps, prep packets) runs
   at low effort, judgment (the agent's planning, risk narratives) at high.
   ANTHROPIC_MODEL / ANTHROPIC_SMART_MODEL override the model per deployment
   without a code change (e.g. claude-sonnet-5-5 to spend less).
   ============================================================ */
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const CLAUDE_SMART_MODEL = process.env.ANTHROPIC_SMART_MODEL || "claude-opus-5-5";

/** "default" = routine copy, "smart" = decisions. */
export type ClaudeTier = "default" | "smart";

/** True when ANTHROPIC_API_KEY is configured. */
export function hasClaude(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Built per call so a deployment without the key never fails at import. */
function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
}

/** One user turn to Claude. Returns the answer text, or null on any failure
 *  (no key, API error, refusal, empty answer) so the caller falls through to
 *  the next provider instead of throwing. */
export async function claudeText(opts: {
  system: string;
  prompt: string;
  tier: ClaudeTier;
  /** Constrain the answer to this JSON schema (structured outputs). */
  jsonSchema?: Record<string, unknown>;
}): Promise<{ model: string; text: string } | null> {
  const c = client();
  if (!c) return null;
  const model = opts.tier === "smart" ? CLAUDE_SMART_MODEL : CLAUDE_MODEL;
  const effort = opts.tier === "smart" ? "high" : "low";

  const ask = async (withSchema: boolean) => {
    const res = await c.beta.messages.create({
      model,
      // Room for adaptive thinking (always on for Opus 5.5) plus the answer.
      // The prompts ask for short output and only generated tokens bill.
      max_tokens: 16000,
      // A request a safety classifier declines reruns server-side on
      // Anthropic's recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: {
        effort,
        ...(withSchema && opts.jsonSchema
          ? { format: { type: "json_schema" as const, schema: opts.jsonSchema } }
          : {}),
      },
    });
    if (res.stop_reason === "refusal") return null;
    const text = res.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    return text ? { model: res.model, text } : null;
  };

  try {
    return await ask(true);
  } catch (err) {
    // A schema the structured-output validator rejects comes back as a 400:
    // ask once more with the JSON instruction alone before leaving Claude.
    if (opts.jsonSchema && err instanceof Anthropic.BadRequestError) {
      try {
        return await ask(false);
      } catch (retryErr) {
        logFailure(retryErr);
        return null;
      }
    }
    logFailure(err);
    return null;
  }
}

function logFailure(err: unknown): void {
  if (err instanceof Anthropic.APIError) {
    console.error(`[claude] API error ${err.status ?? "?"}: ${err.message}`);
  } else {
    console.error("[claude] error", err);
  }
}
