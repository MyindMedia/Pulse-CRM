import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

// No Clerk identity -> resolveViewer synthesizes a demo studio "owner" pointed
// at appState.activeOrgId (or "pulse-demo"). We seed an org at "pulse-demo" so
// the onboarding mutations operate on it.
describe("onboarding wizard", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "New studio", slug: "new-studio",
        plan: "studio", status: "active", createdByAgency: true,
      });
    });
  });

  it("mine returns onboarding state with per-step flags", async () => {
    const state = await t.query(api.onboarding.mine, {});
    expect(state).not.toBeNull();
    expect(state!.onboardingCompletedAt).toBeNull();
    expect(state!.steps.basics).toBe(false); // name is still the placeholder
    expect(state!.steps.rooms).toBe(false);
  });

  it("saveBasics sets name + slug + accent and flips the basics step", async () => {
    await t.mutation(api.onboarding.saveBasics, {
      name: "Skyline Studios", slug: "Skyline Studios", accentColor: "#22d3ee",
    });
    const state = await t.query(api.onboarding.mine, {});
    expect(state!.name).toBe("Skyline Studios");
    expect(state!.slug).toBe("skyline-studios"); // normalized
    expect(state!.accentColor).toBe("#22d3ee");
    expect(state!.steps.basics).toBe(true);
  });

  it("saveBasics rejects a slug already used by another studio", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "other", name: "Other", slug: "taken", plan: "studio", status: "active" });
    });
    await expect(
      t.mutation(api.onboarding.saveBasics, { name: "Mine", slug: "taken" }),
    ).rejects.toThrow(/taken/i);
  });

  it("saveContact stores company info", async () => {
    await t.mutation(api.onboarding.saveContact, {
      legalName: "Skyline LLC", phone: "555-0100", address: "1 Main St",
    });
    const state = await t.query(api.onboarding.mine, {});
    expect(state!.contact?.legalName).toBe("Skyline LLC");
    expect(state!.steps.contact).toBe(true);
  });

  it("addRoom creates a bookable room and flips the rooms step", async () => {
    await t.mutation(api.onboarding.addRoom, {
      name: "Live Room A", roomType: "Live room", hourlyRateCents: 12000, depositPct: 50,
    });
    const state = await t.query(api.onboarding.mine, {});
    expect(state!.roomCount).toBe(1);
    expect(state!.steps.rooms).toBe(true);
    const room = await t.run(async (ctx) =>
      (await ctx.db.query("rooms").collect()).find((r) => r.orgId === "pulse-demo"));
    expect(room?.bookable).toBe(true);
  });

  it("complete sets onboardingCompletedAt (idempotent)", async () => {
    await t.mutation(api.onboarding.complete, {});
    const a = await t.query(api.onboarding.mine, {});
    expect(a!.onboardingCompletedAt).toBeTypeOf("number");
    await t.mutation(api.onboarding.complete, {}); // no throw on second call
  });
});

describe("agency.inviteStudio (email-first portal)", () => {
  it("provisions an active studio + records a pending invite from just an email", async () => {
    const t = convexTest(schema);
    const res = await t.action(api.agency.inviteStudio, {
      email: "Owner@NewStudio.com", studioName: "New Studio",
    });
    expect(res.orgId).toBeTruthy();
    expect(res.slug).toBe("new-studio");
    const orgs = await t.run(async (ctx) => await ctx.db.query("orgs").collect());
    const org = orgs.find((o) => o.slug === "new-studio");
    expect(org?.status).toBe("active");
    expect(org?.ownerEmail).toBe("owner@newstudio.com");
    const invites = await t.run(async (ctx) => await ctx.db.query("invites").collect());
    expect(invites.some((i) => i.email === "owner@newstudio.com" && i.status === "pending")).toBe(true);
  });

  it("rejects an invalid email", async () => {
    const t = convexTest(schema);
    await expect(t.action(api.agency.inviteStudio, { email: "not-an-email" })).rejects.toThrow(/valid email/i);
  });

  it("generates a unique slug when the name collides", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "x", name: "Skyline", slug: "skyline", plan: "studio", status: "active" });
    });
    const res = await t.action(api.agency.inviteStudio, { email: "o@x.com", studioName: "Skyline" });
    expect(res.slug).not.toBe("skyline");
    expect(res.slug.startsWith("skyline-")).toBe(true);
  });
});
