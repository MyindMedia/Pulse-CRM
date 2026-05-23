import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Exercises the Song Workspace overview aggregate: open balance across the
   song's sessions + the derived next-action heuristic. */

const ORG = "org_overview";

describe("songs.overview - balance + next action", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  async function seedBase() {
    return t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG,
        name: "S",
        slug: "s",
        plan: "studio",
        status: "active",
      });
      const ownerMemberId = await ctx.db.insert("members", {
        orgId: ORG,
        name: "Maya Owner",
        role: "owner",
        clerkUserId: "u_o",
        skills: [],
      });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG,
        name: "Nova",
        type: "artist",
        genres: [],
        tags: [],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
      });
      const songId = await ctx.db.insert("songs", {
        orgId: ORG,
        title: "Midnight",
        artistId,
        kind: "single",
        stage: "mixing",
        moodTags: [],
        referenceTracks: [],
        revisionsIncluded: 3,
        revisionsUsed: 0,
      });
      return { ownerMemberId, artistId, songId };
    });
  }

  function asOwner() {
    return t.withIdentity({ subject: "u_o", name: "Maya Owner", orgId: ORG });
  }

  it("sums outstanding balance across sessions -> Collect balance", async () => {
    const { songId } = await seedBase();
    await t.run(async (ctx) => {
      const song = await ctx.db.get(songId);
      const artistId = song!.artistId;
      // Session A: $500 rate, $150 paid -> $350 owed.
      await ctx.db.insert("sessions", {
        orgId: ORG, title: "Track A", artistId, songId,
        serviceType: "recording", startTime: 1, endTime: 2,
        status: "confirmed", rateCents: 50000, depositCents: 15000,
        depositPaid: true, intakeCompleted: false, amountPaidCents: 15000,
      });
      // Session B: $200 rate, fully paid -> $0 owed.
      await ctx.db.insert("sessions", {
        orgId: ORG, title: "Track B", artistId, songId,
        serviceType: "mixing", startTime: 3, endTime: 4,
        status: "confirmed", rateCents: 20000, depositCents: 6000,
        depositPaid: true, intakeCompleted: false, amountPaidCents: 20000,
      });
    });

    const ov = await asOwner().query(api.songs.overview, { songId });
    expect(ov).not.toBeNull();
    expect(ov!.openBalanceCents).toBe(35000);
    expect(ov!.sessionCount).toBe(2);
    expect(ov!.nextAction).toBe("Collect balance");
    expect(ov!.clientName).toBe("Nova");
  });

  it("paid-in-full + completed session without recap -> Send recap", async () => {
    const { songId } = await seedBase();
    await t.run(async (ctx) => {
      const song = await ctx.db.get(songId);
      await ctx.db.insert("sessions", {
        orgId: ORG, title: "Done", artistId: song!.artistId, songId,
        serviceType: "recording", startTime: 1, endTime: 2,
        status: "completed", rateCents: 30000, depositCents: 9000,
        depositPaid: true, intakeCompleted: true, amountPaidCents: 30000,
      });
    });

    const ov = await asOwner().query(api.songs.overview, { songId });
    expect(ov!.openBalanceCents).toBe(0);
    expect(ov!.nextAction).toBe("Send recap");
  });

  it("balance clear, recap present, draft split -> Complete split sheet", async () => {
    const { songId } = await seedBase();
    await t.run(async (ctx) => {
      const song = await ctx.db.get(songId);
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Done", artistId: song!.artistId, songId,
        serviceType: "recording", startTime: 1, endTime: 2,
        status: "completed", rateCents: 30000, depositCents: 9000,
        depositPaid: true, intakeCompleted: true, amountPaidCents: 30000,
      });
      await ctx.db.insert("aiArtifacts", {
        orgId: ORG, kind: "session_recap", sessionId,
        title: "Recap", summary: "done", source: "openai",
        status: "ready", generatedAt: 5,
      });
      await ctx.db.insert("splitSheets", {
        orgId: ORG, songId, status: "draft", contributors: [], updatedAt: 5,
      });
    });

    const ov = await asOwner().query(api.songs.overview, { songId });
    expect(ov!.openBalanceCents).toBe(0);
    expect(ov!.nextAction).toBe("Complete split sheet");
    expect(ov!.splitStatus).toBe("draft");
  });

  it("everything settled -> On track", async () => {
    const { songId } = await seedBase();
    await t.run(async (ctx) => {
      const song = await ctx.db.get(songId);
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Done", artistId: song!.artistId, songId,
        serviceType: "recording", startTime: 1, endTime: 2,
        status: "completed", rateCents: 30000, depositCents: 9000,
        depositPaid: true, intakeCompleted: true, amountPaidCents: 30000,
      });
      await ctx.db.insert("aiArtifacts", {
        orgId: ORG, kind: "session_recap", sessionId,
        title: "Recap", summary: "done", source: "openai",
        status: "ready", generatedAt: 5,
      });
      await ctx.db.insert("splitSheets", {
        orgId: ORG, songId, status: "fully_executed", contributors: [], updatedAt: 5,
      });
    });

    const ov = await asOwner().query(api.songs.overview, { songId });
    expect(ov!.nextAction).toBe("On track");
  });

  it("update sets deadline + ownerMemberId, and overview reflects them", async () => {
    const { songId, ownerMemberId } = await seedBase();
    const deadline = 1_900_000_000_000;
    await asOwner().mutation(api.songs.update, {
      id: songId,
      deadline,
      ownerMemberId,
    });
    const ov = await asOwner().query(api.songs.overview, { songId });
    expect(ov!.deadline).toBe(deadline);
    expect(ov!.ownerMemberId).toBe(ownerMemberId as Id<"members">);
    expect(ov!.ownerName).toBe("Maya Owner");

    // Clearing with null removes both.
    await asOwner().mutation(api.songs.update, {
      id: songId,
      deadline: null,
      ownerMemberId: null,
    });
    const cleared = await asOwner().query(api.songs.overview, { songId });
    expect(cleared!.deadline).toBeUndefined();
    expect(cleared!.ownerMemberId).toBeNull();
  });

  it("returns null for a song outside the caller's org", async () => {
    const { songId } = await seedBase();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_other", name: "O", slug: "o", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_other", name: "X", role: "owner", clerkUserId: "u_x", skills: [],
      });
    });
    const stranger = t.withIdentity({ subject: "u_x", name: "X", orgId: "org_other" });
    const ov = await stranger.query(api.songs.overview, { songId });
    expect(ov).toBeNull();
  });
});
