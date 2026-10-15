import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrgWithCapability } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import { roomBusyIntervals, studioPullsGoogle } from "./lib/roomBusy";
import { recomputeRoomStatus } from "./lib/roomStatus";
import { stageChecklistsFor } from "./checklists";
import { ensureSessionShift } from "./shifts";
import { currentMemberId } from "./sessions";
import { normalizeEmail } from "./lib/emailKey";
import {
  matchRoom,
  matchClient,
  matchEngineer,
  isConfident,
  type ClientMatch,
  type MatchConfidence,
  type RoomMatch,
} from "./lib/googleRoomMatch";

/* ============================================================
   "From Google": events on the studio's Google calendar that are not
   Pulse bookings yet, with every detail the pull keeps (title, time,
   location, description, guests, link), the room, client and engineer
   they match, and whether the room is free in Pulse. Import turns one
   into a confirmed booking linked to the same Google event; Ignore hides
   it. With auto-import on, confident and conflict-free events import on
   every pull (googleCalendarSync.pullOrg).

   Reading needs `sessions.read`; importing, ignoring and the auto-import
   switch need `schedule.manage` (owners and managers). Descriptions and
   guest emails are studio-private: these functions only ever read the
   caller's own org, and no public page calls them.
   ============================================================ */

const DAY = 24 * 60 * 60 * 1000;
/** How far ahead the review list and auto-import look. */
export const REVIEW_WINDOW_MS = 60 * DAY;
const MAX_ROWS = 200;
const BULK_LIMIT = 50;

const serviceV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
  v.literal("custom"),
);

type Ctx = QueryCtx | MutationCtx;

/** Owners and managers (`schedule.manage`). Google sync is on every plan
 *  (docs/plans/hardcover-booking.md), so the Schedule module's plan gate does
 *  not apply here: only the permission does. */
function manageOrg(ctx: Ctx): Promise<string> {
  return currentOrgWithCapability(ctx, "schedule.manage", undefined, { entitlement: null });
}

/* ---------- shared reads ---------- */

async function orgDoc(ctx: Ctx, orgId: string): Promise<Doc<"orgs"> | null> {
  return await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
}

type People = {
  org: Doc<"orgs"> | null;
  rooms: Doc<"rooms">[];
  artists: Doc<"artists">[];
  members: Doc<"members">[];
  emails: { studioEmails: string[]; memberEmails: string[] };
};

async function people(ctx: Ctx, orgId: string): Promise<People> {
  const [org, rooms, artists, members] = await Promise.all([
    orgDoc(ctx, orgId),
    ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ]);
  return {
    org,
    rooms,
    artists,
    members,
    emails: {
      studioEmails: [org?.googleEmail, org?.ownerEmail].filter((e): e is string => Boolean(e)),
      memberEmails: members.map((m) => m.email).filter((e): e is string => Boolean(e)),
    },
  };
}

function eventForMatch(row: Doc<"googleEvents">) {
  return { title: row.title, location: row.location, attendees: row.attendees, organizerEmail: row.organizerEmail };
}

function roomsForMatch(p: People) {
  return p.rooms.map((r) => ({ _id: r._id as string, name: r.name, status: r.status }));
}

/** Upcoming events still waiting for a decision. */
async function pendingRows(ctx: Ctx, orgId: string, now: number): Promise<Doc<"googleEvents">[]> {
  const rows = await ctx.db
    .query("googleEvents")
    .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - DAY).lt("startTime", now + REVIEW_WINDOW_MS))
    .take(MAX_ROWS * 2);
  return rows.filter((r) => r.endTime > now && r.status !== "cancelled" && !r.importedSessionId && !r.ignoredAt);
}

/** Google event ids already behind a Pulse booking (pushed or imported). */
async function linkedEventIds(ctx: Ctx, orgId: string): Promise<Set<string>> {
  const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  return new Set(sessions.map((s) => s.googleCalendarEventId).filter((id): id is string => Boolean(id)));
}

export type ImportConflict = { kind: "session" | "block" | "google"; message: string };

/** Is the room busy in Pulse for this event's time? Google busy time from
 *  THIS event never counts, and neither does another Google event that names
 *  a different room with confidence (two rooms booked at once is normal). A
 *  Google event that names no room still holds the whole studio, as in
 *  lib/roomBusy.ts. */
