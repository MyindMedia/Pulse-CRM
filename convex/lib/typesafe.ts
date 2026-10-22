/* ============================================================
   TypeSafe System One (Jev): typed judgments with calibrated
   probabilities (https://docs.typesafe.ai/api.md).

   Code owns the workflow; Jev answers one narrow question. Server side
   only: TYPESAFE_API_KEY lives in the Convex env. Every failure (no key,
   HTTP error, timeout, malformed answer) returns null, and callers treat
   null as "a person decides".
   ============================================================ */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 8_000;

export type ChoiceAnswer = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

/** Ask one Choice question. `criteria` maps each choice to when it applies. */
export async function askChoice(args: {
  state: unknown;
  instructions: string;
  criteria: Record<string, string>;
}): Promise<ChoiceAnswer | null> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: args.state,
        questions: { q: { type: "choice", instructions: args.instructions, criteria: args.criteria } },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { answers?: { q?: Partial<ChoiceAnswer> & { type?: string } } };
    return parseChoice(json.answers?.q, Object.keys(args.criteria));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A well-formed Choice answer naming one of `allowed`, else null. */
export function parseChoice(raw: unknown, allowed: string[]): ChoiceAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<ChoiceAnswer>;
  if (typeof a.choice !== "string" || !allowed.includes(a.choice)) return null;
  if (typeof a.confidence !== "number" || !Number.isFinite(a.confidence)) return null;
  return { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities ?? {} };
}
