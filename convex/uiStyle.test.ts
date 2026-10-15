import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* iOS Glass look: every plan can choose its surface style; unset is hardware. */
describe("branding.setUiStyle", () => {
  let t: ReturnType<typeof convexTest>;
  const as = (subject: string) =>
    t.withIdentity({ subject, name: subject, orgId: "org_s1" } as { subject: string; name: string; orgId: string });

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s1",
        name: "Core Studio",
        slug: "core",
        tier: "core",
        status: "active",
      });
      await ctx.db.insert("members", { orgId: "org_s1", name: "Owner", role: "owner", clerkUserId: "u_owner", skills: [] });
      await ctx.db.insert("members", { orgId: "org_s1", name: "Intern", role: "intern", clerkUserId: "u_intern", skills: [] });
    });
  });

  const readOrg = () => t.run(async (ctx) => ctx.db.query("orgs").first());

  it("saves glass on the Core plan and reads it back in orgs.current and the public booking brand", async () => {
    await as("u_owner").mutation(api.branding.setUiStyle, { uiStyle: "glass" });
    expect((await readOrg())?.uiStyle).toBe("glass");
    expect((await as("u_owner").query(api.orgs.current, {}))!.uiStyle).toBe("glass");
    const front = await t.query(api.booking.studioFront, { slug: "core" });
    expect(front!.org.uiStyle).toBe("glass");
  });

  it("can switch back to hardware", async () => {
    await as("u_owner").mutation(api.branding.setUiStyle, { uiStyle: "glass" });
    await as("u_owner").mutation(api.branding.setUiStyle, { uiStyle: "hardware" });
    expect((await readOrg())?.uiStyle).toBe("hardware");
  });

  it("rejects a style the stylesheet does not know", async () => {
    await expect(as("u_owner").mutation(api.branding.setUiStyle, { uiStyle: "neon" })).rejects.toThrow(/look/i);
    await expect(as("u_owner").mutation(api.branding.setUiStyle, { uiStyle: "" })).rejects.toThrow(/look/i);
    expect((await readOrg())?.uiStyle).toBeUndefined();
  });

  it("needs branding.edit", async () => {
    await expect(as("u_intern").mutation(api.branding.setUiStyle, { uiStyle: "glass" })).rejects.toThrow();
    expect((await readOrg())?.uiStyle).toBeUndefined();
  });

  it("off path: a studio that never chose reads as hardware, and nothing is written", async () => {
    expect((await readOrg())?.uiStyle).toBeUndefined();
    expect((await as("u_owner").query(api.orgs.current, {}))!.uiStyle).toBe("hardware");
    const front = await t.query(api.booking.studioFront, { slug: "core" });
    expect(front!.org.uiStyle).toBe("hardware");
  });
});
