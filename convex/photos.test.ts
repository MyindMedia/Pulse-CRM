import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* P1 photo uploads + the tenant-isolation guarantee: a studio can attach photos
   to its OWN rooms/members, and is hard-denied on any other org's rows. (No Clerk
   identity → resolveViewer synthesizes a demo studio owner on "pulse-demo".) */
describe("photo uploads — tenant isolation", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("rooms.setPhoto attaches to your own room; list resolves heroUrl", async () => {
    const { roomId, storageId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const roomId = await ctx.db.insert("rooms", { orgId: "pulse-demo", name: "Live A", status: "available" });
      const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      return { roomId, storageId };
    });
    await t.mutation(api.rooms.setPhoto, { id: roomId, storageId });
    const rooms = await t.query(api.rooms.list, {});
    expect(rooms.find((r) => r._id === roomId)?.heroUrl).toBeTruthy();
  });

  it("rooms.setPhoto is DENIED on another org's room", async () => {
    const { otherRoomId, storageId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const otherRoomId = await ctx.db.insert("rooms", { orgId: "rival-studio", name: "Theirs", status: "available" });
      const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      return { otherRoomId, storageId };
    });
    await expect(t.mutation(api.rooms.setPhoto, { id: otherRoomId, storageId })).rejects.toThrow(/not found/i);
  });

  it("members.setPhoto attaches to your own member; list resolves photoUrl; cross-org denied", async () => {
    const { memId, rivalMemId, storageId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const memId = await ctx.db.insert("members", { orgId: "pulse-demo", name: "Jordan", role: "engineer", skills: [] });
      const rivalMemId = await ctx.db.insert("members", { orgId: "rival-studio", name: "Rival", role: "engineer", skills: [] });
      const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      return { memId, rivalMemId, storageId };
    });
    await t.mutation(api.members.setPhoto, { id: memId, storageId });
    const list = await t.query(api.members.list, {});
    expect(list.find((m) => m._id === memId)?.photoUrl).toBeTruthy();
    await expect(t.mutation(api.members.setPhoto, { id: rivalMemId, storageId })).rejects.toThrow(/not found/i);
  });

  it("rooms.clearPhoto removes the uploaded photo", async () => {
    const { roomId, storageId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const roomId = await ctx.db.insert("rooms", { orgId: "pulse-demo", name: "Live A", status: "available" });
      const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      return { roomId, storageId };
    });
    await t.mutation(api.rooms.setPhoto, { id: roomId, storageId });
    await t.mutation(api.rooms.clearPhoto, { id: roomId });
    const rooms = await t.query(api.rooms.list, {});
    expect(rooms.find((r) => r._id === roomId)?.heroUrl).toBeNull();
  });
});
