import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const AGENCY = "org_agency";

describe("agencyOps.portfolio", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: AGENCY, name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: AGENCY, clerkUserId: "u_owner", email: "o@x.com",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", { orgId: "sub_a", name: "Studio A", slug: "a", plan: "studio", status: "active", agencyId: AGENCY });
      await ctx.db.insert("orgs", { orgId: "sub_b", name: "Studio B", slug: "b", plan: "studio", status: "active", agencyId: AGENCY });
      const mk = (orgId: string, priority: "high" | "low") => ({
        orgId, type: "payment_reminder" as const, priority, title: "x", rationale: "y",
        payload: { kind: "note_only" as const }, status: "proposed" as const,
        autonomy: false, source: "rule" as const, dedupeKey: `payment_reminder:${orgId}:${priority}`, createdAt: Date.now(),
      });
      await ctx.db.insert("opsActions", mk("sub_a", "high"));
      await ctx.db.insert("opsActions", mk("sub_a", "low"));
      await ctx.db.insert("opsActions", mk("sub_b", "low"));
    });
  }

  it("rolls up open ops actions per subaccount, attention-first", async () => {
    await seed();
    const owner = t.withIdentity({ subject: "u_owner", name: "Owner", orgId: AGENCY, orgType: "agency" });
    const board = await owner.query(api.agencyOps.portfolio, {});
    expect(board).toHaveLength(2);
    // Studio A has the high-priority action -> sorted first.
    expect(board[0].orgId).toBe("sub_a");
    expect(board[0].openHigh).toBe(1);
    expect(board[0].openTotal).toBe(2);
    expect(board[1].orgId).toBe("sub_b");
    expect(board[1].openHigh).toBe(0);
  });

  it("denies a non-agency (studio) viewer", async () => {
    await seed();
    // No identity -> demo studio owner, which lacks ops.portfolio.view.
    await expect(t.query(api.agencyOps.portfolio, {})).rejects.toThrow();
  });
});
