import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import r2Test from "@convex-dev/r2/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo"; // the demo viewer resolves here as staff

function env() {
  vi.stubEnv("R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIATEST");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-test-value");
  vi.stubEnv("R2_PRIVATE_BUCKET", "pulse-private");
  vi.stubEnv("R2_MEDIA_BUCKET", "pulse-media");
  vi.stubEnv("R2_KEY_PREFIX", "test");
  vi.stubEnv("R2_PUBLIC_URL", "https://media.example.test");
}

describe("media + deliverables on R2", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { env(); t = convexTest(schema); r2Test.register(t); });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function seedDeliverable(opts: { paymentGated?: boolean; legacyFile?: boolean } = {}) {
    return await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "growth", status: "active" });
      const artistId = await ctx.db.insert("artists", { orgId: ORG, name: "A", type: "artist", genres: [], tags: [], status: "active", reliability: "solid", sessionCount: 0, lifetimeValueCents: 0 });
      const songId = await ctx.db.insert("songs", { orgId: ORG, title: "S", artistId, kind: "single", stage: "tracking", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 });
      const legacy = opts.legacyFile ? ((await ctx.storage.store(new Blob(["old-bytes"], { type: "audio/wav" }))) as Id<"_storage">) : undefined;
      const deliverableId = await ctx.db.insert("deliverables", {
        orgId: ORG, songId, kind: "master", version: 1, label: "Final", status: "delivered",
        paymentGated: opts.paymentGated ?? true, ...(legacy ? { fileId: legacy, fileName: "old.wav", fileSize: 9, mimeType: "audio/wav" } : {}),
      });
      return { deliverableId, legacy };
    });
  }
  const ready = (over: Partial<{ orgId: string; purpose: string; bucket: "media" | "private"; size: number }> = {}) =>
    t.run(async (ctx) => await ctx.db.insert("mediaFiles", {
      orgId: over.orgId ?? ORG, bucket: over.bucket ?? "private", key: `test/${over.orgId ?? ORG}/deliverable/final-0123456789ab.wav`,
      purpose: over.purpose ?? "deliverable", fileName: "final.wav", mimeType: "audio/wav", size: over.size ?? 5000, status: "ready", uploadedBy: "u", createdAt: Date.now(),
    }));

  it("prepareUpload mints a signed PUT URL for the private bucket and records a pending row under the caller's org", async () => {
    const r = await t.mutation(api.media.prepareUpload, { purpose: "deliverable", fileName: "Final Master (v2).WAV", mimeType: "audio/wav", size: 5_000_000 });
    expect(r.url).toContain("pulse-private");
    expect(r.url).toContain("X-Amz-Signature");
    const row = await t.run(async (ctx) => await ctx.db.get(r.mediaId));
    expect(row).toMatchObject({ orgId: ORG, bucket: "private", purpose: "deliverable", status: "pending", mimeType: "audio/wav" });
    expect(row!.key).toMatch(/^test\/pulse-demo\/deliverable\/final-master-v2-[0-9a-f-]{36}\.wav$/);
  });

  it("images go to the public bucket and non-images are refused for image purposes; size is capped", async () => {
    const photo = await t.mutation(api.media.prepareUpload, { purpose: "photo", fileName: "room.jpg", mimeType: "image/jpeg", size: 1000 });
    expect((await t.run(async (ctx) => await ctx.db.get(photo.mediaId)))!.bucket).toBe("media");
    await expect(t.mutation(api.media.prepareUpload, { purpose: "photo", fileName: "x.html", mimeType: "text/html", size: 10 })).rejects.toThrow(/PNG, JPG/);
    await expect(t.mutation(api.media.prepareUpload, { purpose: "photo", fileName: "big.jpg", mimeType: "image/jpeg", size: 26 * 1048576 })).rejects.toThrow(/too large/);
    await expect(t.mutation(api.media.prepareUpload, { purpose: "deliverable", fileName: "z.wav", mimeType: "audio/wav", size: 0 })).rejects.toThrow(/empty/);
  });

  it("a studio cannot confirm or read another studio's pending upload", async () => {
    const other = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", {
      orgId: "other-studio", bucket: "private", key: "test/other-studio/deliverable/x-0123456789ab.wav", purpose: "deliverable",
      fileName: "x.wav", mimeType: "audio/wav", status: "pending", uploadedBy: "u", createdAt: Date.now(),
    }));
    expect(await t.query(api.media.myPending, { mediaId: other })).toBeNull();
    await expect(t.action(api.media.confirmUpload, { mediaId: other })).rejects.toThrow(/Upload not found/);
  });

  it("attachR2File needs a finished upload from the same studio and the right purpose", async () => {
    const { deliverableId } = await seedDeliverable();
    const pending = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: ORG, bucket: "private", key: "test/p/deliverable/a-0123456789ab.wav", purpose: "deliverable", fileName: "a.wav", mimeType: "audio/wav", status: "pending", uploadedBy: "u", createdAt: 1 }));
    await expect(t.mutation(api.files.attachR2File, { deliverableId, mediaId: pending })).rejects.toThrow(/not finished/);
    const foreign = await ready({ orgId: "other-studio" });
    await expect(t.mutation(api.files.attachR2File, { deliverableId, mediaId: foreign })).rejects.toThrow(/Upload not found/);
    const wrong = await ready({ purpose: "photo", bucket: "media" });
    await expect(t.mutation(api.files.attachR2File, { deliverableId, mediaId: wrong })).rejects.toThrow(/Upload not found/);
  });

  it("attaching an R2 file stores the media id, meters its real size, and frees the legacy file it replaces", async () => {
    const { deliverableId, legacy } = await seedDeliverable({ legacyFile: true });
    const mediaId = await ready({ size: 7000 });
    await t.mutation(api.files.attachR2File, { deliverableId, mediaId });
    const d = await t.run(async (ctx) => await ctx.db.get(deliverableId));
    expect(d).toMatchObject({ fileId: mediaId, fileName: "final.wav", fileSize: 7000, mimeType: "audio/wav" });
    expect(await t.run(async (ctx) => await ctx.storage.getUrl(legacy!))).toBeNull(); // old file deleted
    const usage = await t.run(async (ctx) => await ctx.db.query("usageCounters").collect());
    expect(usage.find((u) => u.metric === "storage_bytes")?.value).toBe(6991); // 7000 new minus the 9 legacy bytes it replaced
  });

  it("download of an R2 deliverable releases a signed private URL; a media-bucket file is the public URL", async () => {
    const { deliverableId } = await seedDeliverable({ paymentGated: true });
    const mediaId = await ready();
    await t.mutation(api.files.attachR2File, { deliverableId, mediaId });
    const { url } = await t.query(api.files.downloadUrl, { deliverableId });
    expect(url).toContain("pulse-private");
    expect(url).toContain("X-Amz-Signature");
    expect(url).toContain("X-Amz-Expires=3600");
  });

  it("a pending upload yields no download URL", async () => {
    const { deliverableId } = await seedDeliverable({ paymentGated: false });
    const pending = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: ORG, bucket: "private", key: "test/p/deliverable/a-0123456789ab.wav", purpose: "deliverable", fileName: "a.wav", mimeType: "audio/wav", status: "pending", uploadedBy: "u", createdAt: 1 }));
    await t.run(async (ctx) => { await ctx.db.patch(deliverableId, { fileId: pending }); });
    await expect(t.query(api.files.downloadUrl, { deliverableId })).rejects.toThrow(/no longer available/);
  });

  it("sweepPending removes abandoned and unclaimed uploads older than a day and keeps recent and attached ones", async () => {
    const mk = (createdAt: number, status: "pending" | "ready", attachedAt?: number) => t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: ORG, bucket: "media", key: `test/s/photo/${createdAt}-${status}-0123456789ab.png`, purpose: "photo", fileName: "p.png", mimeType: "image/png", status, uploadedBy: "u", createdAt, ...(attachedAt ? { attachedAt } : {}) }));
    const oldPending = await mk(Date.now() - 2 * 86_400_000, "pending");
    const fresh = await mk(Date.now() - 1000, "pending");
    const attached = await mk(Date.now() - 3 * 86_400_000, "ready", Date.now() - 3 * 86_400_000);
    const unclaimed = await mk(Date.now() - 3 * 86_400_000 - 5, "ready");
    const freshReady = await mk(Date.now() - 2000, "ready");
    await t.mutation(internal.media.sweepPending, {});
    const left = await t.run(async (ctx) => (await ctx.db.query("mediaFiles").collect()).map((r) => r._id));
    expect(left).toContain(fresh);
    expect(left).toContain(attached);
    expect(left).toContain(freshReady);
    expect(left).not.toContain(oldPending);
    expect(left).not.toContain(unclaimed);
  });

  it("attaching claims the file so the sweeper keeps it, and replacing frees the old R2 file", async () => {
    const { deliverableId } = await seedDeliverable();
    const first = await ready({ size: 1000 });
    await t.mutation(api.files.attachR2File, { deliverableId, mediaId: first });
    expect((await t.run(async (ctx) => await ctx.db.get(first)))!.attachedAt).toBeGreaterThan(0);
    const second = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: ORG, bucket: "private", key: "test/p/deliverable/second-0123456789cd.wav", purpose: "deliverable", fileName: "second.wav", mimeType: "audio/wav", size: 2000, status: "ready", uploadedBy: "u", createdAt: Date.now() }));
    await t.mutation(api.files.attachR2File, { deliverableId, mediaId: second });
    expect(await t.run(async (ctx) => await ctx.db.get(first))).toBeNull();
    expect((await t.run(async (ctx) => await ctx.db.get(second)))!.attachedAt).toBeGreaterThan(0);
  });

  it("a studio is rate limited on how many uploads it can start in a day", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < 300; i++) await ctx.db.insert("mediaFiles", { orgId: ORG, bucket: "media", key: `test/r/photo/${i}-0123456789ab.png`, purpose: "photo", fileName: "p.png", mimeType: "image/png", status: "pending", uploadedBy: "u", createdAt: Date.now() });
    });
    await expect(t.mutation(api.media.prepareUpload, { purpose: "photo", fileName: "x.jpg", mimeType: "image/jpeg", size: 100 })).rejects.toThrow(/Too many uploads/);
  });

  it("a room photo on R2 is claimed, shows the public URL, and replacing it frees the old object; another studio's upload is refused", async () => {
    const roomId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "growth", status: "active" });
      return await ctx.db.insert("rooms", { orgId: ORG, name: "Studio A", status: "available", bookable: true });
    });
    const photo = (key: string, orgId = ORG) => t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId, bucket: "media", key, purpose: "photo", fileName: "r.jpg", mimeType: "image/jpeg", size: 1234, status: "ready", uploadedBy: "u", createdAt: Date.now() }));
    const a = await photo("test/pulse-demo/photo/room-aaaaaaaaaaaa.jpg");
    await t.mutation(api.rooms.setPhoto, { id: roomId, storageId: a });
    expect((await t.run(async (ctx) => await ctx.db.get(a)))!.attachedAt).toBeGreaterThan(0);
    const b = await photo("test/pulse-demo/photo/room-bbbbbbbbbbbb.jpg");
    await t.mutation(api.rooms.setPhoto, { id: roomId, storageId: b });
    expect(await t.run(async (ctx) => await ctx.db.get(a))).toBeNull(); // replaced file freed
    const room = await t.run(async (ctx) => await ctx.db.get(roomId));
    expect(room!.heroImageId).toBe(b);
    const foreign = await photo("test/other-studio/photo/x-cccccccccccc.jpg", "other-studio");
    await expect(t.mutation(api.rooms.setPhoto, { id: roomId, storageId: foreign })).rejects.toThrow(/Upload not found/);
    await t.mutation(api.rooms.clearPhoto, { id: roomId });
    expect(await t.run(async (ctx) => await ctx.db.get(b))).toBeNull();
  });
});
