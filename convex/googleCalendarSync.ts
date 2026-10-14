import { action, query, internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import {
  googleConfigured,
  googleCalendarListEvents,
  GoogleSyncTokenExpired,
  isInvalidGrant,
  PULSE_ORIGIN_TAG,
  RECONNECT_REQUIRED,
  type GoogleCalendarListEvent,
} from "./lib/google";
import { studioPullsGoogle, studioPushesGoogle } from "./lib/roomBusy";

/* ============================================================
   Inbound Google Calendar sync (Google -> Pulse).

   The READ half of two-way sync. Studios that still run their
   schedule in Google connect their account once (same OAuth that
   powers Gmail send + outbound calendar push); a cron then pulls
   their PRIMARY calendar's events in as org-wide *busy blocks* so
   the schedule reflects outside bookings and the studio doesn't
   double-book against them.

   Design (grilled 2026-06-01):
   - Busy blocks, not sessions (no fabricated artist/room/rate).
   - Primary calendar; Pulse-origin events skipped so nothing loops
     (tagged via extendedProperties + matched against session ids).
   - Incremental via Google syncToken; a 410 resets to a full pull.
   - Soft: blocks render on the calendar for awareness; they do not
     hard-block bookings (the primary calendar may hold personal
     events, and the codebase pattern is soft-warn, never block).
   ============================================================ */

const FULL_PULL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // ignore events older than a week on a full pull

/* ---------- pure mapping (unit-tested without the network) ---------- */

export type MappedBlock = {
  googleEventId: string;
  title: string;
  startTime: number;
  endTime: number;
  allDay: boolean;
};

export type MapResult =
  | { kind: "upsert"; block: MappedBlock }
  | { kind: "cancel"; googleEventId: string }
  | { kind: "skip" };

/** Parse a Google start/end into epoch ms. `dateTime` = timed event;
 *  `date` = all-day (date-only, treated as UTC midnight). */
export function parseGoogleTime(t?: { dateTime?: string; date?: string }): number | null {
  if (!t) return null;
  if (t.dateTime) {
    const ms = Date.parse(t.dateTime);
    return Number.isNaN(ms) ? null : ms;
  }
  if (t.date) {
    const ms = Date.parse(`${t.date}T00:00:00Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Pure: one raw Google event -> what to do with it. `pulseEventIds` is the set
 *  of Google event ids that Pulse itself created (so we never re-import a Pulse
 *  session as a block). */
export function mapGoogleEvent(raw: GoogleCalendarListEvent, pulseEventIds: Set<string>): MapResult {
  if (!raw.id) return { kind: "skip" };
  // Pulse-origin: by tag (events we push) or by id (already-pushed sessions).
  if (raw.extendedProperties?.private?.[PULSE_ORIGIN_TAG] === "1") return { kind: "skip" };
  if (pulseEventIds.has(raw.id)) return { kind: "skip" };
  // Incremental deltas report deletions as status === "cancelled".
  if (raw.status === "cancelled") return { kind: "cancel", googleEventId: raw.id };

  const startTime = parseGoogleTime(raw.start);
  const endTime = parseGoogleTime(raw.end);
  if (startTime == null || endTime == null || endTime <= startTime) return { kind: "skip" };

  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  return {
    kind: "upsert",
    block: { googleEventId: raw.id, title: raw.summary?.trim() || "Busy", startTime, endTime, allDay },
  };
}

/* ---------- edits made in Google to a Pulse booking ---------- */

export type PulseSessionRef = { sessionId: string; startTime: number; endTime: number };

export type PulseChange =
  | { kind: "moved"; sessionId: string; startTime: number; endTime: number }
  | { kind: "deleted"; sessionId: string }
  | { kind: "unchanged"; sessionId: string };

/** Pure: is this event a Pulse booking (by its stored event id), and if so did
 *  someone move or delete it in Google? Null for events that are not ours. A
 *  Pulse booking is never silently edited from here: the caller files a change
 *  request for the people who can approve it. */
export function classifyPulseEvent(raw: GoogleCalendarListEvent, bySessionEventId: Map<string, PulseSessionRef>): PulseChange | null {
  const ref = raw.id ? bySessionEventId.get(raw.id) : undefined;
  if (!ref) return null;
  if (raw.status === "cancelled") return { kind: "deleted", sessionId: ref.sessionId };
  const startTime = parseGoogleTime(raw.start);
  const endTime = parseGoogleTime(raw.end);
  if (startTime == null || endTime == null || endTime <= startTime) return { kind: "unchanged", sessionId: ref.sessionId };
  if (startTime === ref.startTime && endTime === ref.endTime) return { kind: "unchanged", sessionId: ref.sessionId };
  return { kind: "moved", sessionId: ref.sessionId, startTime, endTime };
}

/* ---------- internal data access ---------- */

/** Everything `pullOrg` needs. Null when the org is not Google-connected or its
 *  sync direction does not pull (push-only and off). */
export const _syncContext = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org?.googleRefreshToken || !studioPullsGoogle(org)) return null;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const pulseEventIds = sessions
      .map((s) => s.googleCalendarEventId)
      .filter((id): id is string => Boolean(id));
    const pulseSessions = sessions
      .filter((s) => s.googleCalendarEventId && s.status !== "cancelled" && s.status !== "no_show" && s.status !== "completed")
      .map((s) => ({ eventId: s.googleCalendarEventId!, sessionId: s._id, startTime: s.startTime, endTime: s.endTime }));
    return {
      googleRefreshToken: org.googleRefreshToken,
      calendarId: org.googleCalendarId ?? "primary",
      syncToken: org.googleCalendarSyncToken ?? null,
      pulseEventIds,
      pulseSessions,
    };
  },
});

/** Apply one pull's worth of changes idempotently + persist the next syncToken. */
export const _applyDelta = internalMutation({
  args: {
    orgId: v.string(),
    upserts: v.array(
      v.object({
        googleEventId: v.string(),
        title: v.string(),
        startTime: v.number(),
        endTime: v.number(),
        allDay: v.boolean(),
      }),
    ),
    cancels: v.array(v.string()),
    nextSyncToken: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { orgId, upserts, cancels, nextSyncToken }) => {
    const now = Date.now();
    for (const b of upserts) {
      const existing = await ctx.db
        .query("googleBusyBlocks")
        .withIndex("by_event", (q) => q.eq("orgId", orgId).eq("googleEventId", b.googleEventId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
          allDay: b.allDay,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("googleBusyBlocks", { orgId, ...b, updatedAt: now });
      }
    }
    for (const googleEventId of cancels) {
      const existing = await ctx.db
        .query("googleBusyBlocks")
        .withIndex("by_event", (q) => q.eq("orgId", orgId).eq("googleEventId", googleEventId))
        .first();
      if (existing) await ctx.db.delete(existing._id);
    }
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) {
      await ctx.db.patch(org._id, {
        googleCalendarSyncToken: nextSyncToken ?? undefined,
        googleCalendarSyncedAt: now,
        googleCalendarSyncError: undefined,
      });
    }
  },
});

/** Turn edits made in Google to Pulse bookings into change requests. Never
 *  edits the booking itself: it flags it (googleChangedAt) and files one pending
 *  request for the creator (or the owner) to approve or decline. One pending
 *  Google request per booking: a second edit updates it instead of stacking. */
export const _recordGoogleChanges = internalMutation({
  args: {
    orgId: v.string(),
    changes: v.array(
      v.union(
        v.object({ kind: v.literal("moved"), sessionId: v.id("sessions"), startTime: v.number(), endTime: v.number() }),
        v.object({ kind: v.literal("deleted"), sessionId: v.id("sessions") }),
        v.object({ kind: v.literal("unchanged"), sessionId: v.id("sessions") }),
      ),
    ),
  },
  handler: async (ctx, { orgId, changes }) => {
    let created = 0;
    for (const ch of changes) {
      const session = await ctx.db.get(ch.sessionId);
      if (!session || session.orgId !== orgId) continue;
      const pending = (
        await ctx.db.query("sessionChangeRequests").withIndex("by_session", (q) => q.eq("sessionId", ch.sessionId)).collect()
      ).filter((r) => r.status === "pending" && r.origin === "google");

      if (ch.kind === "unchanged") {
        // The event is back where the booking says: the edit was undone.
        for (const r of pending) {
          if (r.proposed.status === undefined) await ctx.db.patch(r._id, { status: "withdrawn", decidedAt: Date.now() });
        }
        if (pending.some((r) => r.proposed.status === undefined) && session.googleChangedAt) {
          await ctx.db.patch(session._id, { googleChangedAt: undefined });
        }
        continue;
      }

      const proposed =
        ch.kind === "moved" ? { startTime: ch.startTime, endTime: ch.endTime } : { status: "cancelled" as const };
      const same = (r: (typeof pending)[number]) =>
        r.proposed.startTime === (proposed as { startTime?: number }).startTime &&
        r.proposed.endTime === (proposed as { endTime?: number }).endTime &&
        r.proposed.status === (proposed as { status?: string }).status;
      if (pending.some(same)) continue;
      if (pending.length > 0) {
        await ctx.db.patch(pending[0]._id, { proposed });
        await ctx.db.patch(session._id, { googleChangedAt: Date.now() });
        continue;
      }
      let approver = session.createdByMemberId;
      if (!approver) {
        const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
        approver = members.find((m) => m.role === "owner")?._id;
      }
      await ctx.db.insert("sessionChangeRequests", {
        orgId,
        sessionId: session._id,
        origin: "google",
        proposed,
        reason: ch.kind === "moved" ? "Moved in Google Calendar" : "Deleted in Google Calendar",
        approverMemberId: approver,
        status: "pending",
      });
      await ctx.db.patch(session._id, { googleChangedAt: Date.now() });
      created++;
    }
    return { created };
  },
});

export const _resetSyncToken = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) await ctx.db.patch(org._id, { googleCalendarSyncToken: undefined });
  },
});

export const _recordSyncError = internalMutation({
  args: { orgId: v.string(), error: v.string() },
  handler: async (ctx, { orgId, error }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) await ctx.db.patch(org._id, { googleCalendarSyncError: error, googleCalendarSyncedAt: Date.now() });
  },
});

/* ---------- pull actions ---------- */

/** Pull one org's primary calendar into busy blocks. Incremental when a
 *  syncToken is stored; full (last week onward) otherwise or after a 410. */
export const pullOrg = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.googleCalendarSync._syncContext, { orgId });
    if (!c) return; // not connected; silent no-op
    const pulseIds = new Set(c.pulseEventIds);
    const bySessionEventId = new Map<string, PulseSessionRef>(
      c.pulseSessions.map((p) => [p.eventId, { sessionId: p.sessionId, startTime: p.startTime, endTime: p.endTime }]),
    );
    const fullPullOpts = {
      timeMin: new Date(Date.now() - FULL_PULL_LOOKBACK_MS).toISOString(),
      calendarId: c.calendarId,
    };

    try {
      let listed;
      try {
        listed = await googleCalendarListEvents(
          c.googleRefreshToken,
          c.syncToken ? { syncToken: c.syncToken, calendarId: c.calendarId } : fullPullOpts,
        );
      } catch (err) {
        if (err instanceof GoogleSyncTokenExpired) {
          await ctx.runMutation(internal.googleCalendarSync._resetSyncToken, { orgId });
          listed = await googleCalendarListEvents(c.googleRefreshToken, fullPullOpts);
        } else {
          throw err;
        }
      }

      const upserts: MappedBlock[] = [];
      const cancels: string[] = [];
      const pulseChanges: PulseChange[] = [];
      for (const raw of listed.events) {
        // A Pulse booking edited in Google becomes a change request, not a block.
        const pc = classifyPulseEvent(raw, bySessionEventId);
        if (pc) {
          pulseChanges.push(pc);
          continue;
        }
        const m = mapGoogleEvent(raw, pulseIds);
        if (m.kind === "upsert") upserts.push(m.block);
        else if (m.kind === "cancel") cancels.push(m.googleEventId);
      }

      if (pulseChanges.length > 0) {
        await ctx.runMutation(internal.googleCalendarSync._recordGoogleChanges, {
          orgId,
          changes: pulseChanges as never,
        });
      }
      await ctx.runMutation(internal.googleCalendarSync._applyDelta, {
        orgId,
        upserts,
        cancels,
        nextSyncToken: listed.nextSyncToken,
      });
    } catch (err) {
      console.error("[googleCalendarSync.pullOrg]", orgId, err);
      if (isInvalidGrant(err)) {
        // Revoked, or the Testing-mode 7-day token expired: clear it and ask to reconnect.
        await ctx.runMutation(internal.googleAuth._markReconnect, { orgId });
        return;
      }
      await ctx.runMutation(internal.googleCalendarSync._recordSyncError, {
        orgId,
        error: String(err).slice(0, 300),
      });
    }
  },
});

/** Cron entry: fan out a pull to every Google-connected active org. */
export const pullAllOrgs = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; members: number }> => {
    const orgs = await ctx.db.query("orgs").collect();
    const connected = orgs.filter((o) => o.googleRefreshToken && (o.status ?? "active") === "active");
    for (const o of connected) {
      await ctx.scheduler.runAfter(0, internal.googleCalendarSync.pullOrg, { orgId: o.orgId });
    }
    // Same cron, second level: each member's personal calendar.
    const members: { scheduled: number } = await ctx.runMutation(internal.memberCalendar.scheduleMemberPulls, {});
    return { scheduled: connected.length, members: members.scheduled };
  },
});

/* ---------- public surface ---------- */

/** Sync status for the Settings calendar card: who is connected, which
 *  calendar, which direction, the last pull and the last error either way. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const blocks = await ctx.db
      .query("googleBusyBlocks")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const needsReconnect = !org?.googleRefreshToken && org?.googleCalendarSyncError === RECONNECT_REQUIRED;
    return {
      configured: googleConfigured(),
      connected: Boolean(org?.googleRefreshToken),
      needsReconnect,
      email: org?.googleEmail ?? null,
      calendarId: org?.googleCalendarId ?? "primary",
      calendarName: org?.googleCalendarName ?? (org?.googleCalendarId ? org.googleCalendarId : "Primary calendar"),
      direction: org?.googleSyncDirection ?? ("two_way" as const),
      pushes: studioPushesGoogle(org ?? null),
      pulls: studioPullsGoogle(org ?? null),
      syncedAt: org?.googleCalendarSyncedAt ?? null,
      error: needsReconnect ? null : (org?.googleCalendarSyncError ?? null),
      pushError: org?.googleCalendarPushError ?? null,
      pushErrorAt: org?.googleCalendarPushErrorAt ?? null,
      blockCount: blocks.length,
    };
  },
});

/** The pending Google edit waiting on a booking, for the "Changed in Google" badge. */
export const pendingChangeForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    const rows = await ctx.db.query("sessionChangeRequests").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect();
    const r = rows.find((x) => x.status === "pending" && x.origin === "google");
    return r ? { requestId: r._id, proposed: r.proposed } : null;
  },
});

/** Google busy blocks overlapping [from, to]. Org-wide (block every room). */
export const blocksInRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const dir = org?.googleSyncDirection ?? "two_way";
    if (dir === "push" || dir === "off") return []; // these do not bring Google time in
    const blocks = await ctx.db
      .query("googleBusyBlocks")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from).lte("startTime", to))
      .collect();
    return blocks.map((b) => ({
      _id: b._id,
      title: b.title,
      startTime: b.startTime,
      endTime: b.endTime,
      allDay: b.allDay ?? false,
    }));
  },
});

/** Owner-triggered immediate pull (the "Sync now" button). */
export const syncNow = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    if (!googleConfigured()) return { ok: false };
    const orgId = await ctx.runQuery(internal.googleAuth._myOrgId, {});
    await ctx.runAction(internal.googleCalendarSync.pullOrg, { orgId });
    return { ok: true };
  },
});
