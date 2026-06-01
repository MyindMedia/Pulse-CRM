import { action, query, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import {
  googleConfigured,
  googleCalendarListEvents,
  GoogleSyncTokenExpired,
  PULSE_ORIGIN_TAG,
  type GoogleCalendarListEvent,
} from "./lib/google";

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

/* ---------- internal data access ---------- */

/** Everything `pullOrg` needs. Null when the org is not Google-connected. */
export const _syncContext = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org?.googleRefreshToken) return null;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const pulseEventIds = sessions
      .map((s) => s.googleCalendarEventId)
      .filter((id): id is string => Boolean(id));
    return {
      googleRefreshToken: org.googleRefreshToken,
      syncToken: org.googleCalendarSyncToken ?? null,
      pulseEventIds,
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
    const fullPullOpts = { timeMin: new Date(Date.now() - FULL_PULL_LOOKBACK_MS).toISOString() };

    try {
      let listed;
      try {
        listed = await googleCalendarListEvents(
          c.googleRefreshToken,
          c.syncToken ? { syncToken: c.syncToken } : fullPullOpts,
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
      for (const raw of listed.events) {
        const m = mapGoogleEvent(raw, pulseIds);
        if (m.kind === "upsert") upserts.push(m.block);
        else if (m.kind === "cancel") cancels.push(m.googleEventId);
      }

      await ctx.runMutation(internal.googleCalendarSync._applyDelta, {
        orgId,
        upserts,
        cancels,
        nextSyncToken: listed.nextSyncToken,
      });
    } catch (err) {
      console.error("[googleCalendarSync.pullOrg]", orgId, err);
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
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    const connected = orgs.filter((o) => o.googleRefreshToken && (o.status ?? "active") === "active");
    for (const o of connected) {
      await ctx.scheduler.runAfter(0, internal.googleCalendarSync.pullOrg, { orgId: o.orgId });
    }
    return { scheduled: connected.length };
  },
});

/* ---------- public surface ---------- */

/** Inbound-sync status for the Settings calendar card. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const blocks = await ctx.db
      .query("googleBusyBlocks")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      configured: googleConfigured(),
      connected: Boolean(org?.googleRefreshToken),
      syncedAt: org?.googleCalendarSyncedAt ?? null,
      error: org?.googleCalendarSyncError ?? null,
      blockCount: blocks.length,
    };
  },
});

/** Google busy blocks overlapping [from, to]. Org-wide (block every room). */
export const blocksInRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
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
