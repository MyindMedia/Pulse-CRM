import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/** Seed an org + owner and return an identity-bound client for it. */
async function ownerOf(t: ReturnType<typeof convexTest>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, plan: "studio", status: "active" });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

describe("feeTemplates", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("create → list returns it, active by default", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    await owner.mutation(api.feeTemplates.create, { label: "Mixing & Mastering", amountCents: 10000 });
    const rows = await owner.query(api.feeTemplates.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Mixing & Mastering");
    expect(rows[0].amountCents).toBe(10000);
    expect(rows[0].active).toBe(true);
  });

  it("rejects empty label and non-positive amount", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    await expect(owner.mutation(api.feeTemplates.create, { label: "  ", amountCents: 5000 })).rejects.toThrow();
    await expect(owner.mutation(api.feeTemplates.create, { label: "X", amountCents: 0 })).rejects.toThrow();
    await expect(owner.mutation(api.feeTemplates.create, { label: "X", amountCents: -100 })).rejects.toThrow();
  });

  it("update changes fields; active:false hides from activeOnly list", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const id = await owner.mutation(api.feeTemplates.create, { label: "Annual Maintenance", amountCents: 7900 });
    await owner.mutation(api.feeTemplates.update, { id, amountCents: 8500, active: false });
    const all = await owner.query(api.feeTemplates.list, {});
    expect(all[0].amountCents).toBe(8500);
    expect(all[0].active).toBe(false);
    const activeOnly = await owner.query(api.feeTemplates.list, { activeOnly: true });
    expect(activeOnly).toHaveLength(0);
  });

  it("remove deletes it", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const id = await owner.mutation(api.feeTemplates.create, { label: "Member Mix", amountCents: 6500 });
    await owner.mutation(api.feeTemplates.remove, { id });
    expect(await owner.query(api.feeTemplates.list, {})).toHaveLength(0);
  });

  it("tenant isolation: org B cannot see, update, or remove org A's fee", async () => {
    const a = await ownerOf(t, "org_a", "u_a");
    const b = await ownerOf(t, "org_b", "u_b");
    const idA = await a.mutation(api.feeTemplates.create, { label: "A fee", amountCents: 5000 });

    // B's list never shows A's fee
    expect(await b.query(api.feeTemplates.list, {})).toHaveLength(0);
    // B cannot mutate A's fee
    await expect(b.mutation(api.feeTemplates.update, { id: idA, amountCents: 1 })).rejects.toThrow();
    await expect(b.mutation(api.feeTemplates.remove, { id: idA })).rejects.toThrow();
    // A's fee is untouched
    const rowsA = await a.query(api.feeTemplates.list, {});
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].amountCents).toBe(5000);
  });
});
