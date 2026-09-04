import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* The delta feed the native macOS client syncs against.
   The demo viewer resolves to org "pulse-demo", so writes made through the real
   mutations land there and the feed should hand them back. */
describe("sync: the native-client change feed", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo",
        name: "Demo",
        slug: "demo",
        plan: "studio",
        status: "active",
      });
    });
  });

  it("logs an insert and hands back the document inline", async () => {
    await t.mutation(api.artists.create, { name: "Nova", type: "artist" });

    const res = await t.query(api.sync.pullChanges, {});
    const artist = res.changes.find((c) => c.table === "artists");

    expect(artist).toBeDefined();
    expect(artist!.op).toBe("insert");
    expect((artist!.doc as { name: string }).name).toBe("Nova");
  });

  it("logs an update after the insert, in order", async () => {
    const id = await t.mutation(api.artists.create, {
      name: "Nova",
      type: "artist",
    });
    await t.mutation(api.artists.update, { id, status: "vip" });

    const res = await t.query(api.sync.pullChanges, { tables: ["artists"] });
    const ops = res.changes.map((c) => c.op);

    expect(ops).toEqual(["insert", "update"]);
    const last = res.changes.at(-1)!;
    expect((last.doc as { status: string }).status).toBe("vip");
  });

  it("leaves a tombstone on delete, with no document", async () => {
    const id = await t.mutation(api.artists.create, {
      name: "Gone",
      type: "artist",
    });
    await t.mutation(api.artists.remove, { id });

    const res = await t.query(api.sync.pullChanges, { tables: ["artists"] });
    const tomb = res.changes.at(-1)!;

    expect(tomb.op).toBe("delete");
    expect(tomb.doc).toBeNull();
    expect(tomb.docId).toBe(id);
  });

  it("never returns another studio's changes", async () => {
    // A second studio writes directly, stamped with its own org.
    await t.run(async (ctx) => {
      const otherId = await ctx.db.insert("artists", {
        orgId: "other-studio",
        name: "Not Yours",
        type: "artist",
        status: "active",
        genres: [],
        tags: [],
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
      });
      await ctx.db.insert("changeLog", {
        orgId: "other-studio",
        tableName: "artists",
        docId: otherId,
        op: "insert",
        ts: Date.now(),
      });
    });
    await t.mutation(api.artists.create, { name: "Mine", type: "artist" });

    const res = await t.query(api.sync.pullChanges, {});
    const names = res.changes.map((c) => (c.doc as { name?: string })?.name);

    expect(names).toContain("Mine");
    expect(names).not.toContain("Not Yours");
  });

  it("resumes from a cursor without repeating what it already sent", async () => {
    await t.mutation(api.artists.create, { name: "First", type: "artist" });
    const first = await t.query(api.sync.pullChanges, { limit: 1 });
    expect(first.changes.length).toBe(1);

    await t.mutation(api.artists.create, { name: "Second", type: "artist" });
    const second = await t.query(api.sync.pullChanges, {
      cursor: first.cursor,
    });
    const names = second.changes.map((c) => (c.doc as { name?: string })?.name);

    expect(names).toContain("Second");
    expect(names).not.toContain("First");
  });

  it("snapshots a mirrored table and refuses one that is not", async () => {
    await t.mutation(api.artists.create, { name: "Hydrate Me", type: "artist" });

    const snap = await t.query(api.sync.snapshot, { table: "artists" });
    expect(snap.docs.length).toBe(1);
    expect(snap.isDone).toBe(true);

    await expect(
      t.query(api.sync.snapshot, { table: "auditEvents" }),
    ).rejects.toThrow(/not mirrored/);
  });

  it("publishes the table list a device should hold", async () => {
    const tables = await t.query(api.sync.mirroredTables, {});
    expect(tables).toContain("artists");
    expect(tables).toContain("sessions");
    // Platform-level tables are never mirrored to a studio's device.
    expect(tables).not.toContain("users");
    expect(tables).not.toContain("agencies");
  });
});

describe("sync: retention", () => {
  it("prunes only what is past the horizon, and says the cursor is stale", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const old = now - 20 * 24 * 60 * 60 * 1000; // 20 days, past the fortnight
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
      });
      await ctx.db.insert("changeLog", {
        orgId: "pulse-demo", tableName: "artists", docId: "gone", op: "insert", ts: old,
      });
      await ctx.db.insert("changeLog", {
        orgId: "pulse-demo", tableName: "artists", docId: "kept", op: "insert", ts: now,
      });
    });

    const result = await t.mutation(internal.sync.pruneChangeLog, {});
    expect(result.deleted).toBe(1);

    const left = await t.run(async (ctx) => ctx.db.query("changeLog").collect());
    expect(left.length).toBe(1);
    expect(left[0].docId).toBe("kept");
  });

  it("tells a device whether its cursor still reaches back far enough", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
      });
    });

    const fresh = await t.query(api.sync.cursorIsUsable, { cursor: `${Date.now()}:1` });
    expect(fresh.usable).toBe(true);

    const ancient = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = await t.query(api.sync.cursorIsUsable, { cursor: `${ancient}:1` });
    expect(stale.usable).toBe(false);

    // A device that has never synced has no cursor and simply snapshots.
    const none = await t.query(api.sync.cursorIsUsable, {});
    expect(none.usable).toBe(true);
  });
});
