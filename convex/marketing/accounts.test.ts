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

  it("limitStatus reports usage against the studio cap and null for an unlimited tier", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org3", name: "U", slug: "unlimited", plan: "studio", tier: "pro", status: "active" });
      await ctx.db.insert("members", { orgId: "org3", name: "Owner3", role: "owner", clerkUserId: "u3", skills: [] });
    });
    const owner3 = t.withIdentity({ subject: "u3", name: "Owner3", orgId: "org3" });

    expect(await owner().query(api.marketing.accounts.limitStatus, {})).toEqual({ used: 0, cap: 3, tierLabel: "Studio" });

    for (const n of [1, 2]) {
      await t.mutation(internal.marketing.accounts.insertInternal, {
        orgId: "org1", platform: "facebook", ghlAccountId: `acc_${n}`, ghlLocationId: "loc", name: `P${n}`, connectedBy: "u1",
      });
    }
    expect(await owner().query(api.marketing.accounts.limitStatus, {})).toEqual({ used: 2, cap: 3, tierLabel: "Studio" });

    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org3", platform: "facebook", ghlAccountId: "acc_unlimited_1", ghlLocationId: "loc", name: "P1", connectedBy: "u3",
    });
    const unlimited = await owner3.query(api.marketing.accounts.limitStatus, {});
    expect(unlimited.cap).toBeNull();
    expect(unlimited.used).toBe(1);
  });
});

describe("account health sweep", () => {
  let t: ReturnType<typeof convexTest>;
  const now = Date.now();

  beforeEach(async () => {
    t = convexTest(schema);
    vi.stubEnv("GHL_API_KEY", "pit_default");
    vi.stubEnv("GHL_LOCATION_ID", "loc_default");
    vi.stubEnv("GHL_SOCIAL_USER_ID", "user_pulse");
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "studio", status: "active" });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function addAccount(orgId: string, ghlAccountId: string, status: "connected" | "needs_reconnect" | "removed" = "connected", ghlLocationId = "loc_default") {
    return await t.run(async (ctx) => ctx.db.insert("socialAccounts", {
      orgId, platform: "instagram", ghlAccountId, ghlLocationId, name: "IG",
      status, connectedBy: "u1", connectedAt: now,
    }));
  }
  async function statusOf(id: Id<"socialAccounts">) {
    return (await t.run(async (ctx) => ctx.db.get(id)))!.status;
  }
  function ghlResponse(results: Array<{ id: string; isExpired?: boolean; deleted?: boolean }>) {
    return vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }));
  }

  it("marks an expired account needs_reconnect", async () => {
    const id = await addAccount("org1", "acc_1");
    vi.stubGlobal("fetch", ghlResponse([{ id: "acc_1", isExpired: true, deleted: false }]));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("needs_reconnect");
  });

  it("marks a deleted account needs_reconnect", async () => {
    const id = await addAccount("org1", "acc_1");
    vi.stubGlobal("fetch", ghlResponse([{ id: "acc_1", isExpired: false, deleted: true }]));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("needs_reconnect");
  });

  it("marks an account needs_reconnect when GHL no longer lists it at all", async () => {
    const id = await addAccount("org1", "acc_1");
    vi.stubGlobal("fetch", ghlResponse([]));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("needs_reconnect");
  });

  it("leaves a healthy account connected", async () => {
    const id = await addAccount("org1", "acc_1");
    vi.stubGlobal("fetch", ghlResponse([{ id: "acc_1", isExpired: false, deleted: false }]));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("connected");
  });

  it("restores a previously broken account once GHL reports it healthy again", async () => {
    const id = await addAccount("org1", "acc_1", "needs_reconnect");
    vi.stubGlobal("fetch", ghlResponse([{ id: "acc_1", isExpired: false, deleted: false }]));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("connected");
  });

  it("changes nothing when the GHL call fails", async () => {
    const connectedId = await addAccount("org1", "acc_1", "connected");
    const brokenId = await addAccount("org1", "acc_2", "needs_reconnect");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Invalid JWT" }), { status: 401 })));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    // A 401 across the whole location must not read as "every account here
    // is gone" - the connected row stays connected and the already-broken
    // row is not touched either way (no false recovery, no double-marking).
    expect(await statusOf(connectedId)).toBe("connected");
    expect(await statusOf(brokenId)).toBe("needs_reconnect");
  });

  it("changes nothing on a network failure (fetch throws)", async () => {
    const id = await addAccount("org1", "acc_1", "connected");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("connected");
  });

  it("never touches a removed account", async () => {
    const id = await addAccount("org1", "acc_1", "removed");
    vi.stubGlobal("fetch", ghlResponse([]));
    await t.action(internal.marketing.accounts.accountHealthSweep, {});
    expect(await statusOf(id)).toBe("removed");
  });

  it("is a no-op in simulated mode instead of crashing", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    const id = await addAccount("org1", "acc_1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.marketing.accounts.accountHealthSweep, {}); // does not throw
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe("connected");
  });

  it("never sends one org's account ids into another org's GHL call", async () => {
    vi.stubEnv("GHL_TOKEN_ORG2", "pit_org2");
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org2", name: "T", slug: "other", plan: "studio", tier: "studio", status: "active",
        ghl: { locationId: "loc_org2", tokenRef: "GHL_TOKEN_ORG2" },
      });
    });
    const org1AccountId = await addAccount("org1", "acc_org1", "connected", "loc_default");
    const org2AccountId = await addAccount("org2", "acc_org2", "connected", "loc_org2");

    // org1's location roster only ever carries acc_org1; org2's own location
    // roster (a different token, a different locationId) reports acc_org2
    // gone. If the sweep ever conflated the two calls, org1's account would
    // flip too.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/loc_default/")) {
        return new Response(JSON.stringify({ results: [{ id: "acc_org1", isExpired: false, deleted: false }] }), { status: 200 });
      }
      if (url.includes("/loc_org2/")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      throw new Error(`unexpected GHL url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.marketing.accounts.accountHealthSweep, {});

    expect(await statusOf(org1AccountId)).toBe("connected");
    expect(await statusOf(org2AccountId)).toBe("needs_reconnect");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rawCalls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const calls = rawCalls.map(([url, init]) => ({ url, init }));
    const defaultCall = calls.find((c) => c.url.includes("/loc_default/"))!;
    const org2Call = calls.find((c) => c.url.includes("/loc_org2/"))!;
    expect((defaultCall.init.headers as Record<string, string>).Authorization).toBe("Bearer pit_default");
    expect((org2Call.init.headers as Record<string, string>).Authorization).toBe("Bearer pit_org2");
  });
});