export async function importConflict(
  ctx: Ctx,
  args: { orgId: string; roomId: Id<"rooms">; start: number; end: number; googleEventId: string; rooms: { _id: string; name: string; status?: string }[] },
): Promise<ImportConflict | null> {
  const busy = await roomBusyIntervals(ctx, { orgId: args.orgId, roomId: args.roomId, from: args.start, to: args.end });
  for (const b of busy) {
    if (b.kind === "session") {
      const s = await ctx.db.get(b.id as Id<"sessions">);
      if (s?.googleCalendarEventId === args.googleEventId) continue;
      return { kind: "session", message: `The room is already booked then${s ? ` (${s.title})` : ""}.` };
    }
    if (b.kind === "block") return { kind: "block", message: "The room is blocked then." };
    if (b.kind === "google") {
      const blk = await ctx.db.get(b.id as Id<"googleBusyBlocks">);
      if (!blk || blk.googleEventId === args.googleEventId) continue;
      const other = await ctx.db
        .query("googleEvents")
        .withIndex("by_event", (q) => q.eq("orgId", args.orgId).eq("googleEventId", blk.googleEventId))
        .first();
      const m = other ? matchRoom(eventForMatch(other), args.rooms) : null;
      if (m?.roomId && m.roomId !== args.roomId && isConfident(m.confidence)) continue;
      return {
        kind: "google",
        message:
          m?.roomId === args.roomId
            ? `"${blk.title}" is on the Google calendar for this room at the same time.`
            : `"${blk.title}" is on the Google calendar at the same time and names no room, so it holds the whole studio.`,
      };
    }
  }
  return null;
}

/* ---------- review list ---------- */

/** The "From Google" review list: upcoming events that are not bookings yet,
 *  each with its details and what Pulse matched. */
export const reviewList = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.read");
    const viewer = await resolveViewer(ctx);
    const canManage = viewer.capabilities.has("schedule.manage");
    const p = await people(ctx, orgId);
    const enabled = studioPullsGoogle(p.org);
    const base = { enabled, connected: Boolean(p.org?.googleRefreshToken), autoImport: p.org?.googleAutoImport === true, canManage };
    if (!enabled) return { ...base, events: [], confidentCount: 0 };

    const now = Date.now();
    const linked = await linkedEventIds(ctx, orgId);
    const rows = (await pendingRows(ctx, orgId, now)).filter((r) => !linked.has(r.googleEventId)).slice(0, MAX_ROWS);
    const rooms = roomsForMatch(p);
    const events = [];
    for (const r of rows) {
      const room = matchRoom(eventForMatch(r), rooms);
      const client = matchClient(eventForMatch(r), p.artists.map((a) => ({ _id: a._id, name: a.name, email: a.email })), p.emails);
      const engineer = matchEngineer(eventForMatch(r), p.members.map((m) => ({ _id: m._id, name: m.name, email: m.email, role: m.role })));
      const conflict = room.roomId
        ? await importConflict(ctx, { orgId, roomId: room.roomId as Id<"rooms">, start: r.startTime, end: r.endTime, googleEventId: r.googleEventId, rooms })
        : null;
      events.push({
        _id: r._id,
        googleEventId: r.googleEventId,
        title: r.title,
        startTime: r.startTime,
        endTime: r.endTime,
        allDay: r.allDay,
        location: r.location ?? null,
        description: r.description ?? null,
        attendees: r.attendees,
        organizerEmail: r.organizerEmail ?? null,
        organizerName: r.organizerName ?? null,
        htmlLink: r.htmlLink ?? null,
        status: r.status,
        recurring: Boolean(r.recurringEventId),
        room: { ...room, roomName: room.roomId ? (p.rooms.find((x) => x._id === room.roomId)?.name ?? null) : null },
        client,
        engineer,
        conflict,
      });
    }
    // What "Import all with a matched room" would take: a confident room, a
    // free room and a client it can name.
    const confident = events.filter(
      (e) => e.room.roomId && isConfident(e.room.confidence) && !e.conflict && e.client.kind !== "none",
    ).length;
    return { ...base, events, confidentCount: confident };
  },
});

