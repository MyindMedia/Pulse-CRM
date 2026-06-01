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
import { INJECTION_GUARD } from "./aiGuard";

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

export const GEMINI_MODEL = "gemini-2.5-flash";

/** Single round-trip completion. Prefers OpenAI (gpt-5 family per the
 * cross-project rule); falls back to Gemini when OpenAI has no key or errors
 * (e.g. no quota). Returns null only if neither provider is available, so the
 * caller can use its own templated fallback. Output is always em-dash-stripped. */
export async function complete(
  prompt: string,
  opts?: { model?: string; system?: string; maxOutputTokens?: number },
): Promise<{ source: string; model: string; text: string } | null> {
  const model = opts?.model ?? DEFAULT_MODEL;
  // Every system prompt carries the injection guard + brand-voice rule, so all
  // AI surfaces (Agent, concierge, enrichment) are hardened at one chokepoint.
  const base = opts?.system ? `${opts.system}\n\n${INJECTION_GUARD}` : INJECTION_GUARD;
  const system = `${base}\n\n${NO_EM_DASH_RULE}`;
  const maxTokens = opts?.maxOutputTokens ?? 800;

  // 1. OpenAI (preferred).
  const c = client();
  if (c) {
    try {
      const res = await c.responses.create({
        model,
        input: [
          { role: "system" as const, content: system },
          { role: "user" as const, content: prompt },
        ],
        max_output_tokens: maxTokens,
      });
      const text = stripEmDashes(res.output_text ?? "");
      if (text.trim()) return { source: "openai", model, text };
    } catch (err) {
      console.error("[openai.complete] error, trying Gemini", err);
    }
  }

  // 2. Gemini fallback (funded Pulse Google key).
  const g = await completeGemini(prompt, system, maxTokens);
  if (g) return g;
  return null;
}

async function completeGemini(
  prompt: string,
  system: string,
  maxTokens: number,
): Promise<{ source: string; model: string; text: string } | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget 0 keeps 2.5-flash's reasoning tokens from eating the
          // output budget (which was truncating structured JSON responses).
          generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = stripEmDashes(
      (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    );
    return text.trim() ? { source: "gemini", model: GEMINI_MODEL, text } : null;
  } catch (err) {
    console.error("[gemini.complete] error", err);
    return null;
  }
}
