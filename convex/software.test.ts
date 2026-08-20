import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { searchSoftwareCatalog, SOFTWARE_CATALOG } from "./lib/softwareCatalog";

async function ownerOf(t: ReturnType<typeof convexTest>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    // Software licenses ride the "licenses.edit" capability, which is a Label-tier
    // entitlement. plan "label" maps to that tier.
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, plan: "label", status: "active" });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

describe("software catalog", () => {
  it("has items and finds by name/vendor", () => {
    expect(SOFTWARE_CATALOG.length).toBeGreaterThan(20);
    const ids = new Set(SOFTWARE_CATALOG.map((s) => s.id));
    expect(ids.size).toBe(SOFTWARE_CATALOG.length); // unique ids
    expect(searchSoftwareCatalog("pro tools")[0].vendor).toBe("Avid");
    expect(searchSoftwareCatalog("fabfilter").length).toBeGreaterThan(0);
    expect(searchSoftwareCatalog("", "daw", 100).every((s) => s.category === "daw")).toBe(true);
    expect(searchSoftwareCatalog("zzznope")).toHaveLength(0);
  });
});

describe("software licenses", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("create → list; defaults to active", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    await o.mutation(api.software.create, {
      name: "Pro Tools", vendor: "Avid", category: "daw",
      licenseType: "subscription", costCents: 29900, billingInterval: "annual",
    });
    const rows = await o.query(api.software.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].vendor).toBe("Avid");
  });

  it("summary computes recurring cost + counts", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    await o.mutation(api.software.create, { name: "Splice", category: "subscription", licenseType: "subscription", costCents: 1300, billingInterval: "monthly" });
    await o.mutation(api.software.create, { name: "Logic Pro", category: "daw", licenseType: "perpetual", costCents: 19900, billingInterval: "one_time" });
    const s = await o.query(api.software.summary, {});
    expect(s.count).toBe(2);
    expect(s.annualRecurring).toBe(1300 * 12); // splice annualized
    expect(s.perpetualValue).toBe(19900);
    expect(s.subscriptions).toBe(1);
  });

  it("update + remove", async () => {
    const o = await ownerOf(t, "org_a", "u_a");
    const id = await o.mutation(api.software.create, { name: "FL Studio", category: "daw", licenseType: "perpetual", costCents: 19900, billingInterval: "one_time" });
    await o.mutation(api.software.update, { id, status: "expired", seats: 2 });
    const rows = await o.query(api.software.list, {});
    expect(rows[0].status).toBe("expired");
    expect(rows[0].seats).toBe(2);
    await o.mutation(api.software.remove, { id });
    expect(await o.query(api.software.list, {})).toHaveLength(0);
  });

  it("tenant isolation", async () => {
    const a = await ownerOf(t, "org_a", "u_a");
    const b = await ownerOf(t, "org_b", "u_b");
    const id = await a.mutation(api.software.create, { name: "Ableton", category: "daw", licenseType: "perpetual", costCents: 59900, billingInterval: "one_time" });
    expect(await b.query(api.software.list, {})).toHaveLength(0);
    await expect(b.mutation(api.software.remove, { id })).rejects.toThrow();
  });
});