/** Conflict check for a room the studio picked by hand in the review list. */
export const conflictFor = query({
  args: { eventId: v.id("googleEvents"), roomId: v.id("rooms") },
  handler: async (ctx, { eventId, roomId }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.read");
    const row = await ctx.db.get(eventId);
    const room = await ctx.db.get(roomId);
    if (!row || row.orgId !== orgId || !room || room.orgId !== orgId) return null;
    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return await importConflict(ctx, {
      orgId,
      roomId,
      start: row.startTime,
      end: row.endTime,
      googleEventId: row.googleEventId,
      rooms: rooms.map((r) => ({ _id: r._id, name: r.name, status: r.status })),
    });
  },
});

/* ---------- import ---------- */

type Choice = {
  /** undefined = use the match; null = no room. */
  roomId?: Id<"rooms"> | null;
  artistId?: Id<"artists">;
  newClient?: { name: string; email?: string };
  /** undefined = use the match; null = no engineer. */
  engineerId?: Id<"members"> | null;
  serviceType?: Doc<"sessions">["serviceType"];
  customService?: string;
};

type ImportResult = { sessionId: Id<"sessions">; already: boolean };

function staffNote(row: Doc<"googleEvents">): string {
  const lines = ["Imported from Google Calendar."];
  if (row.location) lines.push(`Location: ${row.location}`);
  const guests = row.attendees
    .filter((a) => !a.resource && !a.self)
    .map((a) => (a.name && a.email ? `${a.name} <${a.email}>` : (a.name ?? a.email ?? "")))
    .filter(Boolean);
  if (guests.length) lines.push(`Guests: ${guests.join(", ")}`);
  if (row.description) lines.push("", row.description);
  return lines.join("\n").slice(0, 4000);
}

/** Turn one Google event into a confirmed booking linked to it. Idempotent:
 *  an event already behind a booking returns that booking. */
