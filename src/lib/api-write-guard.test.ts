import { describe, it, expect } from "vitest";
import { refuseCrossSiteWrite } from "./api-write-guard";

const req = (headers: Record<string, string>) =>
  new Request("https://studiopulse.tech/api/agency/email/inboxes", { method: "POST", headers });

describe("refuseCrossSiteWrite", () => {
  it("refuses a body that is not JSON with 415", () => {
    const r = refuseCrossSiteWrite(req({ "Content-Type": "text/plain", Origin: "https://studiopulse.tech" }));
    expect(r?.status).toBe(415);
    expect(refuseCrossSiteWrite(req({ "Content-Type": "application/x-www-form-urlencoded", Origin: "https://studiopulse.tech" }))?.status).toBe(415);
    expect(refuseCrossSiteWrite(req({ Origin: "https://studiopulse.tech" }))?.status).toBe(415);
  });

  it("refuses a cross-site Origin with 403", () => {
    const r = refuseCrossSiteWrite(req({ "Content-Type": "application/json", Origin: "https://evil.example" }));
    expect(r?.status).toBe(403);
    expect(refuseCrossSiteWrite(req({ "Content-Type": "application/json", Origin: "null" }))?.status).toBe(403);
  });

  it("refuses a browser write with no Origin and no bearer token", () => {
    expect(refuseCrossSiteWrite(req({ "Content-Type": "application/json" }))?.status).toBe(403);
  });

  it("allows a same-origin JSON write, with or without a charset", () => {
    expect(refuseCrossSiteWrite(req({ "Content-Type": "application/json", Origin: "https://studiopulse.tech" }))).toBeNull();
    expect(refuseCrossSiteWrite(req({ "Content-Type": "application/json; charset=utf-8", Origin: "https://studiopulse.tech" }))).toBeNull();
  });

  it("allows the configured app origin", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    try {
      expect(refuseCrossSiteWrite(req({ "Content-Type": "application/json", Origin: "https://app.example.com" }))).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it("allows a scripted bearer-token call that sends no Origin", () => {
    expect(refuseCrossSiteWrite(req({ "Content-Type": "application/json", Authorization: "Bearer sess_123" }))).toBeNull();
  });
});
