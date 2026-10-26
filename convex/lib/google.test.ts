import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { base64url, emailFromIdToken, gmailMime } from "./google";

/* Convex's default runtime has no Node `Buffer`. Hide it so a regression to
   Buffer fails here instead of failing every Gmail send in production. */
const g = globalThis as { Buffer?: unknown };
let saved: unknown;
beforeAll(() => {
  saved = g.Buffer;
  delete g.Buffer;
});
afterAll(() => {
  if (saved !== undefined) g.Buffer = saved;
});

function decode(b64u: string): string {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64u.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

describe("base64url", () => {
  it("round-trips UTF-8 without Buffer and uses the URL-safe alphabet", () => {
    const text = "Café session — see you at 8 ✓ ??>>";
    const out = base64url(text);
    expect(out).not.toMatch(/[+/=]/);
    expect(decode(out)).toBe(text);
  });
});

describe("emailFromIdToken", () => {
  it("reads the email from the id_token payload without Buffer", () => {
    const payload = base64url(JSON.stringify({ email: "studio@example.com", name: "Zoë" }));
    expect(emailFromIdToken(`h.${payload}.s`)).toBe("studio@example.com");
  });

  it("returns null for a missing or malformed token", () => {
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken("not-a-jwt")).toBeNull();
  });
});

describe("gmailMime", () => {
  it("leaves out From when no address is known, so Gmail fills it in", () => {
    const mime = gmailMime({ to: "a@b.com", subject: "Hi", html: "<p>x</p>" });
    expect(mime).not.toMatch(/^From:/m);
    expect(mime).toMatch(/^To: a@b\.com$/m);
  });

  it("keeps a real From address and encodes a non-ASCII subject", () => {
    const mime = gmailMime({ from: "s@x.com", to: "a@b.com", subject: "Session — confirmed", html: "" });
    expect(mime).toMatch(/^From: s@x\.com$/m);
    expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?.+\?=$/m);
  });
});
