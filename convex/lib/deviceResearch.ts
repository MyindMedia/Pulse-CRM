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


/* ── Reading a spec sheet ────────────────────────────────────
   Same provider, same scoping rule. A manufacturer's manual is
   public documentation; nothing about a client goes near it.
   ──────────────────────────────────────────────────────────── */

/** Vision-capable model on this account, for a photo of a back panel. */
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "gemma4:31b";

/** Manuals are long and the I/O is a small part. Bound what we send. */
export const MAX_SOURCE_CHARS = 24_000;

/**
 * Ask about a device using a document the studio supplied, rather than the
 * model's own memory of the product. `images` is base64 without the data:
 * prefix, which is what Ollama's chat API expects.
 */
export async function readDeviceSpec<T = unknown>(
  prompt: string,
  system: string,
  images?: string[],
): Promise<{ model: string; data: T } | null> {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) return null;

  const model = images?.length ? OLLAMA_VISION_MODEL : OLLAMA_MODEL;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          images?.length
            ? { role: "user", content: prompt, images }
            : { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { message?: { content?: string } };
    const text = body?.message?.content;
    if (!text) return null;

    const parsed = parseJsonObject<T>(text);
    return parsed ? { model: `ollama:${model}`, data: parsed } : null;
  } catch {
    return null;
  }
}

/**
 * Strip a fetched page down to the words on it.
 *
 * Deliberately crude: script and style contents go, tags go, entities are
 * loosened, whitespace collapses. A spec table survives that fine, and it
 * avoids carrying an HTML parser into the Convex runtime.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Rows and cells become spaces so a spec table does not run together.
    .replace(/<\/(td|th|tr|li|p|div|h[1-6])>/gi, " \n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetch a URL the studio pasted and return its text.
 *
 * Only http(s), and the body is capped, because this runs server-side with
 * the studio's trust: it must not be turned into a way to probe the local
 * network or to pull down something enormous.
 */
export async function fetchSourceText(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Block the obvious internal targets. Convex actions run in the cloud, so
  // this is belt and braces rather than the only defence.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(parsed.hostname)) {
    return null;
  }

  try {
    const res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "PulsePatchManager/1.0 (device spec lookup)" },
    });
    if (!res.ok) return null;

    const type = res.headers.get("content-type") ?? "";
    // A PDF at a URL is not text and we will not pretend otherwise. The
    // upload path handles those, where the browser extracts the words.
    if (type.includes("pdf")) return null;

    const body = await res.text();
    const text = type.includes("html") ? htmlToText(body) : body;
    return text.slice(0, MAX_SOURCE_CHARS);
  } catch {
    return null;
  }
}
