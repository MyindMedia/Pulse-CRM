/* ============================================================
   Thin OpenAI wrapper for Pulse's AI features.

   Graceful fallback: if OPENAI_API_KEY isn't configured on the
   Convex deployment, the wrapper returns null and the calling code
   uses its own templated fallback. This lets the rest of the
   product ship + run without the AI side blocking on key setup.

   Per the cross-project rule, client products use OpenAI's GPT-5
   family rather than Claude.
   ============================================================ */
import OpenAI from "openai";

export const DEFAULT_MODEL = "gpt-5-mini";

/** Build a client lazily so missing-key environments don't crash module load. */
function client(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/** True when OPENAI_API_KEY is configured. Useful for UI hints. */
export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export type CompletionResult =
  | { source: "openai"; model: string; text: string }
  | { source: "fallback"; text: string };

/** Single round-trip completion. Returns either OpenAI output or null
 * if no key is set (the caller then provides its own fallback string). */
export async function complete(
  prompt: string,
  opts?: { model?: string; system?: string; maxOutputTokens?: number },
): Promise<{ source: "openai"; model: string; text: string } | null> {
  const c = client();
  if (!c) return null;
  const model = opts?.model ?? DEFAULT_MODEL;
  try {
    const res = await c.responses.create({
      model,
      input: [
        ...(opts?.system
          ? ([
              { role: "system" as const, content: opts.system },
            ] satisfies OpenAI.Responses.ResponseInputItem[])
          : []),
        { role: "user" as const, content: prompt },
      ],
      max_output_tokens: opts?.maxOutputTokens ?? 800,
    });
    const text = res.output_text ?? "";
    return { source: "openai", model, text };
  } catch (err) {
    // Don't bubble up to the caller -- log and fall back.
    console.error("[openai.complete] error", err);
    return null;
  }
}