async function importOne(
  ctx: MutationCtx,
  orgId: string,
  row: Doc<"googleEvents">,
  choice: Choice,
  opts: { createdBy?: Id<"members">; p: People; linked?: Set<string> },
): Promise<ImportResult> {
  if (row.orgId !== orgId) throw new ConvexError("Event not found.");
  if (row.importedSessionId) {
    const s = await ctx.db.get(row.importedSessionId);
    if (s) return { sessionId: s._id, already: true };
  }
  const linked = opts.linked ?? (await linkedEventIds(ctx, orgId));
  if (linked.has(row.googleEventId)) {
    const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const s = sessions.find((x) => x.googleCalendarEventId === row.googleEventId);
    if (s) {
      await ctx.db.patch(row._id, { importedSessionId: s._id, importedAt: row.importedAt ?? Date.now() });
      return { sessionId: s._id, already: true };
    }
  }
  if (row.status === "cancelled") throw new ConvexError("This event was cancelled in Google.");

  const { p } = opts;
  const rooms = roomsForMatch(p);
  const ev = eventForMatch(row);

  // Room: the studio's pick, else the match.
  let roomId: Id<"rooms"> | undefined;
  if (choice.roomId === null) roomId = undefined;
  else if (choice.roomId) {
    const room = p.rooms.find((r) => r._id === choice.roomId);
    if (!room) throw new ConvexError("Room not found.");
    roomId = room._id;
  } else {
    const m = matchRoom(ev, rooms);
    roomId = (m.roomId as Id<"rooms"> | null) ?? undefined;
  }
  if (roomId) {
    const conflict = await importConflict(ctx, { orgId, roomId, start: row.startTime, end: row.endTime, googleEventId: row.googleEventId, rooms });
    if (conflict) throw new ConvexError(conflict.message);
  }

  // Client: the studio's pick, a new client typed in, else the match.
  let artistId: Id<"artists">;
  let artistName: string;
  if (choice.artistId) {
    const a = p.artists.find((x) => x._id === choice.artistId);
    if (!a) throw new ConvexError("Client not found.");
    artistId = a._id;
    artistName = a.name;
  } else {
    let fresh = choice.newClient?.name?.trim() ? choice.newClient : undefined;
    if (!fresh) {
      const m: ClientMatch = matchClient(ev, p.artists.map((a) => ({ _id: a._id, name: a.name, email: a.email })), p.emails);
      if (m.kind === "existing") {
        artistId = m.artistId as Id<"artists">;
        artistName = m.name;
      } else if (m.kind === "new") fresh = { name: m.name, email: m.email };
      else throw new ConvexError("Pick a client for this booking.");
    }
    if (fresh) {
      const email = normalizeEmail(fresh.email) || undefined;
      const same = email ? p.artists.find((a) => normalizeEmail(a.email) === email) : undefined;
      if (same) {
        artistId = same._id;
        artistName = same.name;
      } else {
        artistName = fresh.name.trim().slice(0, 120);
        artistId = await ctx.db.insert("artists", {
          orgId,
          name: artistName,
          type: "artist",
          email,
          genres: [],
          tags: [],
          status: "lead",
          lifetimeValueCents: 0,
          sessionCount: 0,
          reliability: "solid",
          source: "google_calendar",
        });
        // Later events in the same run find this client by email.
        p.artists.push((await ctx.db.get(artistId))!);
      }
    }
  }

  // Engineer: the studio's pick, else a team member on the guest list.
  let engineerId: Id<"members"> | undefined;
  if (choice.engineerId === null) engineerId = undefined;
  else if (choice.engineerId) {
    const m = p.members.find((x) => x._id === choice.engineerId);
    if (!m) throw new ConvexError("Team member not found.");
    engineerId = m._id;
  } else {
    const m = matchEngineer(ev, p.members.map((x) => ({ _id: x._id, name: x.name, email: x.email, role: x.role })));
    engineerId = (m?.memberId as Id<"members"> | undefined) ?? undefined;
  }

  const serviceType = choice.serviceType ?? "recording";
  if (serviceType === "custom" && !choice.customService?.trim()) throw new ConvexError("Name the category for a custom booking.");
  const room = roomId ? p.rooms.find((r) => r._id === roomId) : undefined;
  const hours = Math.max(0, (row.endTime - row.startTime) / 3_600_000);
  const rateCents = room ? Math.round((room.hourlyRateCents ?? 0) * hours) : 0;

  const sessionId = await ctx.db.insert("sessions", {
    orgId,
    title: row.title,
    artistId: artistId!,
    serviceType,
    customService: serviceType === "custom" ? choice.customService?.trim() : undefined,
    roomId,
    engineerId,
    startTime: row.startTime,
    endTime: row.endTime,
    // It is already on the studio's calendar: a booking, not a hold.
    status: "confirmed",
    rateCents,
    depositCents: 0,
    depositPaid: false,
    intakeCompleted: false,
    source: "google",
    googleCalendarEventId: row.googleEventId,
    createdByMemberId: opts.createdBy,
  });
  linked.add(row.googleEventId);
  await ctx.db.patch(row._id, { importedSessionId: sessionId, importedAt: Date.now() });
  // The booking holds the time now; its old busy block would double it.
  const busy = await ctx.db
    .query("googleBusyBlocks")
    .withIndex("by_event", (q) => q.eq("orgId", orgId).eq("googleEventId", row.googleEventId))
    .first();
  if (busy) await ctx.db.delete(busy._id);

  await ctx.db.insert("sessionNotes", {
    orgId,
    sessionId,
    body: staffNote(row),
    authorMemberId: opts.createdBy,
    authorClerkUserId: "google_calendar",
    authorName: "Google Calendar",
    createdAt: Date.now(),
  });
  await ctx.db.insert("activity", {
    orgId,
    kind: "session.created",
    summary: `${row.title} imported from Google Calendar for ${artistName!}`,
    entityType: "session",
    entityId: sessionId,
    accent: "info",
  });
  await stageChecklistsFor(ctx, { orgId, sessionId, roomId });
  if (roomId) await recomputeRoomStatus(ctx, roomId);
  await ensureSessionShift(ctx, {
    _id: sessionId,
    orgId,
    engineerId: engineerId ?? null,
    roomId: roomId ?? null,
    startTime: row.startTime,
    endTime: row.endTime,
  });
  return { sessionId, already: false };
}

