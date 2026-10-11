import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* Owner rule, 2026-10-10: Pulse's AI features run on Claude (Lawrence's
   Anthropic key) first, with OpenAI and then Gemini behind it. These tests
   fake both SDKs and hold the routing: Claude answers first, decisions get
   high effort, JSON is schema-constrained, and any Claude failure falls
   through to OpenAI instead of failing the feature. */

const claudeCreate = vi.fn();
const openaiCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static BadRequestError = BadRequestError;
    beta = { messages: { create: claudeCreate } };
  }
  return { default: Anthropic };
});

vi.mock("openai", () => {
  class OpenAI {
    responses = { create: openaiCreate };
  }
  return { default: OpenAI };
});

const claudeAnswer = (text: string, stop_reason = "end_turn") => ({
  model: "claude-opus-5-5",
  stop_reason,
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text },
  ],
});

describe("AI routing: Claude first", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  beforeEach(() => {
    claudeCreate.mockReset();
    openaiCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-openai-test";
  });
  afterEach(() => {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.o === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.o;
  });

  it("answers routine copy from Claude at low effort, with the server-side refusal fallback on", async () => {
    const { complete } = await import("./openai");
    claudeCreate.mockResolvedValue(claudeAnswer("Hi Nova — your session is set."));
    const res = await complete("Write a confirmation.");
    expect(res).toMatchObject({ source: "anthropic", model: "claude-opus-5-5" });
    expect(res?.text).not.toMatch(/—/);
    expect(openaiCreate).not.toHaveBeenCalled();
    const req = claudeCreate.mock.calls[0][0];
    expect(req).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
    });
    expect(req.system).toContain("Never use em dashes");
  });

  it("gives decisions (SMART_MODEL callers) high effort", async () => {
    const { complete, SMART_MODEL } = await import("./openai");
    claudeCreate.mockResolvedValue(claudeAnswer("Chase the overdue invoice first."));
    await complete("What should the studio do next?", { model: SMART_MODEL });
    expect(claudeCreate.mock.calls[0][0].output_config).toMatchObject({ effort: "high" });
  });

  it("constrains JSON to the caller's schema and parses it", async () => {
    const { completeJSON } = await import("./openai");
    const schema = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false };
    claudeCreate.mockResolvedValue(claudeAnswer('{"reply":"Booked for Friday."}'));
    const res = await completeJSON<{ reply: string }>("Draft a reply.", { schema: { name: "reply", schema } });
    expect(res).toEqual({ source: "anthropic", model: "claude-opus-5-5", data: { reply: "Booked for Friday." } });
    expect(claudeCreate.mock.calls[0][0].output_config).toMatchObject({ format: { type: "json_schema", schema } });
  });

  it("asks again without the schema when the structured-output validator rejects it", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as unknown as {
      BadRequestError: new (status: number, message: string) => Error;
    };
    const { completeJSON } = await import("./openai");
    claudeCreate
      .mockRejectedValueOnce(new Anthropic.BadRequestError(400, "schema not supported"))
      .mockResolvedValueOnce(claudeAnswer('{"ok":true}'));
    const res = await completeJSON<{ ok: boolean }>("Check.", { schema: { name: "ok", schema: { type: "object" } } });
    expect(res?.data).toEqual({ ok: true });
    expect(claudeCreate).toHaveBeenCalledTimes(2);
    expect(claudeCreate.mock.calls[1][0].output_config.format).toBeUndefined();
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("falls through to OpenAI when Claude errors or refuses", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as unknown as {
      APIError: new (status: number, message: string) => Error;
    };
    const { complete } = await import("./openai");
    openaiCreate.mockResolvedValue({ output_text: "From the backup." });

    claudeCreate.mockRejectedValueOnce(new Anthropic.APIError(529, "overloaded"));
    expect(await complete("Recap.")).toMatchObject({ source: "openai", text: "From the backup." });

    claudeCreate.mockResolvedValueOnce(claudeAnswer("", "refusal"));
    expect(await complete("Recap.")).toMatchObject({ source: "openai" });
  });

  it("skips Claude entirely when no Anthropic key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { complete, hasAI } = await import("./openai");
    openaiCreate.mockResolvedValue({ output_text: "OpenAI only." });
    expect(await complete("Recap.")).toMatchObject({ source: "openai" });
    expect(claudeCreate).not.toHaveBeenCalled();
    expect(hasAI()).toBe(true);
  });
});
