import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST, GET } from "./route";

/* Behavioral coverage for the ADMIN_SECRET-gated newsletter endpoint. No
   network: RESEND_API_KEY stays unset, so every send resolves to "simulated"
   (batch) or a pre-flight failure (broadcast without an audience). */

const SECRET = "test-admin-secret";

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return POST(
    new Request("https://pulse.test/api/admin/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

const auth = { authorization: `Bearer ${SECRET}` };

const saved: Record<string, string | undefined> = {};
for (const k of ["ADMIN_SECRET", "RESEND_API_KEY", "RESEND_AUDIENCE_ID", "RESEND_FROM"]) {
  saved[k] = process.env[k];
}

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_AUDIENCE_ID;
  process.env.ADMIN_SECRET = SECRET;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST /api/admin/newsletter auth", () => {
  it("503 when ADMIN_SECRET is not configured", async () => {
    delete process.env.ADMIN_SECRET;
    const res = await post({ subject: "s", html: "<p>h</p>" }, auth);
    expect(res.status).toBe(503);
  });

  it("401 with no credentials", async () => {
    const res = await post({ subject: "s", html: "<p>h</p>" });
    expect(res.status).toBe(401);
  });

  it("401 with the wrong secret", async () => {
    const res = await post({ subject: "s", html: "<p>h</p>" }, { authorization: "Bearer nope" });
    expect(res.status).toBe(401);
  });

  it("accepts the x-admin-secret header form", async () => {
    const res = await post(
      { mode: "batch", subject: "s", html: "<p>h</p>", recipients: ["a@b.com"] },
      { "x-admin-secret": SECRET },
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/newsletter validation", () => {
  it("400 on invalid JSON", async () => {
    const res = await post(undefined, auth, "{not json");
    expect(res.status).toBe(400);
  });

  it("400 when subject/html missing", async () => {
    const res = await post({ subject: "" }, auth);
    expect(res.status).toBe(400);
  });

  it("400 for batch mode with no recipients", async () => {
    const res = await post({ mode: "batch", subject: "s", html: "<p>h</p>" }, auth);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/recipients/);
  });
});

describe("POST /api/admin/newsletter send paths (no Resend key)", () => {
  it("batch send no-ops to simulated when RESEND_API_KEY unset", async () => {
    const res = await post(
      { mode: "batch", subject: "Issue #1", html: "<h1>Hi</h1>", recipients: ["a@b.com", "c@d.com"] },
      auth,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; mode: string; status: string };
    expect(json.mode).toBe("batch");
    expect(json.status).toBe("simulated");
  });

  it("broadcast fails cleanly without an audience id", async () => {
    const res = await post({ subject: "Issue #1", html: "<h1>Hi</h1>" }, auth);
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; status: string; reason?: string };
    expect(json.ok).toBe(false);
    expect(json.reason).toMatch(/RESEND_AUDIENCE_ID/);
  });

  it("broadcast no-ops to simulated when audience set but key unset", async () => {
    process.env.RESEND_AUDIENCE_ID = "aud_123";
    const res = await post({ subject: "Issue #1", html: "<h1>Hi</h1>" }, auth);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("simulated");
  });
});

describe("GET /api/admin/newsletter readiness", () => {
  it("401 unauthenticated", async () => {
    const res = await GET(new Request("https://pulse.test/api/admin/newsletter"));
    expect(res.status).toBe(401);
  });

  it("reports wired env pieces when authorized", async () => {
    const res = await GET(
      new Request("https://pulse.test/api/admin/newsletter", { headers: auth }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ready: { resendApiKey: boolean; audienceId: boolean } };
    expect(json.ready.resendApiKey).toBe(false);
    expect(json.ready.audienceId).toBe(false);
  });
});