export const importEvent = mutation({
  args: {
    eventId: v.id("googleEvents"),
    roomId: v.optional(v.union(v.id("rooms"), v.null())),
    artistId: v.optional(v.id("artists")),
    newClient: v.optional(v.object({ name: v.string(), email: v.optional(v.string()) })),
    engineerId: v.optional(v.union(v.id("members"), v.null())),
    serviceType: v.optional(serviceV),
    customService: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, ...choice }) => {
    const orgId = await manageOrg(ctx);
    const row = await ctx.db.get(eventId);
    if (!row || row.orgId !== orgId) throw new ConvexError("Event not found.");
    const p = await people(ctx, orgId);
    return await importOne(ctx, orgId, row, choice, { createdBy: await currentMemberId(ctx), p });
  },
});

type BulkOutcome = { imported: number; skipped: { title: string; reason: string }[] };

/** Import every waiting event whose room match is confident, whose room is
 *  free, and whose client is known or can be created from a guest. */
async function importConfident(ctx: MutationCtx, orgId: string, createdBy?: Id<"members">): Promise<BulkOutcome> {
  const now = Date.now();
  const p = await people(ctx, orgId);
  const linked = await linkedEventIds(ctx, orgId);
  const rows = (await pendingRows(ctx, orgId, now)).filter((r) => !linked.has(r.googleEventId));
  const rooms = roomsForMatch(p);
  const out: BulkOutcome = { imported: 0, skipped: [] };
  for (const row of rows) {
    if (out.imported >= BULK_LIMIT) break;
    const room: RoomMatch = matchRoom(eventForMatch(row), rooms);
    if (!room.roomId || !isConfident(room.confidence as MatchConfidence)) continue;
    const client = matchClient(eventForMatch(row), p.artists.map((a) => ({ _id: a._id, name: a.name, email: a.email })), p.emails);
    if (client.kind === "none") {
      out.skipped.push({ title: row.title, reason: "No client on the event" });
      continue;
    }
    const conflict = await importConflict(ctx, {
      orgId,
      roomId: room.roomId as Id<"rooms">,
      start: row.startTime,
      end: row.endTime,
      googleEventId: row.googleEventId,
      rooms,
    });
    if (conflict) {
      out.skipped.push({ title: row.title, reason: conflict.message });
      continue;
    }
    await importOne(ctx, orgId, row, { roomId: room.roomId as Id<"rooms"> }, { createdBy, p, linked });
    out.imported++;
  }
  return out;
}

/** "Import all with a matched room" on the review list. */
export const importAllMatched = mutation({
  args: {},
  handler: async (ctx): Promise<BulkOutcome> => {
    const orgId = await manageOrg(ctx);
    const org = await orgDoc(ctx, orgId);
    if (!studioPullsGoogle(org)) throw new ConvexError("Google to Pulse sync is off for this studio.");
    return await importConfident(ctx, orgId, await currentMemberId(ctx));
  },
});

/** Run after each studio pull when the studio switched auto-import on. */
export const _autoImport = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<BulkOutcome | null> => {
    const org = await orgDoc(ctx, orgId);
    if (!org || org.googleAutoImport !== true || !studioPullsGoogle(org)) return null;
    return await importConfident(ctx, orgId);
  },
});

/* ---------- ignore + settings ---------- */

export const ignoreEvent = mutation({
  args: { eventId: v.id("googleEvents") },
  handler: async (ctx, { eventId }) => {
    const orgId = await manageOrg(ctx);
    const row = await ctx.db.get(eventId);
    if (!row || row.orgId !== orgId) throw new ConvexError("Event not found.");
    await ctx.db.patch(eventId, { ignoredAt: Date.now(), ignoredByMemberId: await currentMemberId(ctx) });
  },
});

export const unignoreEvent = mutation({
  args: { eventId: v.id("googleEvents") },
  handler: async (ctx, { eventId }) => {
    const orgId = await manageOrg(ctx);
    const row = await ctx.db.get(eventId);
    if (!row || row.orgId !== orgId) throw new ConvexError("Event not found.");
    await ctx.db.patch(eventId, { ignoredAt: undefined, ignoredByMemberId: undefined });
  },
});

/** The studio Google card's auto-import switch. */
export const setAutoImport = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const orgId = await manageOrg(ctx);
    const org = await orgDoc(ctx, orgId);
    if (!org) throw new ConvexError("Studio not found.");
    await ctx.db.patch(org._id, { googleAutoImport: enabled });
  },
});
