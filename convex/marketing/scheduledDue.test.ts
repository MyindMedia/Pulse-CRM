import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";

/* scheduledDue is the only thing that moves a post to "published", and it ran
   with no tests at all. It also used to read the entire socialPosts table
   every thirty minutes, across every org, which would have tripped Convex's
   read limit inside a year and stopped status sync platform-wide in silence.

   These pin what the due window selects, so the bounded query cannot quietly
   start selecting a different set than the unbounded scan did. */

const MIN = 60_000;

async function seed(t: ReturnType<typeof convexTest>, now: number) {
  return await t.run(async (ctx) => {
    const base = {
      template: "tip" as const, caption: "c", media: [], accountIds: [],
      timezone: "UTC", ghlType: "post" as const, submittedBy: "u1",
      createdAt: now, updatedAt: now,
    };
    const post = (over: Record<string, unknown>) =>
      ctx.db.insert("socialPosts", { orgId: "org1", ...base, ...over } as never);

    return {
      // Due, real GHL post.
      dueReal: await post({ status: "scheduled", scheduledFor: now - 10 * MIN, ghlPostId: "ghl_1" }),
      // Due, simulated (no GHL env) - its own branch in syncStatusAll.
      dueSimulated: await post({ status: "scheduled", scheduledFor: now - 5 * MIN, ghlPostId: "simulated:abc" }),
      // Due but never handed to GHL: nothing to sync against.
      dueNoGhlId: await post({ status: "scheduled", scheduledFor: now - 5 * MIN }),
      // Not due yet.
      future: await post({ status: "scheduled", scheduledFor: now + 60 * MIN, ghlPostId: "ghl_2" }),
      // Rows that are never deleted and used to be read on every single run.
      draft: await post({ status: "draft", scheduledFor: now - 90 * MIN }),
      published: await post({ status: "published", scheduledFor: now - 90 * MIN, ghlPostId: "ghl_3", publishedAt: now - 89 * MIN }),
      cancelled: await post({ status: "cancelled", scheduledFor: now - 90 * MIN, ghlPostId: "ghl_4" }),
      failed: await post({ status: "failed", scheduledFor: now - 90 * MIN, ghlPostId: "ghl_5" }),
      // A second org's due post, to prove the cron still spans orgs.
      otherOrg: await ctx.db.insert("socialPosts", {
        orgId: "org2", ...base, status: "scheduled", scheduledFor: now - 20 * MIN, ghlPostId: "ghl_6",
      } as never),
    };
  });
}

describe("scheduledDue", () => {
  it("selects only scheduled posts whose time has passed, grouped by org", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const ids = await seed(t, now);

    const { groups, simulated } = await t.query(internal.marketing.posts.scheduledDue, {});

    // Both orgs' due posts come back, each under its own org: one GHL call per
    // org, never one org's ghlPostId carried into another org's request.
    expect(groups.map((g) => g.orgId).sort()).toEqual(["org1", "org2"]);
    const org1 = groups.find((g) => g.orgId === "org1")!;
    expect(org1.posts.map((p) => p.id)).toEqual([ids.dueReal]);
    expect(groups.find((g) => g.orgId === "org2")!.posts.map((p) => p.id)).toEqual([ids.otherOrg]);

    // The simulated branch stays separate: it publishes without touching GHL.
    expect(simulated.map((p) => p.id)).toEqual([ids.dueSimulated]);

    // Everything else is excluded: not yet due, never sent to GHL, and the
    // three terminal states that accumulate forever.
    const selected = [...org1.posts.map((p) => p.id), ...simulated.map((p) => p.id), ids.otherOrg];
    for (const excluded of [ids.future, ids.dueNoGhlId, ids.draft, ids.published, ids.cancelled, ids.failed]) {
      expect(selected).not.toContain(excluded);
    }
  });

  it("returns nothing when a post is scheduled for the future", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("socialPosts", {
        orgId: "org1", template: "tip", status: "scheduled", caption: "c", media: [], accountIds: [],
        scheduledFor: now + 60 * MIN, timezone: "UTC", ghlType: "post", submittedBy: "u1",
        ghlPostId: "ghl_1", createdAt: now, updatedAt: now,
      } as never),
    );
    const { groups, simulated } = await t.query(internal.marketing.posts.scheduledDue, {});
    expect(groups).toEqual([]);
    expect(simulated).toEqual([]);
  });

  it("publishes a due simulated post, and leaves a future one scheduled", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const ids = await seed(t, now);

    // No GHL env, so every real post's org degrades to no client and only the
    // simulated branch does any work. This is the path a studio with nothing
    // connected actually runs.
    await t.action(internal.marketing.posts.syncStatusAll, {});

    const after = await t.run(async (ctx) => ({
      simulatedPost: await ctx.db.get(ids.dueSimulated),
      future: await ctx.db.get(ids.future),
      real: await ctx.db.get(ids.dueReal),
    }));
    expect(after.simulatedPost).toMatchObject({ status: "published", publishedAt: now - 5 * MIN });
    // Untouched: not due, and due-but-unconfirmed by GHL.
    expect(after.future?.status).toBe("scheduled");
    expect(after.real?.status).toBe("scheduled");
  });

  it("is not fooled by a post whose org has thousands of rows in terminal states", async () => {
    // The regression this bounds: rows that are never deleted must not be
    // read to answer "what is due". One due post hides behind 300 of them.
    const t = convexTest(schema);
    const now = Date.now();
    const dueId = await t.run(async (ctx) => {
      const base = {
        orgId: "org1", template: "tip" as const, caption: "c", media: [], accountIds: [],
        timezone: "UTC", ghlType: "post" as const, submittedBy: "u1", createdAt: now, updatedAt: now,
      };
      for (let i = 0; i < 300; i++) {
        await ctx.db.insert("socialPosts", {
          ...base, status: "published", scheduledFor: now - (i + 2) * MIN,
          ghlPostId: `ghl_old_${i}`, publishedAt: now - (i + 1) * MIN,
        } as never);
      }
      return await ctx.db.insert("socialPosts", {
        ...base, status: "scheduled", scheduledFor: now - MIN, ghlPostId: "ghl_due",
      } as never);
    });

    const { groups } = await t.query(internal.marketing.posts.scheduledDue, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].posts.map((p) => p.id)).toEqual([dueId]);
  });
});
