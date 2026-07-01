import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A fixed "now" pinned to midday so the local day math is stable. */
const NOON = (() => {
  const d = new Date(2026, 5, 15, 12, 0, 0, 0); // Jun 15 2026, 12:00 local
  return d.getTime();
})();

/** Seed a studio + owner member and return helpers to build the day. */
async function seedStudio(orgId: string) {
  const t = convexTest(schema);
  const ownerClerk = `u_owner_${orgId}`;
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { orgId, name: "Studio A", status: "available" }),
  );
  await t.run((ctx) =>
    ctx.db.insert("members", {
      orgId,
      name: "Owner",
      role: "owner",
      skills: [],
      clerkUserId: ownerClerk,
    }),
  );
  const engId = await t.run((ctx) =>
    ctx.db.insert("members", { orgId, name: "Nova", role: "engineer", skills: [] }),
  );
  const artistId = await t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId,
      name: "Client One",
      type: "artist",
      genres: [],
      tags: [],
      status: "active",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
    }),
  );
  const asOwner = t.withIdentity({ subject: ownerClerk, orgId });
  return { t, asOwner, roomId, engId, artistId };
}

type SessionSeed = {
  orgId: string;
  title: string;
  artistId: Id<"artists">;
  roomId?: Id<"rooms">;
  engineerId?: Id<"members">;
  startTime: number;
  endTime: number;
  status: "tentative" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  rateCents: number;
  amountPaidCents?: number;
};

function insertSession(t: ReturnType<typeof convexTest>, s: SessionSeed) {
  return t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId: s.orgId,
      title: s.title,
      artistId: s.artistId,
      serviceType: "recording",
      roomId: s.roomId,
      engineerId: s.engineerId,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      rateCents: s.rateCents,
      depositCents: 0,
      depositPaid: false,
      intakeCompleted: false,
      amountPaidCents: s.amountPaidCents,
    }),
  );
}

describe("today command center", () => {
  it("returns today's sessions in time order, filtered to the day", async () => {
    const org = "studio_today_order";
    const { t, asOwner, roomId, artistId } = await seedStudio(org);
    // Two today, out of insert order; one yesterday, one tomorrow.
    await insertSession(t, { orgId: org, title: "Afternoon", artistId, roomId, startTime: NOON + 3 * HOUR, endTime: NOON + 5 * HOUR, status: "confirmed", rateCents: 20_000 });
    await insertSession(t, { orgId: org, title: "Morning", artistId, roomId, startTime: NOON - 3 * HOUR, endTime: NOON - 1 * HOUR, status: "completed", rateCents: 20_000 });
    await insertSession(t, { orgId: org, title: "Yesterday", artistId, roomId, startTime: NOON - DAY, endTime: NOON - DAY + HOUR, status: "completed", rateCents: 20_000 });
    await insertSession(t, { orgId: org, title: "Tomorrow", artistId, roomId, startTime: NOON + DAY, endTime: NOON + DAY + HOUR, status: "confirmed", rateCents: 20_000 });

    const res = await asOwner.query(api.today.today, { nowMs: NOON });
    expect(res.sessions.map((s) => s.title)).toEqual(["Morning", "Afternoon"]);
    expect(res.tomorrow.count).toBe(1);
    expect(res.tomorrow.firstStart).toBe(NOON + DAY);
  });

  it("sums balances due today (rate minus paid) and lists them", async () => {
    const org = "studio_today_balances";
    const { t, asOwner, roomId, artistId } = await seedStudio(org);
    await insertSession(t, { orgId: org, title: "Owes 150", artistId, roomId, startTime: NOON + HOUR, endTime: NOON + 2 * HOUR, status: "confirmed", rateCents: 20_000, amountPaidCents: 5_000 });
    await insertSession(t, { orgId: org, title: "Paid full", artistId, roomId, startTime: NOON + 3 * HOUR, endTime: NOON + 4 * HOUR, status: "confirmed", rateCents: 10_000, amountPaidCents: 10_000 });
    await insertSession(t, { orgId: org, title: "Cancelled owes", artistId, roomId, startTime: NOON + 5 * HOUR, endTime: NOON + 6 * HOUR, status: "cancelled", rateCents: 30_000, amountPaidCents: 0 });

    const res = await asOwner.query(api.today.today, { nowMs: NOON });
    expect(res.canSeeFinancials).toBe(true);
    // 15,000 owed on the one live session; cancelled + paid-in-full excluded.
    expect(res.balances.dueCents).toBe(15_000);
    expect(res.balances.count).toBe(1);
    expect(res.balances.list[0].title).toBe("Owes 150");
  });

  it("computes per-room busy-until for a live session", async () => {
    const org = "studio_today_busy";
    const { t, asOwner, roomId, artistId } = await seedStudio(org);
    const end = NOON + 2 * HOUR;
    await insertSession(t, { orgId: org, title: "Live now", artistId, roomId, startTime: NOON - HOUR, endTime: end, status: "in_progress", rateCents: 20_000 });

    const res = await asOwner.query(api.today.today, { nowMs: NOON });
    const room = res.rooms.find((r) => r.roomId === roomId)!;
    expect(room.busyUntil).toBe(end);
    expect(room.busyWith).toBe("Live now");
    expect(res.counts.live).toBe(1);
  });

  it("lists next arrivals (not yet started) and staff on shift", async () => {
    const org = "studio_today_arrivals";
    const { t, asOwner, roomId, engId, artistId } = await seedStudio(org);
    await insertSession(t, { orgId: org, title: "Upcoming", artistId, roomId, engineerId: engId, startTime: NOON + 2 * HOUR, endTime: NOON + 3 * HOUR, status: "confirmed", rateCents: 20_000 });
    await insertSession(t, { orgId: org, title: "Already ran", artistId, roomId, startTime: NOON - 3 * HOUR, endTime: NOON - HOUR, status: "completed", rateCents: 20_000 });
    // A shift spanning now.
    await t.run((ctx) =>
      ctx.db.insert("shifts", { orgId: org, memberId: engId, roomId, startTime: NOON - HOUR, endTime: NOON + 4 * HOUR, kind: "scheduled", status: "scheduled" }),
    );

    const res = await asOwner.query(api.today.today, { nowMs: NOON });
    expect(res.arrivals.map((a) => a.title)).toEqual(["Upcoming"]);
    expect(res.staffOnShift.length).toBe(1);
    expect(res.staffOnShift[0].memberName).toBe("Nova");
    expect(res.staffOnShift[0].onNow).toBe(true);
    expect(res.counts.staffOnShift).toBe(1);
  });

  it("isolates orgs - another studio's sessions never leak", async () => {
    const org = "studio_today_iso_a";
    const { t, asOwner, roomId, artistId } = await seedStudio(org);
    await insertSession(t, { orgId: org, title: "Ours", artistId, roomId, startTime: NOON + HOUR, endTime: NOON + 2 * HOUR, status: "confirmed", rateCents: 20_000 });
    // A second org's session on the same day - must be invisible to org A.
    const otherArtist = await t.run((ctx) =>
      ctx.db.insert("artists", { orgId: "studio_today_iso_b", name: "Their Client", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" }),
    );
    await insertSession(t, { orgId: "studio_today_iso_b", title: "Theirs", artistId: otherArtist, startTime: NOON + HOUR, endTime: NOON + 2 * HOUR, status: "confirmed", rateCents: 99_000 });

    const res = await asOwner.query(api.today.today, { nowMs: NOON });
    expect(res.sessions.map((s) => s.title)).toEqual(["Ours"]);
    expect(res.sessions.every((s) => s.title !== "Theirs")).toBe(true);
  });
});
