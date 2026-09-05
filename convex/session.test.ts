import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* The query the native clients use to find out whose studio they are showing.
 *
 * The case that matters is an agency owner who has not entered a sub-account:
 * they resolve to the demo workspace, and without `needsStudio` the phone syncs
 * it and looks like a working app with the wrong studio's data in it. */
describe("session.current", () => {
  it("says which studio a member is in", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
      });
    });

    const session = await t.query(api.session.current, {});
    expect(session.orgId).toBe("pulse-demo");
    expect(session.orgName).toBe("Demo");
  });

  it("offers a studio member no list of studios to enter", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
      });
      // Another studio on the deployment, which must not leak.
      await ctx.db.insert("orgs", {
        orgId: "org_other", name: "Someone Else", slug: "else", plan: "studio", status: "active",
      });
    });

    const session = await t.query(api.session.current, {});
    expect(session.studios).toEqual([]);
    expect(session.needsStudio).toBe(false);
  });
});
