import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import r2Test from "@convex-dev/r2/test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

describe("R2 backfill", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    vi.stubEnv("R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIATEST");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-test-value");
    vi.stubEnv("R2_PRIVATE_BUCKET", "pulse-private");
    vi.stubEnv("R2_MEDIA_BUCKET", "pulse-media");
    vi.stubEnv("R2_KEY_PREFIX", "test");
    t = convexTest(schema);
    r2Test.register(t);
  });
  afterEach(() => vi.unstubAllEnvs());

  const legacy = (text = "bytes") => t.run(async (ctx) => (await ctx.storage.store(new Blob([text], { type: "image/png" }))) as Id<"_storage">);
  const readyMedia = () => t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: "o1", bucket: "media", key: "test/o1/photo/x-0123456789ab.png", purpose: "photo", fileName: "x.png", mimeType: "image/png", size: 5, status: "ready", uploadedBy: "u", createdAt: 1 }));
  const walk = async () => {
    const items: Array<{ table: string; id: string; path: string; ref: string; index?: number; scope: string; purpose: string }> = [];
    type Cursor = { specIndex: number; cursor: string | null };
    let next: Cursor | null = { specIndex: 0, cursor: null };
    while (next) {
      const r: { items: typeof items; next: Cursor | null } = await t.query(internal.mediaBackfill.page, { ...next, limit: 50 });
      items.push(...r.items);
      next = r.next;
    }
    return items;
  };

  it("finds legacy files in plain, nested and array fields with the right scope and purpose; skips R2 and dangling ones", async () => {
    const a = await legacy("a"), b = await legacy("b"), c = await legacy("c"), d = await legacy("d");
    const r2ref = await readyMedia();
    const dangling = await legacy("gone");
    await t.run(async (ctx) => {
      await ctx.storage.delete(dangling);
      await ctx.db.insert("orgs", { orgId: "o1", name: "O", slug: "o", tier: "growth", status: "active", logoId: a, theme: { loginBackgroundId: b } } as never);
      await ctx.db.insert("rooms", { orgId: "o1", name: "R", status: "available", heroImageId: r2ref });
      await ctx.db.insert("rooms", { orgId: "o1", name: "R2", status: "available", heroImageId: dangling });
      await ctx.db.insert("agencies", { agencyId: "ag1", name: "Ag", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u", ownerEmail: "u@x", logoId: c } as never);
      await ctx.db.insert("socialPosts", { orgId: "o1", media: [{ type: "image", storageId: d }, { type: "image", brandCard: "promo" }] } as never).catch(() => undefined);
    });
    const found = await walk();
    const by = (p: string) => found.find((i) => i.path === p);
    expect(by("logoId")).toBeDefined();
    expect(found.find((i) => i.table === "orgs" && i.path === "logoId")).toMatchObject({ ref: a, scope: "o1", purpose: "logo" });
    expect(by("theme.loginBackgroundId")).toMatchObject({ ref: b, purpose: "photo" });
    expect(found.find((i) => i.table === "agencies")).toMatchObject({ ref: c, scope: "agency:ag1" });
    expect(found.some((i) => i.ref === r2ref)).toBe(false);
    expect(found.some((i) => i.ref === dangling)).toBe(false);
  });

  it("repoint swaps the reference once, keeps the legacy id on the new row, and refuses if the row changed meanwhile", async () => {
    const old = await legacy("old"), newer = await legacy("newer");
    const roomId = await t.run(async (ctx) => await ctx.db.insert("rooms", { orgId: "o1", name: "R", status: "available", heroImageId: old }));
    const copy = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: "o1", bucket: "media", key: "test/o1/photo/room-0123456789ab.png", purpose: "photo", fileName: "room.png", mimeType: "image/png", size: 3, status: "ready", uploadedBy: "backfill", createdAt: 1, legacyStorageId: old }));
    // someone replaced the photo while the copy was running
    await t.run(async (ctx) => { await ctx.db.patch(roomId, { heroImageId: newer }); });
    expect(await t.mutation(internal.mediaBackfill.repoint, { table: "rooms", id: roomId, path: "heroImageId", oldRef: old, mediaId: copy })).toBe("changed");
    expect((await t.run(async (ctx) => await ctx.db.get(roomId)))!.heroImageId).toBe(newer);
    await t.run(async (ctx) => { await ctx.db.patch(roomId, { heroImageId: old }); });
    expect(await t.mutation(internal.mediaBackfill.repoint, { table: "rooms", id: roomId, path: "heroImageId", oldRef: old, mediaId: copy })).toBe("repointed");
    expect((await t.run(async (ctx) => await ctx.db.get(roomId)))!.heroImageId).toBe(copy);
    expect((await t.run(async (ctx) => await ctx.db.get(copy)))!.attachedAt).toBeGreaterThan(0);
    // a deleted row is reported, not thrown
    await t.run(async (ctx) => { await ctx.db.delete(roomId); });
    expect(await t.mutation(internal.mediaBackfill.repoint, { table: "rooms", id: roomId, path: "heroImageId", oldRef: old, mediaId: copy })).toBe("gone");
  });

  it("repoint handles the nested theme field and the social media array", async () => {
    const bg = await legacy("bg"), vid = await legacy("vid");
    const copy = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: "o1", bucket: "media", key: "test/o1/photo/c-0123456789ab.png", purpose: "photo", fileName: "c.png", mimeType: "image/png", size: 1, status: "ready", uploadedBy: "b", createdAt: 1 }));
    const orgId = await t.run(async (ctx) => await ctx.db.insert("orgs", { orgId: "o1", name: "O", slug: "o", tier: "growth", status: "active", theme: { loginBackgroundId: bg, appName: "X" } } as never));
    expect(await t.mutation(internal.mediaBackfill.repoint, { table: "orgs", id: orgId, path: "theme.loginBackgroundId", oldRef: bg, mediaId: copy })).toBe("repointed");
    const org = await t.run(async (ctx) => await ctx.db.get(orgId));
    expect(org!.theme).toMatchObject({ loginBackgroundId: copy, appName: "X" }); // siblings survive
    void vid;
  });

  it("purgeLegacy frees legacy files only for copies that have been attached long enough", async () => {
    const oldFile = await legacy("o"), freshFile = await legacy("f");
    const day = 86_400_000;
    await t.run(async (ctx) => {
      const mk = (legacyStorageId: Id<"_storage">, attachedAt: number) => ctx.db.insert("mediaFiles", { orgId: "o1", bucket: "media", key: `test/o1/photo/${attachedAt}-0123456789ab.png`, purpose: "photo", fileName: "p.png", mimeType: "image/png", size: 1, status: "ready", uploadedBy: "b", createdAt: 1, attachedAt, legacyStorageId });
      await mk(oldFile, Date.now() - 20 * day);
      await mk(freshFile, Date.now() - 2 * day);
    });
    expect(await t.mutation(internal.mediaBackfill.purgeLegacy, { days: 14, limit: 100 })).toEqual({ purged: 1 });
    expect(await t.run(async (ctx) => await ctx.storage.getUrl(oldFile))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.storage.getUrl(freshFile))).not.toBeNull();
  });
});
