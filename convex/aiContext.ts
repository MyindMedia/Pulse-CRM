/* ============================================================
   V8-runtime queries that the Node-runtime AI actions in aiActions.ts
   use to pull + shape data. Keeping them in one place means the AI
   prompts stay close to the data layout they assume.
   ============================================================ */
import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { currentOrg } from "./lib/tenant";
import type { Id } from "./_generated/dataModel";

/** Shape for the session_recap prompt. */
export const sessionRecapContext = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    const [artist, song, room, engineer, log] = await Promise.all([
      ctx.db.get(session.artistId),
      session.songId ? ctx.db.get(session.songId) : null,
      session.roomId ? ctx.db.get(session.roomId) : null,
      session.engineerId ? ctx.db.get(session.engineerId) : null,
      ctx.db
        .query("engineeringLogs")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .first(),
    ]);
    return {
      session,
      artistName: artist?.name ?? "the artist",
      artistEmail: artist?.email,
      songTitle: song?.title,
      roomName: room?.name,
      engineerName: engineer?.name,
      log,
    };
  },
});

/** Shape for the prep_packet prompt. */
export const prepPacketContext = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    const [artist, song, room, engineer] = await Promise.all([
      ctx.db.get(session.artistId),
      session.songId ? ctx.db.get(session.songId) : null,
      session.roomId ? ctx.db.get(session.roomId) : null,
      session.engineerId ? ctx.db.get(session.engineerId) : null,
    ]);

    // Pull this artist's last 3 prior sessions for context-rich notes.
    const priorSessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).lte("startTime", session.startTime - 1),
      )
      .collect();
    const lastNotes = priorSessions
      .filter((s) => s.artistId === session.artistId && s.notes)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 3)
      .map((s) => s.notes)
      .join(" | ")
      .slice(0, 400);

    // Installed gear in the room - capped so the prompt stays small.
    let gear: string[] = [];
    if (session.roomId) {
      const gearRows = await ctx.db
        .query("equipment")
        .withIndex("by_org_room", (q) =>
          q.eq("orgId", orgId).eq("installedInRoomId", session.roomId),
        )
        .collect();
      gear = gearRows.map((g) => g.name);
    }

    return {
      session,
      artistName: artist?.name ?? "the artist",
      artistGenres: artist?.genres,
      songTitle: song?.title,
      roomName: room?.name,
      engineerName: engineer?.name,
      lastNotes: lastNotes || undefined,
      gear,
    };
  },
});

/** Lightweight context for reminder generation. */
export const reminderContext = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    const [artist, room] = await Promise.all([
      ctx.db.get(session.artistId),
      session.roomId ? ctx.db.get(session.roomId) : null,
    ]);
    return {
      session,
      artistName: artist?.name ?? "the artist",
      artistEmail: artist?.email,
      roomName: room?.name,
    };
  },
});

/** Aggregated weekly stats for the AI briefing, for an explicit org.
 * Sunday-anchored week. Shared by the public query (current org) and the
 * internal cron variant (explicit org). */
