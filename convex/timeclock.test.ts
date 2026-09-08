import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* A punch reaches the owners' and managers' phones - and nobody else's. */
describe("timeclock: who hears a punch", () => {
  let t: ReturnType<typeof convexTest>;
  const ORG = "org_s";

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Studio", slug: "studio", plan: "studio", status: "active", timezone: "America/Los_Angeles" });
      await ctx.db.insert("members", { orgId: ORG, name: "Owen Owner", role: "owner", skills: [], clerkUserId: "u_owner" });
      await ctx.db.insert("members", { orgId: ORG, name: "Mia Manager", role: "manager", skills: [], clerkUserId: "u_mgr" });
      await ctx.db.insert("members", { orgId: ORG, name: "Sienna Cole", role: "engineer", skills: [], clerkUserId: "u_eng" });
      await ctx.db.insert("members", { orgId: ORG, name: "Ivy Intern", role: "intern", skills: [], clerkUserId: "u_intern" });
    });
  });

  const scheduled = () =>
    t.run(async (ctx) => {
      const rows = await ctx.db.system.query("_scheduled_functions").collect();
      return rows.map((r) => ({ name: r.name, args: r.args[0] as Record<string, unknown> }));
    });

  it("an engineer's clock-in and clock-out go to the owner and the manager, by device", async () => {
    const eng = t.withIdentity({ subject: "u_eng", name: "Sienna" });
    await eng.mutation(api.timeclock.clockIn, {});
    let sent = (await scheduled()).filter((s) => s.name.startsWith("notify"));
    expect(sent).toHaveLength(1);
    expect(sent[0].args.title).toBe("Sienna Cole clocked in");
    expect(sent[0].args.clerkUserIds).toEqual(["u_owner", "u_mgr"]);
    expect(sent[0].args.strictAudience).toBe(true);
    expect(String(sent[0].args.tag)).toMatch(/^punch-in:/);

    await eng.mutation(api.timeclock.clockOut, {});
    sent = (await scheduled()).filter((s) => s.name.startsWith("notify"));
    expect(sent).toHaveLength(2);
    expect(sent[1].args.title).toBe("Sienna Cole clocked out");
    expect(String(sent[1].args.body)).toMatch(/h on the clock$/);
    expect(sent[1].args.clerkUserIds).toEqual(["u_owner", "u_mgr"]);
  });

  it("a manager's own punch is told to the owner, not to the manager", async () => {
    const mgr = t.withIdentity({ subject: "u_mgr", name: "Mia" });
    await mgr.mutation(api.timeclock.clockIn, {});
    const sent = (await scheduled()).filter((s) => s.name.startsWith("notify"));
    expect(sent).toHaveLength(1);
    expect(sent[0].args.clerkUserIds).toEqual(["u_owner"]);
  });
});
