import { describe, it, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { mirrorSightTag } from "./lib/mirroredTables";
import { STUDIO_ROLE_CAPABILITIES } from "./lib/accessPolicies";

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

  it("keeps draining when one batch is not enough", async () => {
    // Fake timers before anything schedules, or the continuation is registered
    // against the real clock and never runs inside the test.
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const old = Date.now() - 20 * 24 * 60 * 60 * 1000;
      await t.run(async (ctx) => {
        await ctx.db.insert("orgs", {
          orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
        });
        // Five rows past the horizon, drained two at a time.
        for (let i = 0; i < 5; i++) {
          await ctx.db.insert("changeLog", {
            orgId: "pulse-demo", tableName: "artists", docId: `d${i}`, op: "insert", ts: old + i,
          });
        }
      });

      const first = await t.mutation(internal.sync.pruneChangeLog, { limit: 2 });
      expect(first.deleted).toBe(2);
      // A full batch means more is waiting, and the run schedules its own
      // successor rather than leaving the remainder for six hours' time.
      expect(first.more).toBe(true);

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const left = await t.run(async (ctx) => ctx.db.query("changeLog").collect());
      expect(left.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells a device whether its cursor still reaches back far enough", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
      });
    });

    // The demo viewer is an owner; a cursor carries who its rows were shaped for.
    const tag = mirrorSightTag({ capabilities: new Set<string>(STUDIO_ROLE_CAPABILITIES.owner) });
    const fresh = await t.query(api.sync.cursorIsUsable, { cursor: `${Date.now()}:1:${tag}` });
    expect(fresh.usable).toBe(true);

    const ancient = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = await t.query(api.sync.cursorIsUsable, { cursor: `${ancient}:1:${tag}` });
    expect(stale.usable).toBe(false);

    // A device that has never synced has no cursor and simply snapshots.
    const none = await t.query(api.sync.cursorIsUsable, {});
    expect(none.usable).toBe(true);
  });
});

/* The green suite did not catch any of these. The isolation test only used two
   plain studio viewers with different orgIds, which says nothing about what a
   single document contains or what one role may read. */
describe("sync: what a device is allowed to hold", () => {
  const seedOrg = async (t: ReturnType<typeof convexTest>) => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
        // The fields that must never reach a device.
        googleRefreshToken: "1//refresh-token-grants-gmail-access",
        stripeAccountId: "acct_live_123",
        billingSubscriptionId: "sub_live_456",
        taxRate: 9.5,
      });
    });
  };

  it("never ships the org's secrets, even to its own owner", async () => {
    const t = convexTest(schema);
    await seedOrg(t);

    const snap = await t.query(api.sync.snapshot, { table: "orgs" });
    const org = snap.docs[0] as Record<string, unknown>;

    // The thing that matters: a refresh token grants Gmail and Calendar access
    // to the owner's Google account outside Pulse entirely.
    expect(org.googleRefreshToken).toBeUndefined();
    expect(org.stripeAccountId).toBeUndefined();
    expect(org.billingSubscriptionId).toBeUndefined();
    expect(org.taxRate).toBeUndefined();

    // And it still carries what the app actually needs.
    expect(org.name).toBe("Demo");
    expect(org._id).toBeDefined();
  });

  it("keeps payroll off the device", async () => {
    const t = convexTest(schema);
    await seedOrg(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: "pulse-demo", name: "Ellis", role: "engineer", email: "e@demo.com",
        skills: [], payRateCents: 4500, commissionPct: 12,
      });
    });

    const snap = await t.query(api.sync.snapshot, { table: "members" });
    const member = snap.docs[0] as Record<string, unknown>;

    expect(member.payRateCents).toBeUndefined();
    expect(member.commissionPct).toBeUndefined();
    expect(member.name).toBe("Ellis");
    expect(member.role).toBe("engineer");
  });

  it("gates the tables that need a capability, and says so in the table list", async () => {
    const t = convexTest(schema);
    await seedOrg(t);

    // The demo viewer resolves as an owner, who does hold schedule.manage.
    const tables = await t.query(api.sync.mirroredTables, {});
    expect(tables).toContain("timeOff");
    expect(tables).toContain("availability");

    // And the gate itself exists on the read path.
    await expect(
      t.query(api.sync.snapshot, { table: "notATable" }),
    ).rejects.toThrow(/not mirrored/);
  });
});

describe("sync: a person's own rows", () => {
  /* An engineer holds no `insights.read`, so the studio-wide clock is not
     theirs to mirror - but their OWN punches are, or the phone can never show
     them as clocked in. Two engineers, one studio; each device gets its own. */
  const seed = async (t: ReturnType<typeof convexTest>) => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
      });
      const me = await ctx.db.insert("members", {
        orgId: "pulse-demo", name: "Ellis", role: "engineer", email: "e@demo.com",
        skills: [], clerkUserId: "user_ellis",
      });
      const them = await ctx.db.insert("members", {
        orgId: "pulse-demo", name: "Rae", role: "engineer", email: "r@demo.com",
        skills: [], clerkUserId: "user_rae",
      });
      return { me, them };
    });
  };

  it("snapshots only the caller's punches for an engineer", async () => {
    const t = convexTest(schema);
    await seed(t);
    const ellis = t.withIdentity({ subject: "user_ellis", name: "Ellis" });
    const rae = t.withIdentity({ subject: "user_rae", name: "Rae" });

    // Both clock in through the real mutation, so the change log fires.
    await ellis.mutation(api.timeclock.clockIn, {});
    await rae.mutation(api.timeclock.clockIn, {});

    const tables = await ellis.query(api.sync.mirroredTables, {});
    expect(tables).toContain("timeEntries");
    expect(tables).not.toContain("payments");

    const snap = await ellis.query(api.sync.snapshot, { table: "timeEntries" });
    const names = await Promise.all(
      (snap.docs as { memberId: string }[]).map((d) =>
        t.run(async (ctx) => (await ctx.db.get(d.memberId as never) as { name: string } | null)?.name),
      ),
    );
    expect(names).toEqual(["Ellis"]);
  });

  it("filters the change feed the same way", async () => {
    const t = convexTest(schema);
    await seed(t);
    const ellis = t.withIdentity({ subject: "user_ellis", name: "Ellis" });
    const rae = t.withIdentity({ subject: "user_rae", name: "Rae" });

    await ellis.mutation(api.timeclock.clockIn, {});
    await rae.mutation(api.timeclock.clockIn, {});

    const feed = await ellis.query(api.sync.pullChanges, {});
    const punches = feed.changes.filter((c) => c.table === "timeEntries");
    expect(punches.length).toBe(1);
    // The cursor still walks past Rae's row, so the device is not stuck on it.
    expect(feed.isDone).toBe(true);
  });

  it("moves the tip when anything in the studio changes", async () => {
    const t = convexTest(schema);
    await seed(t);
    const ellis = t.withIdentity({ subject: "user_ellis", name: "Ellis" });

    const before = await ellis.query(api.sync.tip, {});
    await ellis.mutation(api.timeclock.clockIn, {});
    const after = await ellis.query(api.sync.tip, {});
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  it("tells the phone which flow it is", async () => {
    const t = convexTest(schema);
    await seed(t);
    const ellis = t.withIdentity({ subject: "user_ellis", name: "Ellis" });
    const session = await ellis.query(api.session.current, {});
    expect(session.role).toBe("engineer");
    expect(session.memberId).not.toBeNull();
    expect(session.capabilities).toContain("patch.edit");
    expect(session.capabilities).not.toContain("insights.read");
  });
});
