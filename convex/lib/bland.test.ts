import { describe, it, expect, vi } from "vitest";
import { buildCallBody, placeCall, webhookUrl, BLAND_CALLS_URL } from "./bland";

const input = {
  phone: "+14085551234", task: "T", firstSentence: "Hi, this is Riley, an AI assistant calling for Pulse.", from: "+14086921713",
  maxDurationMinutes: 5, webhook: "https://x.convex.site/bland/events?secret=s", externalId: "row1", metadata: { agency_id: "a" },
};

describe("bland client", () => {
  it("builds the documented body", () => {
    const b = buildCallBody(input);
    expect(b).toMatchObject({
      phone_number: "+14085551234", task: "T", from: "+14086921713", max_duration: 5, record: false,
      wait_for_greeting: true, voicemail: { action: "hangup" }, external_id: "row1", webhook: input.webhook,
    });
    expect(b).not.toHaveProperty("voice");
    expect(buildCallBody({ ...input, voice: "Karen" })).toHaveProperty("voice", "Karen");
  });

  it("posts with a bare authorization header and returns the call id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: "success", call_id: "c-1" }), { status: 200 }));
    const r = await placeCall({ a: 1 }, "KEY", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, callId: "c-1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BLAND_CALLS_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("KEY");
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 });
  });

  it("fails closed without a key, on an error status, and on a network error", async () => {
    const f = vi.fn();
    expect(await placeCall({}, undefined, f as unknown as typeof fetch)).toMatchObject({ ok: false });
    expect(f).not.toHaveBeenCalled();
    const bad = vi.fn(async () => new Response(JSON.stringify({ status: "error", message: "nope" }), { status: 400 }));
    expect(await placeCall({}, "K", bad as unknown as typeof fetch)).toMatchObject({ ok: false, error: expect.stringContaining("400") });
    const boom = vi.fn(async () => { throw new Error("net"); });
    expect(await placeCall({}, "K", boom as unknown as typeof fetch)).toMatchObject({ ok: false });
  });

  it("webhookUrl needs both the secret and a base; redact hides the secret", () => {
    expect(webhookUrl({})).toBeNull();
    expect(webhookUrl({ BLAND_WEBHOOK_SECRET: "s" })).toBeNull();
    expect(webhookUrl({ BLAND_WEBHOOK_SECRET: "s", CONVEX_SITE_URL: "https://x.convex.site/" })).toBe("https://x.convex.site/bland/events?secret=s");
    expect(webhookUrl({ BLAND_WEBHOOK_SECRET: "s", CONVEX_SITE_URL: "https://x.convex.site" }, true)).toContain("secret=REDACTED");
  });
});
