import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail } from "./email";

afterEach(() => { vi.restoreAllMocks(); delete process.env.RESEND_API_KEY; });

describe("sendEmail", () => {
  it("returns 'simulated' when RESEND_API_KEY is unset", async () => {
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("simulated");
  });

  it("POSTs to Resend and returns 'sent' on ok", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "e1" }), { status: 200 }),
    );
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ to: ["a@b.com"], subject: "Hi" });
  });

  it("returns 'failed' on non-ok response", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("failed");
  });

  it("returns 'failed' when the network call throws", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network error"));
    const status = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(status).toBe("failed");
  });
});
