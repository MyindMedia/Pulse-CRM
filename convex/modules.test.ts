import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  MODULES, MODULE_KEYS, TOGGLEABLE_KEYS, AREA_ORDER, AREA_LABELS,
  moduleBoard, isToggleable, moduleFor, tierForModule,
} from "./lib/modules";
import { effectiveDisabledFeatures, moduleEnabled, capabilitiesForTier } from "./lib/entitlements";
import { PLAN_LIMITS, SELLABLE_TIERS, type CapabilityKey } from "./lib/plans";

/* A module toggle that only hides the nav is decoration. These tests pin the
   thing that makes it real: switching a module off refuses the API call. */

const OWNER = "u_owner";

async function seed(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  tier: "studio" | "pro" | "label",
  disabledFeatures: string[] = [],
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name: "S", slug: orgId, plan: "solo", tier, disabledFeatures,
    });
    await ctx.db.insert("members", {
      orgId, name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
  });
  return t.withIdentity({ subject: OWNER, orgId });
}

describe("module registry", () => {
  it("covers every capability the plans sell", () => {
    const sold = new Set<CapabilityKey>();
    for (const t of SELLABLE_TIERS) for (const c of PLAN_LIMITS[t].capabilities) sold.add(c);
    for (const c of sold) {
      expect(moduleFor(c), `capability "${c}" has no module row`).not.toBeNull();
    }
  });

  it("has no module the plans do not sell", () => {
    for (const k of MODULE_KEYS) {
      expect(tierForModule(k), `module "${k}" is sold by no tier`).not.toBeNull();
    }
  });

  it("groups into the fourteen catalog areas, and renders every one", () => {
    expect(AREA_ORDER).toHaveLength(14);
    expect(AREA_LABELS.platform).toBe("Platform & security");
    expect(AREA_LABELS.agency).toBe("Agency & multi-studio");
    const board = moduleBoard();
    expect(board).toHaveLength(14);
    // No empty group: an area with no switches still shows its always-on rows.
    for (const g of board) {
      expect(g.modules.length + g.alwaysOn.length, `${g.area} is empty`).toBeGreaterThan(0);
    }
  });

  it("protects the core modules from being switched off", () => {
    const core = MODULES.filter((m) => m.core).map((m) => m.key);
    expect(core).toContain("bookings");
    expect(core).toContain("calendar");
    for (const k of core) expect(isToggleable(k)).toBe(false);
    expect(TOGGLEABLE_KEYS).not.toContain("bookings");
  });

  it("exposes white label as a real, switchable module", () => {
    const wl = moduleFor("whiteLabelUi");
    expect(wl).not.toBeNull();
    expect(wl!.area).toBe("brand");
    expect(isToggleable("whiteLabelUi")).toBe(true);
    expect(tierForModule("whiteLabelUi")).toBe("label");
  });
});

describe("toggle semantics", () => {
  it("a switched-off module is not enabled", () => {
    expect(moduleEnabled("label", ["whiteLabelUi"], "whiteLabelUi")).toBe(false);
    expect(moduleEnabled("label", [], "whiteLabelUi")).toBe(true);
  });

  it("a toggle can never unlock what the plan excludes", () => {
    // Nothing in the disabled list can grant patch to a Studio-tier org.
    expect(moduleEnabled("studio", [], "patch")).toBe(false);
    const eff = effectiveDisabledFeatures("studio", []);
    expect(eff).toContain("patch");
  });

  it("covers behaviour modules, not just nav ones", () => {
    // The old system only merged nav keys, so switching off payroll or the
    // receptionist did nothing at all.
    const eff = effectiveDisabledFeatures("label", ["payroll", "aiReceptionist", "dunning"]);
    expect(eff).toContain("payroll");
    expect(eff).toContain("aiReceptionist");
    expect(eff).toContain("dunning");
  });
});

