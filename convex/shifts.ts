import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { requireCapability, resolveViewer } from "./lib/access";
import { notify } from "./lib/notify";

/* ============================================================
   Staff scheduling. A shift assigns a team member to a time
   window and (optionally) a studio/room. kind "session" shifts
   are auto-created when an engineer is booked onto a session
   (see ensureSessionShift, called from sessions.create).
   ============================================================ */

const DAY = 86_400_000;

function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

async function hydrate(ctx: QueryCtx | MutationCtx, shift: Doc<"shifts">) {
  const member = await ctx.db.get(shift.memberId);
  const room = shift.roomId ? await ctx.db.get(shift.roomId) : null;
  return {
    ...shift,
    memberName: member?.name ?? "—",
    memberRole: member?.role ?? null,
    memberPhotoId: member?.photoId ?? null,
    roomName: room?.name ?? null,
  };
}

/** Non-cancelled shifts for a member that overlap [start,end] (excludes `exceptId`). */
async function memberConflicts(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  memberId: Id<"members">,
  start: number,
  end: number,
  exceptId?: Id<"shifts">,
) {
  const rows = await ctx.db
    .query("shifts")
    .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", memberId))
    .collect();
  return rows.filter(
    (s) => s._id !== exceptId && s.status !== "cancelled" && overlaps(start, end, s.startTime, s.endTime),
  );
}

// ── Reads ───────────────────────────────────────────────────

/** Shifts whose start falls in [from,to] (week grid). Manager view. */
export const listRange = query({
  args: { from: v.number(), to: v.number(), roomId: v.optional(v.id("rooms")) },
  handler: async (ctx, { from, to, roomId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from).lte("startTime", to))
      .collect();
    const active = rows.filter((s) => s.status !== "cancelled" && (!roomId || s.roomId === roomId));
    return Promise.all(active.map((s) => hydrate(ctx, s)));
  },
});

/** Who's on shift right now + the rest of today. Dashboard widget. */
export const whosWorking = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - DAY).lte("startTime", now + DAY))
      .collect();
    const live = rows.filter((s) => s.status !== "cancelled" && s.startTime <= now && s.endTime >= now);
    const upcoming = rows
      .filter((s) => s.status !== "cancelled" && s.startTime > now && s.startTime < now + DAY)
      .sort((a, b) => a.startTime - b.startTime);
    return {
      now: await Promise.all(live.map((s) => hydrate(ctx, s))),
      upcoming: await Promise.all(upcoming.slice(0, 8).map((s) => hydrate(ctx, s))),
    };
  },
});

/** The signed-in staff member's own upcoming shifts + assigned sessions. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const viewer = await resolveViewer(ctx).catch(() => null);
    const clerkUserId = viewer && "clerkUserId" in viewer ? viewer.clerkUserId : null;
    const me = clerkUserId
      ? await ctx.db
          .query("members")
          .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
          .first()
      : null;
    if (!me) return { member: null, shifts: [], sessions: [] };
    const now = Date.now();
    const shifts = (
      await ctx.db
        .query("shifts")
        .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", me._id))
        .collect()
    )
      .filter((s) => s.status !== "cancelled" && s.endTime >= now)
      .sort((a, b) => a.startTime - b.startTime);
    const sessions = (
      await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    )
      .filter((s) => s.engineerId === me._id && s.endTime >= now)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, 20);
    return {
      member: { _id: me._id, name: me.name, role: me.role },
      shifts: await Promise.all(shifts.map((s) => hydrate(ctx, s))),
      sessions,
    };
  },
});

/** Upcoming engineering sessions (next 14 days) with NO engineer assigned —
 *  coverage gaps to fill. "Engineering" = recording/mixing/mastering/production. */
export const unstaffedSessions = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const horizon = now + 14 * DAY;
    const NEEDS = new Set(["recording", "mixing", "mastering", "production"]);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const gaps = sessions.filter(
      (s) =>
        !s.engineerId &&
        s.status !== "cancelled" &&
        s.startTime >= now &&
        s.startTime <= horizon &&
        NEEDS.has(s.serviceType),
    );
    return Promise.all(
      gaps
        .sort((a, b) => a.startTime - b.startTime)
        .map(async (s) => {
          const room = s.roomId ? await ctx.db.get(s.roomId) : null;
          const artist = await ctx.db.get(s.artistId);
          return {
            _id: s._id,
            title: s.title,
            startTime: s.startTime,
            serviceType: s.serviceType,
            roomName: room?.name ?? null,
            clientName: artist?.name ?? "Client",
          };
        }),
    );
  },
});

/** Per-staff scheduled hours + shift/session counts in a window. Reports view. */
export const staffingSummary = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from).lte("startTime", to))
      .collect();
    const agg = new Map<string, { hours: number; shifts: number; sessions: number }>();
    for (const s of rows) {
      if (s.status === "cancelled") continue;
      const e = agg.get(s.memberId) ?? { hours: 0, shifts: 0, sessions: 0 };
      e.hours += (s.endTime - s.startTime) / 3_600_000;
      e.shifts += 1;
      if (s.kind === "session") e.sessions += 1;
      agg.set(s.memberId, e);
    }
    const out = [];
    for (const [memberId, e] of agg) {
      const m = await ctx.db.get(memberId as Id<"members">);
      out.push({
        memberId,
        name: m?.name ?? "—",
        role: m?.role ?? null,
        hours: Math.round(e.hours * 10) / 10,
        shifts: e.shifts,
        sessions: e.sessions,
      });
    }
    return out.sort((a, b) => b.hours - a.hours);
  },
});

