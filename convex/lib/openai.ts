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

/* Model tiering (both env-overridable so the exact GPT-5 ids can be set on the
   deployment without a code change):
   - DEFAULT_MODEL: fast + cheap, for copy (emails, recaps, prep packets).
   - SMART_MODEL: the full GPT-5 tier, for JUDGMENT - the conversational agent's
     planning, risk/profitability narratives, anything that decides rather than
     just writes. */
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
export const SMART_MODEL = process.env.OPENAI_SMART_MODEL || "gpt-5";

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

/** Pull a JSON object out of a model response: strips code fences, then takes
 *  the outermost {...}. Pure + exported so the parser is unit-testable. */
export function extractJson(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

/** Structured completion: forces a JSON object and returns it PARSED, so call
 *  sites never brace-slice free text. Tries OpenAI with a json_schema response
 *  format (retrying once without it if the param is unsupported), then Gemini
 *  with a JSON instruction; robust extract+parse on every path. Returns null
 *  when nothing usable comes back so the caller keeps its deterministic path. */
export async function completeJSON<T = unknown>(
  prompt: string,
  opts?: {
    model?: string;
    system?: string;
    maxOutputTokens?: number;
    schema?: { name: string; schema: Record<string, unknown> };
  },
): Promise<{ source: string; model: string; data: T } | null> {
  const model = opts?.model ?? DEFAULT_MODEL;
  const base = opts?.system ? `${opts.system}\n\n${INJECTION_GUARD}` : INJECTION_GUARD;
  const system = `${base}\n\n${NO_EM_DASH_RULE}\n\nRespond with ONLY a single valid JSON object - no prose, no markdown code fences.`;
  const maxTokens = opts?.maxOutputTokens ?? 1200;

  const tryParse = (text: string): T | null => {
    const j = extractJson(stripEmDashes(text));
    if (!j) return null;
    try {
      return JSON.parse(j) as T;
    } catch {
      return null;
    }
  };

  const c = client();
  if (c) {
    // Degrade the requested model to DEFAULT_MODEL (still OpenAI) before falling
    // to Gemini - so a not-yet-enabled SMART model id doesn't bounce the agent
    // off OpenAI entirely. For each model, try the json_schema format first,
    // then plain (some SDK/model combos reject the format param).
    const models = model === DEFAULT_MODEL ? [model] : [model, DEFAULT_MODEL];
    for (const m of models) {
      for (const useFormat of opts?.schema ? [true, false] : [false]) {
        try {
          const req: Record<string, unknown> = {
            model: m,
            input: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            max_output_tokens: maxTokens,
          };
          if (useFormat && opts?.schema) {
            req.text = {
              format: { type: "json_schema", name: opts.schema.name, schema: opts.schema.schema, strict: false },
            };
          }
          const res = (await c.responses.create(
            req as Parameters<typeof c.responses.create>[0],
          )) as { output_text?: string };
          const data = tryParse(res.output_text ?? "");
          if (data) return { source: "openai", model: m, data };
        } catch (err) {
          console.error("[openai.completeJSON] error", err);
        }
      }
    }
  }

  const g = await completeGemini(prompt, system, maxTokens);
  if (g) {
    const data = tryParse(g.text);
    if (data) return { source: "gemini", model: GEMINI_MODEL, data };
  }
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
