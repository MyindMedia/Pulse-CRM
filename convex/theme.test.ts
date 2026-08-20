import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  contrastRatio,
  isHexColor,
  isThemeFont,
  PULSE_DEFAULT_COLORS,
  MIN_TEXT_CONTRAST,
} from "./lib/themeSpec";

/* White-label theming is what the $499.99 tier is FOR. These tests pin the
   two things that must never regress: only the top tier can theme, and the
   Powered by Pulse lockup cannot be removed at any tier or price. */

const OWNER = "u_owner";

async function seed(t: ReturnType<typeof convexTest>, orgId: string, tier: "studio" | "pro" | "label") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: "S", slug: orgId, plan: "solo", tier });
    await ctx.db.insert("members", {
      orgId, name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
  });
  return t.withIdentity({ subject: OWNER, orgId });
}

describe("theme spec helpers", () => {
  it("accepts 3 and 6 digit hex, rejects anything else", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#1A1A1A")).toBe(true);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
    // A CSS injection attempt must not survive validation.
    expect(isHexColor("#fff;background:url(x)")).toBe(false);
  });

  it("only allows fonts the app can serve", () => {
    expect(isThemeFont("Inter")).toBe(true);
    expect(isThemeFont("Comic Sans MS")).toBe(false);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 1);
    // Pulse's own defaults must pass the bar it enforces on customers.
    expect(
      contrastRatio(PULSE_DEFAULT_COLORS.background, PULSE_DEFAULT_COLORS.text),
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe("theme entitlement", () => {
  it("refuses to save on the entry tier, naming the tier that unlocks it", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_studio", "studio");
    await expect(
      asOwner.mutation(api.theme.save, { primary: "#FF0000" }),
    ).rejects.toMatchObject({
      data: { code: "UPGRADE_REQUIRED", requiredTier: "label", price: "$499.99" },
    });
  });

  it("refuses on the mid tier too", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_pro", "pro");
    await expect(
      asOwner.mutation(api.theme.save, { primary: "#FF0000" }),
    ).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
    expect(await asOwner.query(api.theme.canTheme, {})).toBe(false);
  });

  it("saves and paints on the top tier", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_label", "label");
    expect(await asOwner.query(api.theme.canTheme, {})).toBe(true);
    await asOwner.mutation(api.theme.save, {
      appName: "Vault Studios",
      primary: "#7C3AED",
      background: "#0B0B10",
      text: "#F5F5FF",
      fontHeading: "Sora",
      radius: "round",
    });
    const theme = await asOwner.query(api.theme.get, {});
    expect(theme.active).toBe(true);
    expect(theme.appName).toBe("Vault Studios");
    expect(theme.colors.primary).toBe("#7C3AED");
    expect(theme.cssVars["--brand-primary"]).toBe("#7C3AED");
    expect(theme.cssVars["--radius"]).toBe("18px");
    expect(theme.fontHeading).toBe("Sora");
  });
});

describe("theme guardrails", () => {
  it("rejects an unreadable text-on-background combination", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_contrast", "label");
    await expect(
      asOwner.mutation(api.theme.save, { background: "#1A1A1A", text: "#222222" }),
    ).rejects.toMatchObject({ data: { code: "THEME_CONTRAST" } });
  });

  it("catches a bad pair even when only one half is being changed", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_contrast2", "label");
    await asOwner.mutation(api.theme.save, { background: "#FFFFFF", text: "#000000" });
    // Now push the text toward the background in a second, separate save.
    await expect(
      asOwner.mutation(api.theme.save, { text: "#F0F0F0" }),
    ).rejects.toMatchObject({ data: { code: "THEME_CONTRAST" } });
  });

  it("rejects a font it cannot serve and a non-hex color", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_font", "label");
    await expect(
      asOwner.mutation(api.theme.save, { fontBody: "Comic Sans MS" }),
    ).rejects.toThrow();
    await expect(
      asOwner.mutation(api.theme.save, { primary: "rgb(1,2,3)" }),
    ).rejects.toThrow();
  });
});

describe("powered by Pulse", () => {
  it("is present at every tier, themed or not", async () => {
    for (const tier of ["studio", "pro", "label"] as const) {
      const t = convexTest(schema);
      const asOwner = await seed(t, `o_pbp_${tier}`, tier);
      const theme = await asOwner.query(api.theme.get, {});
      expect(theme.poweredByPulse).toBe(true);
    }
  });

  it("survives a fully customized theme", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_pbp_full", "label");
    await asOwner.mutation(api.theme.save, {
      appName: "Not Pulse", wordmark: "Not Pulse", primary: "#123456",
    });
    const theme = await asOwner.query(api.theme.get, {});
    expect(theme.poweredByPulse).toBe(true);
    expect(theme.appName).toBe("Not Pulse");
  });
});

describe("downgrade behaviour", () => {
  it("reverts to Pulse chrome without destroying the saved theme", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_down", "label");
    await asOwner.mutation(api.theme.save, { primary: "#7C3AED", appName: "Vault" });

    // Downgrade to the entry tier.
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "o_down")!;
      await ctx.db.patch(org._id, { tier: "studio" });
    });

    const theme = await asOwner.query(api.theme.get, {});
    expect(theme.active).toBe(false);
    expect(theme.appName).toBeNull();
    expect(theme.colors.primary).toBe(PULSE_DEFAULT_COLORS.primary);

    // The row still holds their work, so re-upgrading restores it.
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "o_down")!;
      expect(org.theme?.primary).toBe("#7C3AED");
      await ctx.db.patch(org._id, { tier: "label" });
    });
    const back = await asOwner.query(api.theme.get, {});
    expect(back.active).toBe(true);
    expect(back.colors.primary).toBe("#7C3AED");
  });

  it("reset clears the theme", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_reset", "label");
    await asOwner.mutation(api.theme.save, { primary: "#7C3AED" });
    await asOwner.mutation(api.theme.reset, {});
    const theme = await asOwner.query(api.theme.get, {});
    expect(theme.colors.primary).toBe(PULSE_DEFAULT_COLORS.primary);
  });
});
