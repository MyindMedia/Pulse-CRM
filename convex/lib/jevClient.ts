/* ============================================================
   The one way Pulse asks Jev (TypeSafe System One) a question.

   Every feature that wants a fast, calibrated judgment (a yes/no, a choice
   from a set, a score on a described scale) calls askJev with its own state
   and questions. It returns null when Jev is unavailable (no key, timeout,
   API error), so the calling feature keeps its existing behavior instead of
   failing. The key (TYPESAFE_API_KEY) stays server-side.

   Privacy promise (src/app/privacy/page.tsx): bank transactions, balances
   and bank tokens are never sent to Jev or any other AI provider. Do not
   put them in a Jev state.

   Docs: https://docs.typesafe.ai/llms.txt
   ============================================================ */
import { TypeSafeClient, APIError, type EntryType, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";

/** True when this deployment can reach Jev. */
export function jevEnabled(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

/** Built per call so a deployment without the key never fails at import. */
function jevClient(timeoutMs: number): TypeSafeClient | null {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return null;
  return new TypeSafeClient({ apiKey, timeout: timeoutMs });
}

/** Ask Jev one batch of independent questions about one state. Answer types
 *  are inferred from the questions. Null when Jev is unavailable. */
export async function askJev<const Q extends Questions>(
  state: EntryType,
  questions: Q,
  opts?: { timeoutMs?: number },
): Promise<{ result: SystemOneResult<Q>; latencyMs: number } | null> {
  const client = jevClient(opts?.timeoutMs ?? 10_000);
  if (!client) return null;
  const started = Date.now();
  try {
    const result = await client.systemOne({ state, questions });
    return { result, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof APIError) console.error(`[jev] API error: ${err.message}`);
    else console.error("[jev] error", err);
    return null;
  }
}
