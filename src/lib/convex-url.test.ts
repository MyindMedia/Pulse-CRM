import { afterEach, describe, expect, it } from "vitest";
import { resolveConvexUrl } from "./convex-url";

/* This resolution is shared by convex-client-provider.tsx (the browser
   client) and the brand-card route (a server route talking to Convex
   directly). Production once shipped with NEXT_PUBLIC_CONVEX_URL unset on
   Netlify: the client provider had its own hardcoded fallback and kept
   working, while the brand-card route read the env var with no fallback and
   quietly 404'd every card. These pin the one resolution both now share, and
   specifically the empty-string case that `??` alone gets wrong (see the
   known appUrl() bug in convex/lib/links.ts - this must not repeat it). */

const ENV_KEY = "NEXT_PUBLIC_CONVEX_URL";
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe("resolveConvexUrl", () => {
  it("prefers the environment variable when it is set", () => {
    process.env[ENV_KEY] = "https://some-deployment.convex.cloud";
    expect(resolveConvexUrl()).toBe("https://some-deployment.convex.cloud");
  });

  it("falls back when the environment variable is absent", () => {
    delete process.env[ENV_KEY];
    expect(resolveConvexUrl()).toBe("https://pastel-corgi-340.convex.cloud");
  });

  it("falls back when the environment variable is an empty string", () => {
    // `??` alone would let "" win here and hand callers a client pointed at
    // nothing - the exact bug this helper exists to not repeat.
    process.env[ENV_KEY] = "";
    expect(resolveConvexUrl()).toBe("https://pastel-corgi-340.convex.cloud");
  });

  it("falls back when the environment variable is whitespace only", () => {
    process.env[ENV_KEY] = "   ";
    expect(resolveConvexUrl()).toBe("https://pastel-corgi-340.convex.cloud");
  });

  it("gives both consumers the same value for the same environment", () => {
    process.env[ENV_KEY] = "https://another-deployment.convex.cloud";
    const forClientProvider = resolveConvexUrl();
    const forBrandCardRoute = resolveConvexUrl();
    expect(forClientProvider).toBe(forBrandCardRoute);
  });
});