describe("the switchboard", () => {
  it("reports owned, enabled and locked per module", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_board", "pro", ["reports"]);
    const board = await asOwner.query(api.modules.board, {});

    const flat = board.areas.flatMap((a) => a.modules);
    const reports = flat.find((m) => m.key === "reports")!;
    const patch = flat.find((m) => m.key === "patch")!;
    const bookings = flat.find((m) => m.key === "bookings")!;

    expect(reports.owned).toBe(true);
    expect(reports.enabled).toBe(false);      // switched off by choice
    expect(reports.switchable).toBe(true);

    expect(patch.owned).toBe(false);          // not on this plan
    expect(patch.lockedReason).toBe("tier");
    expect(patch.tierLabel).toBe("Label");

    expect(bookings.core).toBe(true);
    expect(bookings.switchable).toBe(false);
    expect(bookings.lockedReason).toBe("core");

    expect(board.counts.offByChoice).toBe(1);
    expect(board.counts.lockedByTier).toBeGreaterThan(0);
  });

  it("lets an owner switch a module off and back on", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_toggle", "label");
    await asOwner.mutation(api.modules.setModule, { key: "payroll", enabled: false });
    expect(await t.run((ctx) => import("./lib/entitlements").then(async (m) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "o_toggle")!;
      return m.moduleEnabled("label", org.disabledFeatures, "payroll");
    }))).toBe(false);

    await asOwner.mutation(api.modules.setModule, { key: "payroll", enabled: true });
    const board = await asOwner.query(api.modules.board, {});
    const payroll = board.areas.flatMap((a) => a.modules).find((m) => m.key === "payroll")!;
    expect(payroll.enabled).toBe(true);
  });

  it("refuses to switch off a core module", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_core", "label");
    await expect(
      asOwner.mutation(api.modules.setModule, { key: "bookings", enabled: false }),
    ).rejects.toMatchObject({ data: { code: "MODULE_CORE" } });
  });

  it("refuses to switch on something the plan excludes", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_upgrade", "studio");
    await expect(
      asOwner.mutation(api.modules.setModule, { key: "payroll", enabled: true }),
    ).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
  });

  it("enableAll restores everything the plan includes", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_restore", "label", ["payroll", "reports", "patch"]);
    const res = await asOwner.mutation(api.modules.enableAll, {});
    expect(res.restored).toBe(3);
    const board = await asOwner.query(api.modules.board, {});
    expect(board.counts.offByChoice).toBe(0);
  });
});

describe("enforcement, not decoration", () => {
  it("refuses the API call for a switched-off module", async () => {
    const t = convexTest(schema);
    // Owns white label, but somebody switched it off.
    const asOwner = await seed(t, "o_off", "label", ["whiteLabelUi"]);
    await expect(
      asOwner.mutation(api.theme.save, { primary: "#7C3AED" }),
    ).rejects.toMatchObject({
      data: { code: "MODULE_DISABLED", capability: "whiteLabelUi", label: "White-label UI" },
    });
    // And the read path agrees, so the settings panel hides itself.
    expect(await asOwner.query(api.theme.canTheme, {})).toBe(false);
  });

  it("says upgrade when unowned and switched-off when owned", async () => {
    const t = convexTest(schema);
    const unowned = await seed(t, "o_unowned", "pro");
    await expect(
      unowned.mutation(api.theme.save, { primary: "#7C3AED" }),
    ).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });

    const off = await seed(t, "o_switched", "label", ["whiteLabelUi"]);
    await expect(
      off.mutation(api.theme.save, { primary: "#7C3AED" }),
    ).rejects.toMatchObject({ data: { code: "MODULE_DISABLED" } });
  });

  it("lets the call through once the module is switched back on", async () => {
    const t = convexTest(schema);
    const asOwner = await seed(t, "o_backon", "label", ["whiteLabelUi"]);
    await asOwner.mutation(api.modules.setModule, { key: "whiteLabelUi", enabled: true });
    await asOwner.mutation(api.theme.save, { primary: "#7C3AED" });
    const theme = await asOwner.query(api.theme.get, {});
    expect(theme.colors.primary).toBe("#7C3AED");
  });

  it("drops unknown and core keys written by a client", async () => {
    const t = convexTest(schema);
    await seed(t, "o_clean", "label");
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "o_clean")!;
      await ctx.db.patch(org._id, { disabledFeatures: ["bookings", "nonsense", "payroll"] });
    });
    // A hand-edited or stale row must not disable a core module.
    const eff = effectiveDisabledFeatures("label", ["bookings", "nonsense", "payroll"]);
    expect(eff).not.toContain("bookings");
    expect(eff).not.toContain("nonsense");
    expect(eff).toContain("payroll");
  });
});
