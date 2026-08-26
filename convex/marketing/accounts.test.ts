import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

describe("marketing accounts", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      // tier: "studio" (the new, cap-checked tier key) is set explicitly:
      // orgs.plan is the legacy 3-value field and PLAN_TO_TIER maps its
      // "studio" literal to the new "pro" (unlimited) tier, not the new
      // "studio" tier, so the cap test below needs the cached tier field.
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", tier: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      await ctx.db.insert("members", { orgId: "org2", name: "Owner2", role: "owner", clerkUserId: "u2", skills: [] });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
  const owner2 = () => t.withIdentity({ subject: "u2", name: "Owner2", orgId: "org2" });

  it("startConnect is simulated without GHL env", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    expect(await owner().action(api.marketing.accounts.startConnect, { platform: "instagram" })).toEqual({ simulated: true });
  });

  it("insertInternal refuses a GHL account id already owned by another org", async () => {
    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Studio IG", connectedBy: "u1",
    });
    await expect(t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org2", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Stolen", connectedBy: "u2",
    })).rejects.toThrow(/already connected/);
  });

  it("studio tier caps connected accounts at 3", async () => {
    for (const n of [1, 2, 3]) {
      await t.mutation(internal.marketing.accounts.insertInternal, {
        orgId: "org1", platform: "facebook", ghlAccountId: `acc_${n}`, ghlLocationId: "loc", name: `P${n}`, connectedBy: "u1",
      });
    }
    await expect(t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "facebook", ghlAccountId: "acc_4", ghlLocationId: "loc", name: "P4", connectedBy: "u1",
    })).rejects.toThrow(/LIMIT_REACHED|limit/i);
  });

  it("list returns only the caller's org and remove soft-deletes", async () => {
    const id = await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Studio IG", connectedBy: "u1",
    });
    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org2", platform: "instagram", ghlAccountId: "acc_9", ghlLocationId: "loc", name: "Other", connectedBy: "u2",
    });
    expect((await owner().query(api.marketing.accounts.list, {})).map((a) => a.name)).toEqual(["Studio IG"]);
    await owner().mutation(api.marketing.accounts.remove, { id });
    expect(await owner().query(api.marketing.accounts.list, {})).toEqual([]);
    expect((await owner2().query(api.marketing.accounts.list, {})).map((a) => a.name)).toEqual(["Other"]);
  });

  it("remove-then-reattach the same ghlAccountId at cap keeps the cap honest", async () => {
    const ids: Id<"socialAccounts">[] = [];
    for (const n of [1, 2, 3]) {
      ids.push(await t.mutation(internal.marketing.accounts.insertInternal, {
        orgId: "org1", platform: "facebook", ghlAccountId: `acc_${n}`, ghlLocationId: "loc", name: `P${n}`, connectedBy: "u1",
      }));
    }
    await owner().mutation(api.marketing.accounts.remove, { id: ids[0] });
    // Reattaching the removed account must not free a permanent slot: the
    // org is back to 3 live rows, so a 4th distinct account is still refused.
    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "facebook", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "P1 reattached", connectedBy: "u1",
    });
    await expect(t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "facebook", ghlAccountId: "acc_4", ghlLocationId: "loc", name: "P4", connectedBy: "u1",
    })).rejects.toThrow(/LIMIT_REACHED|limit/i);
    const live = await owner().query(api.marketing.accounts.list, {});
    expect(live.length).toBe(3);
    const usage = await t.run(async (ctx) => {
      const rows = await ctx.db.query("usageCounters").collect();
      return rows.find((r) => r.orgId === "org1" && r.metric === "social_accounts")?.value;
    });
    expect(usage).toBe(3);
  });

  it("reviving a needs_reconnect row does not change the usage counter", async () => {
    const id = await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Studio IG", connectedBy: "u1",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { status: "needs_reconnect" });
    });
    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Studio IG reconnected", connectedBy: "u1",
    });
    const usage = await t.run(async (ctx) => {
      const rows = await ctx.db.query("usageCounters").collect();
      return rows.find((r) => r.orgId === "org1" && r.metric === "social_accounts")?.value;
    });
    expect(usage).toBe(1);
  });
});
