import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;
const initT = () => convexTest(schema);

/* Conversion + referral surface of the public booking page:
   - referral attribution (?ref=<artistId>) on createBooking
   - social-proof exposure (testimonials + engineer bios) via studioFront
   - the testimonials + engineer-profile settings setters (authz + write). */
describe("booking conversion + referral", () => {
  let t: ReturnType<typeof initT>;
  let roomA: Id<"rooms">;
  let referrer: Id<"artists">; // an org1 artist who can refer others
  let foreignReferrer: Id<"artists">; // an org2 artist - must be ignored cross-org
  let orgPost: Id<"socialPosts">; // an org1 socialPosts row usable as ?src=
  let foreignPost: Id<"socialPosts">; // an org2 socialPosts row - must be ignored cross-org
  let start: number;

  beforeEach(async () => {
    t = initT();
    start = Date.now() + 7 * DAY;
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Studio One", slug: "studio-one", plan: "studio", status: "active",
      });
      await ctx.db.insert("orgs", {
        orgId: "org2", name: "Studio Two", slug: "studio-two", plan: "studio", status: "active",
      });
      const a = await ctx.db.insert("rooms", {
        orgId: "org1", name: "Room A", status: "available", bookable: true,
        hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
      });
      const ref = await ctx.db.insert("artists", {
        orgId: "org1", name: "Referrer", type: "artist", email: "ref@org1.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0,
        reliability: "solid",
      });
      const foreign = await ctx.db.insert("artists", {
        orgId: "org2", name: "Foreigner", type: "artist", email: "ref@org2.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0,
        reliability: "solid",
      });
      const postBase = {
        template: "custom" as const, status: "published" as const, caption: "x",
        media: [], accountIds: [], scheduledFor: 0, timezone: "UTC",
        ghlType: "post" as const, submittedBy: "u", createdAt: 0, updatedAt: 0,
      };
      const post = await ctx.db.insert("socialPosts", { orgId: "org1", ...postBase });
      const foreignP = await ctx.db.insert("socialPosts", { orgId: "org2", ...postBase });
      return { a, ref, foreign, post, foreignP };
    });
    roomA = ids.a;
    referrer = ids.ref;
    foreignReferrer = ids.foreign;
    orgPost = ids.post;
    foreignPost = ids.foreignP;
  });

  async function artistByEmail(email: string) {
    return t.run(async (ctx) =>
      (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", "org1")).collect())
        .find((x) => x.email?.toLowerCase() === email.toLowerCase()) ?? null,
    );
  }

  it("a valid same-org ref sets referredByArtistId + source referral", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Nova", clientEmail: "nova@x.com",
      startTime: start, durationHours: 2, ref: referrer,
    });
    const nova = await artistByEmail("nova@x.com");
    expect(nova?.referredByArtistId).toBe(referrer);
    expect(nova?.source).toBe("referral");
  });

  it("a cross-org ref is ignored (no referrer, first-touch source stands)", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Max", clientEmail: "max@x.com",
      startTime: start, durationHours: 2, ref: foreignReferrer,
    });
    const max = await artistByEmail("max@x.com");
    expect(max?.referredByArtistId).toBeUndefined();
    expect(max?.source).not.toBe("referral");
    expect(max?.source).toBe("web_booking");
  });

  it("a garbage ref never errors the booking and is ignored", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Sky", clientEmail: "sky@x.com",
      startTime: start, durationHours: 2, ref: "not-a-real-id",
    });
    expect(res.sessionId).toBeDefined();
    const sky = await artistByEmail("sky@x.com");
    expect(sky?.referredByArtistId).toBeUndefined();
  });

  it("no ref preserves the default web-booking attribution", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Rae", clientEmail: "rae@x.com",
      startTime: start, durationHours: 2,
    });
    const rae = await artistByEmail("rae@x.com");
    expect(rae?.source).toBe("web_booking");
    expect(rae?.referredByArtistId).toBeUndefined();
  });

  it("a valid same-org src resolves to postId on the booked bookingVisits row", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Ivy", clientEmail: "ivy@x.com",
      startTime: start, durationHours: 2, visitorKey: "visitor-src1", src: orgPost,
    });
    const rows = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
    const booked = rows.find((r) => r.step === "booked");
    expect(booked?.postId).toBe(orgPost);
  });

  it("a cross-org src is silently ignored (postId undefined, booking still succeeds)", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Jude", clientEmail: "jude@x.com",
      startTime: start, durationHours: 2, visitorKey: "visitor-src2", src: foreignPost,
    });
    expect(res.sessionId).toBeDefined();
    const rows = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
    const booked = rows.find((r) => r.step === "booked");
    expect(booked).toBeDefined();
    expect(booked?.postId).toBeUndefined();
  });

  it("a garbage src is silently ignored (postId undefined, booking still succeeds)", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Kit", clientEmail: "kit@x.com",
      startTime: start, durationHours: 2, visitorKey: "visitor-src3", src: "not-a-real-id",
    });
    expect(res.sessionId).toBeDefined();
    const rows = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
    const booked = rows.find((r) => r.step === "booked");
    expect(booked).toBeDefined();
    expect(booked?.postId).toBeUndefined();
  });

  it("studioFront exposes curated testimonials + engineer bios/credits", async () => {
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org1")).first())!;
      await ctx.db.patch(org._id, {
        testimonials: [{ author: "Jordan", role: "Artist", quote: "Best room in town.", rating: 5 }],
      });
      await ctx.db.insert("members", {
        orgId: "org1", name: "Ace", role: "engineer", skills: [],
        bio: "Grammy-nominated mix engineer.", credits: ["Album X", "Single Y"],
      });
    });
    const front = await t.query(api.booking.studioFront, { slug: "studio-one" });
    expect(front?.testimonials?.[0]?.quote).toBe("Best room in town.");
    const ace = front?.engineers?.find((e) => e.name === "Ace");
    expect(ace?.bio).toContain("Grammy");
    expect(ace?.credits).toContain("Album X");
  });
});

