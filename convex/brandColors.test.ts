import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { brandSecondaryOf, isHexColor } from "./lib/brandPresets";

/* Brand colors (feature F): every plan can pick a preset or custom colors;
   the server resolves presets itself and validates every hex. */
describe("branding.setBrandColors", () => {
  let t: ReturnType<typeof convexTest>;
  const as = (subject: string) =>
    t.withIdentity({ subject, name: subject, orgId: "org_s1" } as { subject: string; name: string; orgId: string });

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s1",
        name: "Core Studio",
        slug: "core",
        tier: "core",
        status: "active",
      });
      await ctx.db.insert("members", { orgId: "org_s1", name: "Owner", role: "owner", clerkUserId: "u_owner", skills: [] });
      await ctx.db.insert("members", { orgId: "org_s1", name: "Intern", role: "intern", clerkUserId: "u_intern", skills: [] });
    });
  });

  const readOrg = () => t.run(async (ctx) => ctx.db.query("orgs").first());

  it("saves a preset on the Core plan, with the server's own colors", async () => {
    await as("u_owner").mutation(api.branding.setBrandColors, { preset: "midnight-blue" });
    const org = await readOrg();
    expect(org?.accentColor).toBe("#7a9bef");
    expect(org?.brandPalette).toEqual(["#7a9bef", "#3557c9"]);
    expect(org?.brandPreset).toBe("midnight-blue");
    const current = await as("u_owner").query(api.orgs.current, {});
    expect(current!.brandPreset).toBe("midnight-blue");
    expect(current!.brandSecondary).toBe("#3557c9");
  });

  it("ignores client colors sent with a named preset", async () => {
    await as("u_owner").mutation(api.branding.setBrandColors, {
      preset: "crimson",
      primary: "#123456",
      secondary: "#654321",
    });
    const org = await readOrg();
    expect(org?.accentColor).toBe("#ed7e81");
  });

  it("saves custom colors, lowercased", async () => {
    await as("u_owner").mutation(api.branding.setBrandColors, {
      preset: "custom",
      primary: "#AABBCC",
      secondary: "#112233",
    });
    const org = await readOrg();
    expect(org?.accentColor).toBe("#aabbcc");
    expect(org?.brandPalette).toEqual(["#aabbcc", "#112233"]);
    expect(org?.brandPreset).toBe("custom");
  });

  it("rejects bad hex values and unknown presets", async () => {
    await expect(
      as("u_owner").mutation(api.branding.setBrandColors, { preset: "custom", primary: "red" }),
    ).rejects.toThrow(/hex/);
    await expect(
      as("u_owner").mutation(api.branding.setBrandColors, { preset: "custom", primary: "#aabbcc", secondary: "#xyz123" }),
    ).rejects.toThrow(/hex/);
    await expect(
      as("u_owner").mutation(api.branding.setBrandColors, { preset: "custom", primary: "#aabbcc;}body{x" }),
    ).rejects.toThrow(/hex/);
    await expect(as("u_owner").mutation(api.branding.setBrandColors, { preset: "neon" })).rejects.toThrow(/preset/);
    const org = await readOrg();
    expect(org?.accentColor).toBeUndefined();
  });

  it("needs branding.edit", async () => {
    await expect(as("u_intern").mutation(api.branding.setBrandColors, { preset: "violet" })).rejects.toThrow();
    expect((await readOrg())?.brandPreset).toBeUndefined();
  });

  it("orgs.update now validates the accent too", async () => {
    await expect(as("u_owner").mutation(api.orgs.update, { accentColor: "url(x)" })).rejects.toThrow(/hex/);
    await as("u_owner").mutation(api.orgs.update, { accentColor: "#336699" });
    expect((await readOrg())?.accentColor).toBe("#336699");
  });

  it("off path: a studio that never chose colors reads as stock with no secondary", async () => {
    const current = await as("u_owner").query(api.orgs.current, {});
    expect(current!.accentColor).toBe("#fdb913");
    expect(current!.brandPreset).toBeNull();
    expect(current!.brandSecondary).toBeNull();
  });
});

describe("brandPresets helpers", () => {
  it("isHexColor", () => {
    expect(isHexColor("#a1b2c3")).toBe(true);
    expect(isHexColor("a1b2c3")).toBe(false);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it("a logo-extracted palette is not a chosen secondary", () => {
    expect(brandSecondaryOf({ brandPalette: ["#111111", "#222222"] })).toBeNull();
    expect(brandSecondaryOf({ brandPreset: "custom", brandPalette: ["#111111", "#22AA22"] })).toBe("#22aa22");
  });
});
