import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/** Preserves the schema types on `t`. */
const initT = () => convexTest(schema);

/* A staged account is the pitch machine's output: branded, roomed, full of
   demo data, and ownerless. Handing it over must attach the owner without
   disturbing anything the pitch built. */

async function stagedOrg(t: ReturnType<typeof initT>, orgId = "staged-playback") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name: "Playback Recording Studio", slug: "playback",
      plan: "studio", status: "active", agencyId: "org_ag",
      createdByAgency: true, tier: "studio", accentColor: "#9C1ADF",
      demoMode: true,
    });
    // Real configuration from the pitch build - must survive.
    await ctx.db.insert("rooms", {
      orgId, name: "STUDIO A", status: "available", hourlyRateCents: 12000,
      minimumHours: 2, depositPct: 30, bookable: true,
    });
    // Demo data - must not.
    const fake = await ctx.db.insert("artists", {
      orgId, name: "Invented Client", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    await ctx.db.insert("demoRows", { orgId, table: "artists", docId: fake });
  });
}

describe("handing a staged studio to its owner", () => {
  let t: ReturnType<typeof initT>;
  beforeEach(() => { t = initT(); });

  it("attaches the owner and creates the members row the access engine needs", async () => {
    await stagedOrg(t);
    const r = await t.run(async (ctx) =>
      await ctx.runMutation(internal.handover._attachOwner, {
        orgId: "staged-playback", ownerName: "OT", ownerEmail: "Info@playbackrecording.com",
      }),
    );
    expect(r.memberCreated).toBe(true);

    const { org, members } = await t.run(async (ctx) => ({
      org: await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).first(),
      members: await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).collect(),
    }));
    /* Stored lowercased, whatever case it was typed in. This exact address,
       saved as "Info@...", is what stopped matching the invite for "info@..."
       and left the studio's owner staring at an error screen. */
    expect(org?.ownerEmail).toBe("info@playbackrecording.com");
    expect(members[0].email).toBe("info@playbackrecording.com");
    expect(org?.ownerName).toBe("OT");
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    // No clerkUserId yet - invites.accept writes it when they set a password.
    expect(members[0].clerkUserId).toBeUndefined();
  });

  it("keeps the orgId, so nothing the pitch built is orphaned", async () => {
    await stagedOrg(t);
    await t.run(async (ctx) =>
      await ctx.runMutation(internal.handover._attachOwner, {
        orgId: "staged-playback", ownerName: "OT", ownerEmail: "info@playbackrecording.com",
      }),
    );
    const rooms = await t.run(async (ctx) =>
      await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).collect(),
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0].name).toBe("STUDIO A");
  });

  it("is idempotent on the members row", async () => {
    await stagedOrg(t);
    const args = {
      orgId: "staged-playback", ownerName: "OT", ownerEmail: "info@playbackrecording.com",
    };
    await t.run(async (ctx) => await ctx.runMutation(internal.handover._attachOwner, args));
    const second = await t.run(async (ctx) =>
      await ctx.runMutation(internal.handover._attachOwner, args),
    );
    expect(second.memberCreated).toBe(false);
    const members = await t.run(async (ctx) =>
      await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).collect(),
    );
    expect(members).toHaveLength(1);
  });

  it("refuses to reassign a studio that already has a different owner", async () => {
    await stagedOrg(t);
    await t.run(async (ctx) =>
      await ctx.runMutation(internal.handover._attachOwner, {
        orgId: "staged-playback", ownerName: "OT", ownerEmail: "first@owner.com",
      }),
    );
    await expect(
      t.run(async (ctx) =>
        await ctx.runMutation(internal.handover._attachOwner, {
          orgId: "staged-playback", ownerName: "Someone", ownerEmail: "second@owner.com",
        }),
      ),
    ).rejects.toThrow();
  });

  it("matches the owner email case-insensitively rather than making a second row", async () => {
    await stagedOrg(t);
    await t.run(async (ctx) =>
      await ctx.runMutation(internal.handover._attachOwner, {
        orgId: "staged-playback", ownerName: "OT", ownerEmail: "Info@playbackrecording.com",
      }),
    );
    const second = await t.run(async (ctx) =>
      await ctx.runMutation(internal.handover._attachOwner, {
        orgId: "staged-playback", ownerName: "OT", ownerEmail: "info@PLAYBACKRECORDING.com",
      }),
    );
    expect(second.memberCreated).toBe(false);
  });

  it("staging for onboarding wipes demo rows but keeps the real configuration", async () => {
    await stagedOrg(t);
    const staged = await t.run(async (ctx) =>
      await ctx.runMutation(internal.demoMode._stageForOnboarding, { orgId: "staged-playback" }),
    );
    expect(staged.removed).toBe(1);

    const { artists, rooms, org } = await t.run(async (ctx) => ({
      artists: await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).collect(),
      rooms: await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).collect(),
      org: await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "staged-playback")).first(),
    }));
    expect(artists).toHaveLength(0);          // invented client gone
    expect(rooms).toHaveLength(1);            // their real room stays
    expect(org?.demoMode).toBe(false);
    expect(org?.onboardingCompletedAt).toBeUndefined(); // /welcome will run
  });
});