// ── Writes (manager) ────────────────────────────────────────

export const create = mutation({
  args: {
    memberId: v.id("members"),
    startTime: v.number(),
    endTime: v.number(),
    roomId: v.optional(v.id("rooms")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "schedule.manage");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(args.memberId);
    if (!member || member.orgId !== orgId) throw new Error("Team member not found");
    if (args.endTime <= args.startTime) throw new Error("Shift must end after it starts");

    const conflicts = await memberConflicts(ctx, orgId, args.memberId, args.startTime, args.endTime);
    const shiftId = await ctx.db.insert("shifts", {
      orgId,
      memberId: args.memberId,
      startTime: args.startTime,
      endTime: args.endTime,
      roomId: args.roomId,
      kind: "scheduled",
      status: "scheduled",
      note: args.note,
      createdBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
    });

    const room = args.roomId ? await ctx.db.get(args.roomId) : null;
    const when = new Date(args.startTime).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    if (member.email) {
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: member.email,
        subject: "You've been scheduled",
        body: `You're scheduled ${when}${room ? ` in ${room.name}` : ""}. See your schedule in Pulse.`,
        kind: "shift.assigned",
      });
    }
    await ctx.db.insert("activity", {
      orgId,
      kind: "shift.scheduled",
      summary: `${member.name} scheduled ${when}${room ? ` · ${room.name}` : ""}`,
      accent: "neutral",
    });
    return { shiftId, conflict: conflicts.length > 0 };
  },
});

export const update = mutation({
  args: {
    shiftId: v.id("shifts"),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    roomId: v.optional(v.id("rooms")),
    note: v.optional(v.string()),
    status: v.optional(v.union(v.literal("scheduled"), v.literal("confirmed"), v.literal("cancelled"))),
  },
  handler: async (ctx, { shiftId, ...patch }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "schedule.manage");
    const shift = await ctx.db.get(shiftId);
    if (!shift || shift.orgId !== orgId) throw new Error("Shift not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.db.patch(shiftId, clean);
    const start = (patch.startTime ?? shift.startTime) as number;
    const end = (patch.endTime ?? shift.endTime) as number;
    const conflicts = await memberConflicts(ctx, orgId, shift.memberId, start, end, shiftId);
    return { conflict: conflicts.length > 0 };
  },
});

export const cancel = mutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, { shiftId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "schedule.manage");
    const shift = await ctx.db.get(shiftId);
    if (!shift || shift.orgId !== orgId) throw new Error("Shift not found");
    await ctx.db.patch(shiftId, { status: "cancelled" });
  },
});

// ── Session integration (called from sessions.create) ───────

/**
 * Auto-create / sync the "session" shift for a session's engineer and return a
 * soft-warning if the engineer is double-booked. Never throws — staffing is a
 * nudge, not a gate. Safe to call when there's no engineer/room/time.
 */
export async function ensureSessionShift(
  ctx: MutationCtx,
  session: {
    _id: Id<"sessions">;
    orgId: string;
    engineerId?: Id<"members"> | null;
    roomId?: Id<"rooms"> | null;
    startTime: number;
    endTime: number;
  },
): Promise<{ warning: string | null }> {
  if (!session.engineerId) return { warning: null };
  const engineer = await ctx.db.get(session.engineerId);
  if (!engineer || engineer.orgId !== session.orgId) return { warning: null };

  // Conflicts = the engineer's OTHER non-cancelled shifts overlapping this time.
  const existing = await ctx.db
    .query("shifts")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .first();
  const conflicts = await memberConflicts(
    ctx, session.orgId, session.engineerId, session.startTime, session.endTime, existing?._id,
  );

  if (existing) {
    await ctx.db.patch(existing._id, {
      memberId: session.engineerId,
      startTime: session.startTime,
      endTime: session.endTime,
      roomId: session.roomId ?? undefined,
      status: existing.status === "cancelled" ? "scheduled" : existing.status,
    });
  } else {
    await ctx.db.insert("shifts", {
      orgId: session.orgId,
      memberId: session.engineerId,
      startTime: session.startTime,
      endTime: session.endTime,
      roomId: session.roomId ?? undefined,
      kind: "session",
      sessionId: session._id,
      status: "scheduled",
    });
    if (engineer.email) {
      const when = new Date(session.startTime).toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      await notify(ctx, {
        orgId: session.orgId,
        channel: "email",
        recipient: engineer.email,
        subject: "You're booked on a session",
        body: `You're engineering a session ${when}. Check Pulse for details.`,
        kind: "session.assigned",
        sessionId: session._id,
      });
    }
  }

  return {
    warning: conflicts.length
      ? `Heads up — ${engineer.name} is already booked in that window (${conflicts.length} overlap${conflicts.length > 1 ? "s" : ""}).`
      : null,
  };
}
