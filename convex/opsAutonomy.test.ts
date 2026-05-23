import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const ORG = "pulse-demo";

async function drain(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function seedQuietArtist(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" });
    await ctx.db.insert("artists", {
      orgId: ORG, name: "Quiet", type: "artist", genres: [], tags: [], status: "active",
      lifetimeValueCents: 0, sessionCount: 1, reliability: "solid", email: "q@x.com",
      lastContactAt: Date.now() - 120 * 86_400_000,
    });
  });
}

describe("autonomy graduation", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("an action type set to auto executes on scan without approval", async () => {
    await seedQuietArtist(t);
    await t.mutation(api.opsActions.setMode, { actionType: "reengage_quiet_artist", mode: "auto" });

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    await drain(t);

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === ORG),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].autonomy).toBe(true);
    expect(rows[0].status).toBe("executed");
  });

  it("surfaces a graduation suggestion after 5 clean approvals", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("opsAutonomy", {
        orgId: ORG, actionType: "payment_reminder", mode: "manual",
        approvedCount: 6, dismissedCount: 0,
      });
    });
    const suggestions = await t.query(api.opsActions.suggestions, {});
    expect(suggestions.map((s) => s.actionType)).toContain("payment_reminder");
  });

  it("does not suggest graduation when the dismiss rate is high", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("opsAutonomy", {
        orgId: ORG, actionType: "promote_underused_room", mode: "manual",
        approvedCount: 6, dismissedCount: 6,
      });
    });
    const suggestions = await t.query(api.opsActions.suggestions, {});
    expect(suggestions.map((s) => s.actionType)).not.toContain("promote_underused_room");
  });
});
