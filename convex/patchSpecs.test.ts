import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
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

/* "Describe a model once and every copy uses the same details": a spec sheet
   applied to one copy updates this studio's own model, so the next copy
   placed starts from the corrected ports. A global model is never written. */
describe("patchSpecs.applyProposal and the device model", () => {
  async function place(scope: "studio" | "global") {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "S", slug: "s", tier: "max", status: "active" });
      await ctx.db.insert("members", { orgId: "pulse-demo", name: "Olu", role: "owner", skills: [], clerkUserId: "u_owner" });
      const patchSpaceId = await ctx.db.insert("patchSpaces", { orgId: "pulse-demo", name: "Room", revision: 0, createdAt: Date.now() });
      const profileId = await ctx.db.insert("deviceProfiles", {
        scope, ...(scope === "studio" ? { orgId: "pulse-demo" } : {}),
        name: "1073", manufacturer: "Neve", category: "preamp",
        portTemplate: [{ label: "Old In", direction: "input", signalLevel: "mic", connector: "xlr3", capabilities: [] }],
      });
      const deviceInstanceId = await ctx.db.insert("deviceInstances", { orgId: "pulse-demo", patchSpaceId, profileId, label: "Neve #1", position: { x: 0, y: 0 }, createdAt: Date.now() });
      const oldPort = await ctx.db.insert("ports", {
        orgId: "pulse-demo", patchSpaceId, deviceInstanceId, label: "Old In", direction: "input",
        signalLevel: "mic", connector: "xlr3", capabilities: [], state: {},
      });
      return { profileId, deviceInstanceId, oldPort };
    });
    const owner = t.withIdentity({ subject: "u_owner", name: "Olu" });
    await owner.mutation(api.patchSpecs.applyProposal, {
      deviceInstanceId: ids.deviceInstanceId,
      removePortIds: [ids.oldPort],
      add: [
        { label: "Mic In", direction: "input", signalLevel: "mic", connector: "xlr3", capabilities: [] },
        { label: "Line Out", direction: "output", signalLevel: "line", connector: "xlr3", capabilities: [] },
      ],
      sourceLabel: "the manual",
    });
    return { t, profile: await t.run((ctx) => ctx.db.get(ids.profileId)) };
  }

  it("this studio's model takes the applied ports, so the next copy matches", async () => {
    const { profile } = await place("studio");
    expect(profile?.portTemplate.map((p) => p.label).sort()).toEqual(["Line Out", "Mic In"]);
    expect(profile?.specSource).toBe("manual");
  });

  it("a global model shared by every studio is left alone", async () => {
    const { profile } = await place("global");
    expect(profile?.portTemplate.map((p) => p.label)).toEqual(["Old In"]);
    expect(profile?.specSource).toBeUndefined();
    expect(profile?.specVerifiedAt).toBeUndefined();
  });
});
