import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest, type NextFetchEvent } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: () => () => undefined,
  createRouteMatcher: () => () => false,
}));

const {
  default: middleware,
  isProductionUiLab,
  DEMO_FORM_URL,
  demoRedirectUrl,
} = await import("./middleware");

/* The UI lab is staging only: production must answer it with a real 404
   status, which only the middleware can set (the page streams a 200). */
describe("UI lab gate", () => {
  it("404s the lab and its sub-paths in production only", () => {
    expect(isProductionUiLab("/ui-lab", false)).toBe(true);
    expect(isProductionUiLab("/ui-lab/anything", false)).toBe(true);
    expect(isProductionUiLab("/ui-lab", true)).toBe(false);
    expect(isProductionUiLab("/ui-labs", false)).toBe(false);
    expect(isProductionUiLab("/dashboard", false)).toBe(false);
  });
});

/* /demo is the call to action in outreach emails, ads and social posts, and
   attribution rides on its query string (UTM tags, fbclid, gclid). The
   redirect has to carry that string to the intake form or the lead record
   arrives with no source. */
describe("/demo redirect", () => {
  // Spelled out, not imported: a bare /demo must keep landing on exactly this.
  const FORM = "https://zuops.com/f/pulse-30-minute-demo-intake-draft-fbib";
  const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
  const visit = (pathAndQuery: string, headers?: Record<string, string>) =>
    middleware(new NextRequest(`https://studiopulse.tech${pathAndQuery}`, { headers }), event);

  it("carries UTM tags and click ids through to the form", async () => {
    const res = await visit("/demo?utm_source=x&fbclid=y");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${FORM}?utm_source=x&fbclid=y`);
  });

  it("leaves a bare /demo exactly as it was", async () => {
    const res = await visit("/demo");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(FORM);
  });

  it("treats an empty query string as bare", async () => {
    const res = await visit("/demo?");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(FORM);
  });

  /* Compared as parsed parameters, not as text: the Next server may re-encode
     a value on the way in (%20 arrives as +), which reads back the same. */
  it("keeps every parameter: encoded values, order and repeats", async () => {
    const query = "?utm_source=instagram&utm_medium=social&utm_campaign=ig%20tour&utm_content=a%26b&gclid=1&gclid=2";
    const res = await visit(`/demo${query}`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(FORM);
    expect([...location.searchParams]).toEqual([
      ["utm_source", "instagram"],
      ["utm_medium", "social"],
      ["utm_campaign", "ig tour"],
      ["utm_content", "a&b"],
      ["gclid", "1"],
      ["gclid", "2"],
    ]);
  });

  it("only ever redirects to the form, whatever the query says", async () => {
    const res = await visit("/demo?next=https://evil.example/&to=//evil.example");
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(FORM);
  });

  it("still clears the stale client cookie on a tagged redirect", async () => {
    const res = await visit("/demo?utm_source=x", { cookie: "__client=stale" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${FORM}?utm_source=x`);
    expect(res.headers.get("set-cookie")).toContain("__client=;");
  });

  it("does not redirect look-alike paths", async () => {
    for (const path of ["/demos?utm_source=x", "/demo/extra?utm_source=x"]) {
      const res = await visit(path);
      expect(res.status).not.toBe(302);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("builds the address from one constant", () => {
    expect(DEMO_FORM_URL).toBe(FORM);
    expect(demoRedirectUrl("")).toBe(FORM);
    expect(demoRedirectUrl("?gclid=abc")).toBe(`${FORM}?gclid=abc`);
  });

  /* netlify.toml carries the same redirect. Netlify forwards the query string
     on a 302 by itself, but only while the rule stays plain: the same form
     address, no query string of its own and no query condition (a condition
     makes the rule match only links that carry exactly those parameters). */
  it("netlify.toml keeps a plain rule to the same form", () => {
    const toml = readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8");
    const rule = toml
      .split(/^\[\[/m)
      .find((block) => block.startsWith("redirects]]") && /^\s*from\s*=\s*"\/demo"\s*$/m.test(block));
    expect(rule).toBeDefined();
    expect(rule!.match(/^\s*to\s*=\s*"([^"]*)"/m)?.[1]).toBe(DEMO_FORM_URL);
    expect(rule!).toMatch(/^\s*status\s*=\s*302\s*$/m);
    expect(rule!).not.toMatch(/^\s*(\[redirects\.)?query\b/m);
  });
});
