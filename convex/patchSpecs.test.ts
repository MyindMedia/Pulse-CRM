import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The spec-sheet photo read (_panelImageOk) with a legacy Convex storage id:
   only a fresh upload that no other studio already holds may be fed to the model. */

const HOUR = 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema);
  const deviceId = await t.run(async (ctx) => {
    for (const orgId of ["pulse-demo", "studio_b"]) {
      await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" });
    }
    await ctx.db.insert("members", { orgId: "pulse-demo", name: "Olu", role: "owner", skills: [], clerkUserId: "u_owner" });
    const patchSpaceId = await ctx.db.insert("patchSpaces", { orgId: "pulse-demo", name: "Room", revision: 0, createdAt: Date.now() });
    const profileId = await ctx.db.insert("deviceProfiles", { scope: "global", name: "1073", manufacturer: "Neve", category: "preamp", portTemplate: [] });
    return await ctx.db.insert("deviceInstances", { orgId: "pulse-demo", patchSpaceId, profileId, label: "Neve", position: { x: 0, y: 0 }, createdAt: Date.now() });
  });
  const photo = () => t.run(async (ctx) => await ctx.storage.store(new Blob(["jpeg"], { type: "image/jpeg" })));
  const owner = t.withIdentity({ subject: "u_owner", name: "Olu" });
  const ok = (imageId: Id<"_storage">) => owner.query(internal.patchSpecs._panelImageOk, { deviceInstanceId: deviceId, imageId });
  return { t, photo, ok };
}

describe("patchSpecs._panelImageOk with a legacy storage id", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("accepts a fresh upload nobody else holds", async () => {
    const s = await setup();
    expect(await s.ok(await s.photo())).toBe(true);
  });

  it("refuses an upload older than an hour", async () => {
    const s = await setup();
    const id = await s.photo();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2 * HOUR);
    expect(await s.ok(id)).toBe(false);
  });

  it("refuses another studio's photo", async () => {
    const s = await setup();
    const id = await s.photo();
    await s.t.run(async (ctx) => {
      const patchSpaceId = await ctx.db.insert("patchSpaces", { orgId: "studio_b", name: "B room", revision: 0, createdAt: Date.now() });
      const profileId = await ctx.db.insert("deviceProfiles", { scope: "global", name: "LA-2A", manufacturer: "UA", category: "compressor", portTemplate: [] });
      await ctx.db.insert("deviceInstances", { orgId: "studio_b", patchSpaceId, profileId, label: "LA-2A", position: { x: 0, y: 0 }, createdAt: Date.now(), panelPhotoId: id });
    });
    expect(await s.ok(id)).toBe(false);
  });
});
