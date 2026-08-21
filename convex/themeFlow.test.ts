import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { PULSE_DEFAULT_COLORS } from "./lib/themeSpec";

/* The white-label flow end to end.

   The failure this guards against is the one that shipped first: fields
   stored and never rendered. Every surface a studio or its clients touch has
   to actually resolve the theme, and every tier below Label has to fall back
   to Pulse chrome without leaking a thing. */

const OWNER = "u_own";

async function studio(
  t: ReturnType<typeof convexTest>,
  tier: "studio" | "pro" | "label",
  theme?: Record<string, unknown>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Vault Studios", slug: "vault", plan: "solo",
      tier, status: "active", ...(theme ? { theme } : {}),
    } as never);
    await ctx.db.insert("members", {
      orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
  });
  return t.withIdentity({ subject: OWNER, orgId: "org1" });
}

const BRAND = {
  primary: "#7C3AED", accent: "#7C3AED", background: "#0B0B10",
  surface: "#141420", text: "#F5F5FF", muted: "#9A9AB0", border: "#26263A",
  appName: "Vault", loginHeadline: "Welcome back",
  loginSubhead: "Your rooms, your calendar.",
  emailHeaderColor: "#7C3AED", emailFooterText: "Vault Studios, Atlanta",
  fontHeading: "Sora",
};

describe("client-facing surfaces", () => {
  it("serves the studio's theme from its booking slug, with no auth", async () => {
    const t = convexTest(schema);
    await studio(t, "label", BRAND);
    // No identity: this is how a client actually arrives.
    const pub = await t.query(api.theme.publicBySlug, { slug: "vault" });
    expect(pub.active).toBe(true);
    expect(pub.colors.primary).toBe("#7C3AED");
    expect(pub.colors.background).toBe("#0B0B10");
    expect(pub.appName).toBe("Vault");
    expect(pub.fontHeading).toBe("Sora");
  });

  it("serves it from a magic-link grant token too", async () => {
    const t = convexTest(schema);
    await studio(t, "label", BRAND);
    await t.run((ctx) =>
      ctx.db.insert("collaboratorGrants", {
        orgId: "org1", token: "tok_abc", scope: "artist_portal",
        email: "ari@example.com", name: "Ari", entityId: "x",
        capabilities: [], expiresAt: Date.now() + 86_400_000,
        invitedBy: "u_own", useCount: 0,
      } as never),
    );
    const pub = await t.query(api.theme.publicByGrant, { token: "tok_abc" });
    expect(pub.active).toBe(true);
    expect(pub.colors.primary).toBe("#7C3AED");
  });

  it("falls back to Pulse chrome below the white-label tier", async () => {
    const t = convexTest(schema);
    await studio(t, "pro", BRAND);
    const pub = await t.query(api.theme.publicBySlug, { slug: "vault" });
    expect(pub.active).toBe(false);
    // A saved theme must not leak out to clients on a plan that does not
    // include it, even though the row still holds the studio's work.
    expect(pub.colors.primary).toBe(PULSE_DEFAULT_COLORS.primary);
    expect(pub.loginHeadline).toBeNull();
  });

  it("never drops the Pulse mark, on any surface or tier", async () => {
    const t = convexTest(schema);
    await studio(t, "label", BRAND);
    expect((await t.query(api.theme.publicBySlug, { slug: "vault" })).poweredByPulse).toBe(true);
  });

  it("says nothing about a slug that does not exist", async () => {
    const t = convexTest(schema);
    await studio(t, "label", BRAND);
    const pub = await t.query(api.theme.publicBySlug, { slug: "not-a-studio" });
    expect(pub.active).toBe(false);
    expect(pub.appName).toBeNull();
  });
});

describe("the sign-in door", () => {
  it("carries the login copy so the screen can render it", async () => {
    const t = convexTest(schema);
    await studio(t, "label", BRAND);
    const pub = await t.query(api.theme.publicBySlug, { slug: "vault" });
    // These were stored with zero consumers before: written, never shown.
    expect(pub.loginHeadline).toBe("Welcome back");
    expect(pub.loginSubhead).toBe("Your rooms, your calendar.");
  });
});

describe("client email", () => {
  it("wears the studio's accent and footer", async () => {
    const t = convexTest(schema);
    await studio(t, "label", BRAND);
    const e = await t.query(internal.theme._emailTheme, { orgId: "org1" });
    expect(e.active).toBe(true);
    expect(e.accent).toBe("#7C3AED");
    expect(e.footerText).toBe("Vault Studios, Atlanta");
    expect(e.appName).toBe("Vault");
  });

  it("falls back to the primary when no email accent was set", async () => {
    const t = convexTest(schema);
    const { emailHeaderColor: _drop, ...rest } = BRAND;
    await studio(t, "label", rest);
    const e = await t.query(internal.theme._emailTheme, { orgId: "org1" });
    expect(e.accent).toBe("#7C3AED");
  });

  it("stays Pulse gold for a studio below the white-label tier", async () => {
    const t = convexTest(schema);
    await studio(t, "pro", BRAND);
    const e = await t.query(internal.theme._emailTheme, { orgId: "org1" });
    expect(e.active).toBe(false);
    expect(e.accent).toBe(PULSE_DEFAULT_COLORS.primary);
    expect(e.footerText).toBeNull();
  });
});