describe("conversion settings setters (authz + write)", () => {
  let t: ReturnType<typeof initT>;
  let engineerId: Id<"members">;

  beforeEach(async () => {
    t = initT();
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s", name: "S", slug: "s", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_s", name: "Owner", role: "owner", clerkUserId: "u_o", skills: [],
      });
      await ctx.db.insert("members", {
        orgId: "org_s", name: "Intern", role: "intern", clerkUserId: "u_i", skills: [],
      });
      const eng = await ctx.db.insert("members", {
        orgId: "org_s", name: "Eng", role: "engineer", clerkUserId: "u_e", skills: [],
      });
      return { eng };
    });
    engineerId = ids.eng;
  });

  it("owner can set testimonials; intern cannot", async () => {
    const owner = t.withIdentity({ subject: "u_o", name: "Owner", orgId: "org_s" });
    await owner.mutation(api.orgs.setTestimonials, {
      testimonials: [
        { author: "Kai", quote: "Incredible session.", rating: 5 },
        { author: "", quote: "dropped - no author", rating: 4 }, // pruned
      ],
    });
    const org = await t.run((ctx) =>
      ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first(),
    );
    expect(org?.testimonials?.length).toBe(1);
    expect(org?.testimonials?.[0]?.author).toBe("Kai");

    const intern = t.withIdentity({ subject: "u_i", name: "Intern", orgId: "org_s" });
    await expect(
      intern.mutation(api.orgs.setTestimonials, {
        testimonials: [{ author: "X", quote: "y" }],
      }),
    ).rejects.toThrow();
  });

  it("owner can set an engineer's bio + credits; empties are dropped", async () => {
    const owner = t.withIdentity({ subject: "u_o", name: "Owner", orgId: "org_s" });
    await owner.mutation(api.members.setProfile, {
      id: engineerId,
      bio: "  Vocal-forward specialist.  ",
      credits: ["Record A", "  ", "Record B"],
    });
    const eng = await t.run((ctx) => ctx.db.get(engineerId));
    expect(eng?.bio).toBe("Vocal-forward specialist.");
    expect(eng?.credits).toEqual(["Record A", "Record B"]);
  });

  it("intern cannot set an engineer profile", async () => {
    const intern = t.withIdentity({ subject: "u_i", name: "Intern", orgId: "org_s" });
    await expect(
      intern.mutation(api.members.setProfile, { id: engineerId, bio: "nope" }),
    ).rejects.toThrow();
  });
});