async function weeklyBriefingFor(ctx: QueryCtx, orgId: string) {
  {
    const now = Date.now();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay();
    const weekStart = today.getTime() - dow * 86_400_000;
    const weekEnd = weekStart + 7 * 86_400_000 - 1;

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const orgName = org?.name ?? "Pulse Studio";

    const allWeek = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", weekStart).lte("startTime", weekEnd),
      )
      .collect();

    let confirmedCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let noShowCount = 0;
    let depositRevenueCents = 0;
    let completedRevenueCents = 0;
    const artistCount = new Map<string, number>();
    const roomHours = new Map<string, number>();

    for (const s of allWeek) {
      if (s.status === "confirmed" || s.status === "in_progress") confirmedCount++;
      if (s.status === "completed") {
        completedCount++;
        completedRevenueCents += s.rateCents;
      }
      if (s.status === "cancelled") cancelledCount++;
      if (s.status === "no_show") noShowCount++;
      if (s.depositPaid) depositRevenueCents += s.depositCents;
      artistCount.set(s.artistId, (artistCount.get(s.artistId) ?? 0) + 1);
      if (s.roomId) {
        const hours = (s.endTime - s.startTime) / 3_600_000;
        roomHours.set(s.roomId, (roomHours.get(s.roomId) ?? 0) + hours);
      }
    }

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const roomMap = new Map(rooms.map((r) => [r._id, r] as const));
    // 12-hour bookable window across 7 days = 84 bookable hours / room / week
    const BOOKABLE_HOURS = 12 * 7;

    const topRooms = Array.from(roomHours.entries())
      .map(([id, hours]) => ({
        name: roomMap.get(id as Id<"rooms">)?.name ?? "Unknown",
        hours: Math.round(hours * 10) / 10,
        utilization: Math.round((hours / BOOKABLE_HOURS) * 100),
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 3);

    // Top artists this week.
    const allArtists = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const artistMap = new Map(allArtists.map((a) => [a._id, a] as const));
    const topArtists = Array.from(artistCount.entries())
      .map(([id, count]) => ({
        name: artistMap.get(id as Id<"artists">)?.name ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Churn risk: any active artist whose last contact is > 60 days ago.
    const SIXTY_DAYS = 60 * 86_400_000;
    const churnRisk = allArtists
      .filter(
        (a) =>
          a.status === "active" &&
          a.lastContactAt &&
          now - a.lastContactAt > SIXTY_DAYS,
      )
      .slice(0, 5)
      .map((a) => a.name);

    return {
      orgId,
      orgName,
      weekStart,
      weekEnd,
      confirmedCount,
      completedCount,
      cancelledCount,
      noShowCount,
      depositRevenueCents,
      completedRevenueCents,
      topArtists,
      topRooms,
      churnRisk,
    };
  }
}

/** Public: weekly briefing context for the caller's active org. */
export const weeklyBriefingContext = query({
  args: {},
  handler: async (ctx) => weeklyBriefingFor(ctx, await currentOrg(ctx)),
});

/** Internal: weekly briefing context for an explicit org (cron fan-out). */
export const weeklyBriefingContextForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => weeklyBriefingFor(ctx, orgId),
});

/** Find underused (room, weekday, hour-window) combinations over the last
 * 8 weeks, for an explicit org. Rule-based; the AI just writes the copy. */
async function rateCutFor(ctx: QueryCtx, orgId: string) {
  {
    const now = Date.now();
    const WEEKS = 8;
    const windowStart = now - WEEKS * 7 * 86_400_000;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", windowStart).lte("startTime", now),
      )
      .collect();

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const bookable = rooms.filter((r) => r.bookable !== false && r.status !== "retired");

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const orgName = org?.name ?? "Pulse Studio";

    // Per (room, weekday, day-part), count booked hours.
    // Day-parts: morning (9-12), afternoon (12-17), evening (17-22).
    const dayParts = [
      { id: "morning", label: "morning (9am-12pm)", startHour: 9, endHour: 12 },
      { id: "afternoon", label: "afternoon (12pm-5pm)", startHour: 12, endHour: 17 },
      { id: "evening", label: "evening (5pm-10pm)", startHour: 17, endHour: 22 },
    ] as const;
    const weekdays = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    type Rec = {
      roomId: Id<"rooms">;
      roomName: string;
      roomSlug: string;
      windowLabel: string;
      currentRateCents: number;
      newRateCents: number;
      cutPct: number;
      lowUtilHours: number;
      minimumHours: number;
      discountCode: string;
      minBlockCents: number;
    };
    const recs: Rec[] = [];

    for (const room of bookable) {
      const roomSessions = sessions.filter(
        (s) =>
          s.roomId === room._id &&
          s.status !== "cancelled" &&
          s.status !== "no_show",
      );
      for (const wd of weekdays.keys()) {
        for (const part of dayParts) {
          // Sum booked hours within this (weekday, daypart) bucket
          let bookedHours = 0;
          for (const s of roomSessions) {
            const d = new Date(s.startTime);
            if (d.getDay() !== wd) continue;
            const h = d.getHours();
            if (h < part.startHour || h >= part.endHour) continue;
            bookedHours += (s.endTime - s.startTime) / 3_600_000;
          }
          // Total bookable hours in the bucket over the analysis window
          const partHours = part.endHour - part.startHour;
          const bucketHours = WEEKS * partHours; // 1 day/week
          const utilization = bookedHours / bucketHours;
          if (utilization < 0.4 && bucketHours - bookedHours >= 8) {
            const rateCents = room.hourlyRateCents ?? 0;
            const cutPct = utilization < 0.2 ? 20 : 15;
            const newRateCents = Math.round((rateCents * (100 - cutPct)) / 100);
            const minimumHours = room.minimumHours ?? 2;
            const minBlockCents = newRateCents * minimumHours;
            // Deterministic code: ROOM-DAYPART-PCT. Short + memorable.
            const roomKey = room.name.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase();
            const dayKey = weekdays[wd].slice(0, 3).toUpperCase();
            const partKey = part.id.slice(0, 3).toUpperCase();
            const discountCode = `${roomKey}${dayKey}${partKey}${cutPct}`;
            recs.push({
              roomId: room._id,
              roomName: room.name,
              roomSlug: room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              windowLabel: `${weekdays[wd]} ${part.label}`,
              currentRateCents: rateCents,
              newRateCents,
              cutPct,
              lowUtilHours: Math.round(bucketHours - bookedHours),
              minimumHours,
              discountCode,
              minBlockCents,
            });
          }
        }
      }
    }

    // Cap to top 3 worst-performing windows so we don't spam the studio.
    recs.sort((a, b) => b.lowUtilHours - a.lowUtilHours);
    const recommendations = recs.slice(0, 3);

    // Audience size = artists with completed sessions ever.
    const allArtists = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const audienceSize = allArtists.filter((a) => (a.sessionCount ?? 0) > 0).length;

    return {
      orgId,
      orgName,
      orgSlug: org?.slug ?? null,
      recommendations,
      audienceSize,
    };
  }
}

/** Public: rate-cut context for the caller's active org. */
export const rateCutContext = query({
  args: {},
  handler: async (ctx) => rateCutFor(ctx, await currentOrg(ctx)),
});

/** Internal: rate-cut context for an explicit org (cron fan-out). */
export const rateCutContextForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => rateCutFor(ctx, orgId),
});

// Shared data shapes so the AI actions can type their writer helpers.
export type WeeklyBriefingData = Awaited<ReturnType<typeof weeklyBriefingFor>>;
export type RateCutData = Awaited<ReturnType<typeof rateCutFor>>;
