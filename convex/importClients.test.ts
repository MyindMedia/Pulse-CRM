import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

type StudioRole = "owner" | "intern";

async function memberOf(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  user: string,
  role: StudioRole,
) {
  await t.run(async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    if (!orgs.some((o) => o.orgId === orgId)) {
      await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, plan: "studio", status: "active" });
    }
    await ctx.db.insert("members", { orgId, name: role, role, clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: role, orgId });
}

describe("importClients", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  it("creates artists from imported rows (source = import)", async () => {
    const o = await memberOf(t, "org_a", "u_a", "owner");
    const res = await o.mutation(api.importClients.importClients, {
      rows: [
        { name: "Jordan Reyes", email: "jordan@example.com", phone: "(404) 555-0142", tags: ["vip"] },
        { name: "Casey Lin", email: "casey@example.com" },
      ],
    });
    expect(res).toEqual({ created: 2, updated: 0, skipped: 0 });

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("artists").collect()).filter((a) => a.orgId === "org_a"),
    );
    expect(rows).toHaveLength(2);
    const jordan = rows.find((r) => r.name === "Jordan Reyes")!;
    expect(jordan.source).toBe("import");
    expect(jordan.status).toBe("lead");
    expect(jordan.type).toBe("artist");
    expect(jordan.phone).toBe("+14045550142"); // normalized to E.164
    expect(jordan.tags).toEqual(["vip"]);
  });

  it("dedupes by email - a second row updates instead of duplicating", async () => {
    const o = await memberOf(t, "org_a", "u_a", "owner");
    await o.mutation(api.importClients.importClients, {
      rows: [{ name: "Jordan", email: "JORDAN@example.com", tags: ["lead"] }],
    });
    const res = await o.mutation(api.importClients.importClients, {
      rows: [{ name: "Jordan Reyes", email: "jordan@example.com", phone: "4045550142", tags: ["vip"] }],
    });
    expect(res).toEqual({ created: 0, updated: 1, skipped: 0 });

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("artists").collect()).filter((a) => a.orgId === "org_a"),
    );
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0].name).toBe("Jordan Reyes"); // name updated
    expect(rows[0].phone).toBe("+14045550142");
    expect(rows[0].tags?.sort()).toEqual(["lead", "vip"]); // tags merged
  });

  it("dedupes duplicate emails within a single batch", async () => {
    const o = await memberOf(t, "org_a", "u_a", "owner");
    const res = await o.mutation(api.importClients.importClients, {
      rows: [
        { name: "Sam A", email: "sam@example.com" },
        { name: "Sam B", email: "sam@example.com" },
      ],
    });
    expect(res).toEqual({ created: 1, updated: 1, skipped: 0 });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("artists").collect()).filter((a) => a.orgId === "org_a"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Sam B");
  });

  it("skips rows with an empty name", async () => {
    const o = await memberOf(t, "org_a", "u_a", "owner");
    const res = await o.mutation(api.importClients.importClients, {
      rows: [
        { name: "  ", email: "blank@example.com" },
        { name: "", phone: "5551234567" },
        { name: "Real Person" },
      ],
    });
    expect(res).toEqual({ created: 1, updated: 0, skipped: 2 });
  });

  it("is org-isolated - one org's import never lands in another", async () => {
    const a = await memberOf(t, "org_a", "u_a", "owner");
    const b = await memberOf(t, "org_b", "u_b", "owner");
    await a.mutation(api.importClients.importClients, {
      rows: [{ name: "A Client", email: "a@example.com" }],
    });
    const bRows = await t.run(async (ctx) =>
      (await ctx.db.query("artists").collect()).filter((x) => x.orgId === "org_b"),
    );
    expect(bRows).toHaveLength(0);
    // Same email in org_b creates fresh (no cross-tenant dedupe).
    const res = await b.mutation(api.importClients.importClients, {
      rows: [{ name: "A Client", email: "a@example.com" }],
    });
    expect(res.created).toBe(1);
  });

  it("denies a role without artists.edit (intern)", async () => {
    const intern = await memberOf(t, "org_a", "u_i", "intern");
    await expect(
      intern.mutation(api.importClients.importClients, {
        rows: [{ name: "Nope", email: "nope@example.com" }],
      }),
    ).rejects.toThrow();
  });
});
