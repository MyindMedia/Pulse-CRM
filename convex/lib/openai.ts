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
import { stripEmDashes } from "./text";

export const DEFAULT_MODEL = "gpt-5-mini";

/* Brand voice: never emit em dashes or en dashes. Injected into every system
   prompt; the output is sanitized too as a belt-and-suspenders. */
const NO_EM_DASH_RULE =
  "Never use em dashes or en dashes in your output. Use a hyphen, comma, colon, or rewrite into separate sentences instead.";

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
  const system = opts?.system ? `${opts.system}\n\n${NO_EM_DASH_RULE}` : NO_EM_DASH_RULE;
  try {
    const res = await c.responses.create({
      model,
      input: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: prompt },
      ],
      max_output_tokens: opts?.maxOutputTokens ?? 800,
    });
    // Sanitize: strip any em/en dashes the model emits anyway.
    const text = stripEmDashes(res.output_text ?? "");
    return { source: "openai", model, text };
  } catch (err) {
    // Don't bubble up to the caller -- log and fall back.
    console.error("[openai.complete] error", err);
    return null;
  }
}
