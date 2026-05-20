/* ============================================================
   External calendar sync (read-only).
   Studios paste an .ics URL (Google, Apple, Outlook, Calendly, etc.)
   and Pulse pulls events into the room so the studio doesn't get
   double-booked against an outside calendar. No OAuth required;
   Google Calendar exposes a private .ics URL per calendar.

   This file holds the V8-safe surface (queries + mutations). The
   actual HTTP fetch + .ics parse lives in externalCalendarsActions.ts
   because node-ical needs the Node.js runtime.
   ============================================================ */
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { currentOrg } from "./lib/tenant";

/** Guess the source from an iCal URL host. */
function detectSource(url: string): "google" | "ical" | "outlook" | "apple" | "other" {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes("calendar.google")) return "google";
    if (h.includes("icloud") || h.includes("apple")) return "apple";
    if (h.includes("outlook") || h.includes("office") || h.includes("live.com")) return "outlook";
    if (u.pathname.endsWith(".ics") || u.protocol === "webcal:") return "ical";
  } catch {
    return "other";
  }
  return "other";
}

/** Convert any URL with webcal:// scheme to https:// for fetch. */
function normalizeUrl(url: string): string {
  if (url.startsWith("webcal://")) return "https://" + url.slice("webcal://".length);
  if (url.startsWith("webcals://")) return "https://" + url.slice("webcals://".length);
  return url;
}

function defaultLabel(source: ReturnType<typeof detectSource>): string {
  switch (source) {
    case "google":
      return "Google Calendar";
    case "outlook":
      return "Outlook Calendar";
    case "apple":
      return "Apple Calendar";
    case "ical":
      return "iCal feed";
    default:
      return "External calendar";
  }
}

/** All synced calendars for one room. */
export const listForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const orgId = await currentOrg(ctx);
    const calendars = await ctx.db
      .query("externalCalendars")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return calendars.filter((c) => c.orgId === orgId);
  },
});

/** External events for one room (or every room) in a date range. */
export const eventsInRange = query({
  args: {
    roomId: v.optional(v.id("rooms")),
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, { roomId, from, to }) => {
    const orgId = await currentOrg(ctx);
    if (roomId) {
      const rows = await ctx.db
        .query("externalCalendarEvents")
        .withIndex("by_org_room_start", (q) =>
          q.eq("orgId", orgId).eq("roomId", roomId).gte("startTime", from).lte("startTime", to),
        )
        .collect();
      return rows;
    }
    const all = await ctx.db
      .query("externalCalendarEvents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return all.filter((e) => e.startTime >= from && e.startTime <= to);
  },
});

/** Add a new iCal feed for a room. The UI fires sync immediately after. */
export const add = mutation({
  args: {
    roomId: v.id("rooms"),
    icalUrl: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, icalUrl, label }) => {
    const orgId = await currentOrg(ctx);
    const url = normalizeUrl(icalUrl.trim());
    if (!url.startsWith("http")) {
      throw new Error("iCal URL must start with http(s) or webcal.");
    }
    const source = detectSource(url);
    const id = await ctx.db.insert("externalCalendars", {
      orgId,
      roomId,
      label: label?.trim() || defaultLabel(source),
      source,
      icalUrl: url,
      active: true,
    });
    return id;
  },
});

/** Toggle a feed's active state. Inactive feeds keep their events but
 * don't get refreshed and don't render on the grid. */
export const setActive = mutation({
  args: { id: v.id("externalCalendars"), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const orgId = await currentOrg(ctx);
    const cal = await ctx.db.get(id);
    if (!cal || cal.orgId !== orgId) throw new Error("Not found.");
    await ctx.db.patch(id, { active });
  },
});

/** Remove a feed and all of its imported events. */
export const remove = mutation({
  args: { id: v.id("externalCalendars") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const cal = await ctx.db.get(id);
    if (!cal || cal.orgId !== orgId) throw new Error("Not found.");
    const events = await ctx.db
      .query("externalCalendarEvents")
      .withIndex("by_calendar", (q) => q.eq("calendarId", id))
      .collect();
    for (const e of events) await ctx.db.delete(e._id);
    await ctx.db.delete(id);
  },
});

/* ============================================================
   Internal hooks used by the sync action (Node runtime).
   Plain V8 mutations; no top-level node-ical dependency.
   ============================================================ */

export const getInternal = query({
  args: { id: v.id("externalCalendars") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const listActiveInternal = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("externalCalendars")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.filter((r) => r.active);
  },
});

export const upsertEvents = internalMutation({
  args: {
    calendarId: v.id("externalCalendars"),
    events: v.array(
      v.object({
        uid: v.string(),
        title: v.string(),
        startTime: v.number(),
        endTime: v.number(),
        allDay: v.boolean(),
        location: v.optional(v.string()),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { calendarId, events }) => {
    const cal = await ctx.db.get(calendarId);
    if (!cal) return;

    // Delete + re-insert is simpler than diffing for read-only feeds.
    const existing = await ctx.db
      .query("externalCalendarEvents")
      .withIndex("by_calendar", (q) => q.eq("calendarId", calendarId))
      .collect();
    for (const e of existing) await ctx.db.delete(e._id);

    for (const e of events) {
      await ctx.db.insert("externalCalendarEvents", {
        orgId: cal.orgId,
        calendarId,
        roomId: cal.roomId,
        externalUid: e.uid,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
        allDay: e.allDay,
        location: e.location,
        description: e.description,
      });
    }

    await ctx.db.patch(calendarId, {
      lastSyncAt: Date.now(),
      lastError: undefined,
      eventCount: events.length,
    });
  },
});

export const recordError = internalMutation({
  args: { id: v.id("externalCalendars"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { lastError: error, lastSyncAt: Date.now() });
  },
});
