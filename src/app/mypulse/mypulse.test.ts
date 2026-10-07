import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_GROUPS, NOT_BUILT_YET, PRICING, TIERS, featureTier } from "@convex/lib/pricing";

/* /mypulse: still internal, still behind its password, and the gate fails
   closed when MYPULSE_PASSWORD is not set. Its plan data comes from the
   pricing config. */

const cookieJar = new Map<string, string>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: ({ name }: { name: string }) => void cookieJar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ORIGINAL = process.env.MYPULSE_PASSWORD;

beforeEach(() => {
  cookieJar.clear();
  delete process.env.MYPULSE_PASSWORD;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MYPULSE_PASSWORD;
  else process.env.MYPULSE_PASSWORD = ORIGINAL;
});

describe("/mypulse gate", () => {
  it("is noindex, nofollow", async () => {
    const { metadata } = await import("./page");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("commits no password: there is no literal fallback in auth.ts", () => {
    const src = read("src/app/mypulse/auth.ts");
    expect(src).not.toMatch(/MYPULSE_PASSWORD\s*\|\|\s*["'`]/);
    expect(src).not.toMatch(/MYPULSE_PASSWORD\s*\?\?\s*["'`]/);
  });

  it("fails closed when MYPULSE_PASSWORD is unset", async () => {
    const auth = await import("./auth");
    expect(auth.gateConfigured()).toBe(false);
    expect(auth.accessToken()).toBeNull();
    for (const guess of ["", " ", "test-only-not-a-real-password", "password", "undefined", "null"]) {
      expect(auth.checkPassword(guess)).toBe(false);
    }
    cookieJar.set(auth.MYPULSE_COOKIE, "anything");
    expect(await auth.isUnlocked()).toBe(false);
  });

  it("fails closed when MYPULSE_PASSWORD is empty or blank", async () => {
    const auth = await import("./auth");
    for (const v of ["", "   "]) {
      process.env.MYPULSE_PASSWORD = v;
      expect(auth.checkPassword(v)).toBe(false);
      expect(auth.accessToken()).toBeNull();
    }
  });

  it("the unlock action refuses every password when unset", async () => {
    const { unlock } = await import("./actions");
    const fd = new FormData();
    fd.set("password", "test-only-not-a-real-password");
    const out = await unlock({ error: null }, fd);
    expect(out.error).toBeTruthy();
    expect(cookieJar.size).toBe(0);
  });

  it("opens only for the configured password and its cookie", async () => {
    process.env.MYPULSE_PASSWORD = "correct horse";
    const auth = await import("./auth");
    expect(auth.checkPassword("wrong")).toBe(false);
    expect(auth.checkPassword("correct horse")).toBe(true);
    expect(await auth.isUnlocked()).toBe(false);
    cookieJar.set(auth.MYPULSE_COOKIE, "forged");
    expect(await auth.isUnlocked()).toBe(false);
    cookieJar.set(auth.MYPULSE_COOKIE, auth.accessToken()!);
    expect(await auth.isUnlocked()).toBe(true);
  });

  it("serves only the unlock form while locked", async () => {
    const { default: MyPulsePage } = await import("./page");
    const { UnlockForm } = await import("./unlock-form");
    const el = (await MyPulsePage()) as { type: unknown };
    expect(el.type).toBe(UnlockForm);
  });

  it("stays behind its own gate in middleware, not a public index", () => {
    const mw = read("src/middleware.ts");
    expect(mw).toContain('"/mypulse"');
  });
});

describe("/mypulse data comes from the pricing config", () => {
  it("tags every row with its config tier and lists only built features", async () => {
    const { SECTIONS, TOTAL_FEATURES } = await import("./features");
    const built = FEATURE_GROUPS.flatMap((g) => g.items.filter((x) => x.built));
    expect(TOTAL_FEATURES).toBe(built.length);
    for (const s of SECTIONS) {
      for (const f of s.items) {
        expect(TIERS).toContain(f.tier);
        expect(f.tier).toBe(featureTier(f.name));
        expect(f.desc.length, f.name).toBeGreaterThan(0);
      }
    }
    const unbuilt = FEATURE_GROUPS.flatMap((g) => g.items.filter((x) => !x.built).map((x) => x.name));
    const shown = new Set(SECTIONS.flatMap((s) => s.items.map((f) => f.name)));
    for (const n of unbuilt) expect(shown.has(n), n).toBe(false);
  });

  it("plan cards use Core / Growth / Max from the config", async () => {
    const { TIERS_GUIDE } = await import("./features");
    expect(TIERS_GUIDE.map((t) => t.name)).toEqual(TIERS.map((t) => PRICING[t].name));
    expect(TIERS_GUIDE.map((t) => t.name)).toEqual(["Core", "Growth", "Max"]);
  });

  it("says Growth includes Core and Max includes Growth", async () => {
    const { includesLine } = await import("../pricing/model");
    expect(includesLine()).toBe("Growth includes everything in Core. Max includes everything in Growth.");
    expect(read("src/app/mypulse/page.tsx")).toContain("includesLine()");
  });

  it("the not-built list is the config's list", async () => {
    const { ROADMAP } = await import("./features");
    expect(ROADMAP.map((r) => r.title)).toEqual([...NOT_BUILT_YET]);
    for (const r of ROADMAP) expect(r.what.length, r.title).toBeGreaterThan(0);
  });

  it("hardcodes no test count", () => {
    const page = read("src/app/mypulse/page.tsx");
    expect(page).not.toMatch(/n:\s*["']\d{3,}["']/);
  });
});
