/* ============================================================
   The model that answers "what jacks are on the back of this?".

   Deliberately its own provider, not a branch inside
   lib/openai.ts. Two reasons:

   1. Scope. This key was issued for device research and nothing
      else. Wiring it into the shared `complete()` would quietly
      make it the fallback for the Agent, the concierge portal
      and email enrichment - surfaces that carry client names and
      financials.

   2. Data protection. The shared path is pinned to one AI
      sub-processor under a DPA precisely so customer data cannot
      route elsewhere. What goes out from here is a manufacturer
      and a model name - public product information, the same
      thing you would type into a search box - so a second
      provider is appropriate here and nowhere else.

   If this file ever starts receiving anything but a device name,
   that reasoning no longer holds.
   ============================================================ */

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "https://ollama.com";
const OLLAMA_MODEL = process.env.OLLAMA_DEVICE_MODEL || "gpt-oss:120b";

export function hasDeviceResearch(): boolean {
  return !!process.env.OLLAMA_API_KEY;
}

/** What model answered, for provenance on the profile. */
export function deviceResearchModel(): string {
  return `ollama:${OLLAMA_MODEL}`;
}

/**
 * Ask for one device's I/O as JSON.
 *
 * Returns null on anything unexpected rather than throwing: a spec lookup
 * that fails must leave the device exactly as placeable as it was, so every
 * caller treats "no answer" as an ordinary outcome.
 */
export async function researchDeviceIO<T = unknown>(
  prompt: string,
  system: string,
): Promise<{ model: string; data: T } | null> {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        // Ollama's JSON mode. Belt and braces with the instruction in the
        // system prompt, because a fenced code block is the usual failure.
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as { message?: { content?: string } };
    const text = body?.message?.content;
    if (!text) return null;

    const parsed = parseJsonObject<T>(text);
    return parsed ? { model: deviceResearchModel(), data: parsed } : null;
  } catch {
    // Network blip, timeout, malformed body. The category template stands.
    return null;
  }
}

/**
 * Pull the first JSON object out of a reply.
 *
 * JSON mode usually returns bare JSON, but a fenced block or a leading
 * sentence still shows up often enough that brace-slicing is worth keeping.
 */
export function parseJsonObject<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
