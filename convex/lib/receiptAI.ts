import { INJECTION_GUARD } from "./aiGuard";
import { completeVisionJSON } from "./openai";

export const DEFAULT_GEMINI_RECEIPT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_RECEIPT_TIMEOUT_MS = 90_000;
const GEMINI_RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const UNREADABLE = "The receipt couldn't be read automatically. Enter the details by hand.";

type ReceiptFile = { mimeType: string; base64: string; fileName: string };
type ReceiptVisionOptions = {
  system: string;
  schema: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
};
type ReceiptVisionResult =
  | { ok: true; model: string; data: Record<string, unknown> }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Receipt-only provider choice. The deployment operator selects a paid Gemini
 * project before enabling it. A failed request never sends the financial document
 * to another provider. Unset keeps the existing OpenAI deployment behavior. */
export async function completeReceiptVisionJSON(
  prompt: string,
  file: ReceiptFile,
  opts: ReceiptVisionOptions,
): Promise<ReceiptVisionResult> {
  const provider = process.env.RECEIPT_AI_PROVIDER?.trim() || "openai";
  if (provider === "openai") {
    const result = await completeVisionJSON<unknown>(prompt, file, {
      ...opts,
      model: process.env.OPENAI_RECEIPT_MODEL?.trim() || undefined,
    });
    return result && isObject(result.data)
      ? { ok: true, model: result.model, data: result.data }
      : { ok: false, error: UNREADABLE };
  }
  if (provider !== "gemini") {
    console.error("[receiptAI] invalid provider configuration");
    return { ok: false, error: UNREADABLE };
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: UNREADABLE };
  if (!GEMINI_RECEIPT_TYPES.has(file.mimeType)) {
    return { ok: false, error: "Automatic reading supports JPEG, PNG, WebP and PDF receipts. Enter the details by hand or upload one of those formats." };
  }
  const model = process.env.GEMINI_RECEIPT_MODEL?.trim() || DEFAULT_GEMINI_RECEIPT_MODEL;
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) {
    console.error("[receiptAI] invalid Gemini model configuration");
    return { ok: false, error: UNREADABLE };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_RECEIPT_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${opts.system}\n\n${INJECTION_GUARD}\n\nRespond with only the requested JSON object. Never infer missing receipt fields.` }] },
          contents: [{ role: "user", parts: [
            { text: prompt },
            { inlineData: { mimeType: file.mimeType, data: file.base64 } },
          ] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: opts.schema.schema,
            maxOutputTokens: opts.maxOutputTokens ?? 2500,
            // Gemini 2.x uses a different thinking control; let that model use
            // its own default if an operator explicitly chooses it.
            ...(/^gemini-[3-9]/.test(model) ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
          },
          store: false,
        }),
      },
    );
    if (!response.ok) {
      // Provider bodies can echo prompts or credentials. Log only HTTP status.
      console.error("[receiptAI] Gemini request failed", response.status);
      return { ok: false, error: UNREADABLE };
    }
    const body: unknown = await response.json();
    if (!isObject(body) || !Array.isArray(body.candidates)) return { ok: false, error: UNREADABLE };
    const candidate: unknown = body.candidates[0];
    if (!isObject(candidate) || candidate.finishReason !== "STOP" || !isObject(candidate.content) || !Array.isArray(candidate.content.parts)) {
      return { ok: false, error: UNREADABLE };
    }
    const text = candidate.content.parts
      .filter((part: unknown): part is Record<string, unknown> => isObject(part) && part.thought !== true && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    const data: unknown = JSON.parse(text);
    return isObject(data) ? { ok: true, model, data } : { ok: false, error: UNREADABLE };
  } catch {
    // Never include model output, document bytes, key, or raw fetch exception.
    console.error("[receiptAI] Gemini request failed", controller.signal.aborted ? "timeout" : "response unavailable");
    return { ok: false, error: UNREADABLE };
  } finally {
    clearTimeout(timeout);
  }
}
