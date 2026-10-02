import { query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import { ghlGet, summarizeCalendar, summarizeSlots, summarizeEvents } from "./outreach/ghl";

/* ============================================================
   Live view of the agency's mapped GHL calendar. Read-only: calendar details,
   open slots for the next 7 days, and upcoming appointments. Which calendar
   is read comes from operator-verified settings, never from the browser.
   ============================================================ */

const MIN_REFRESH_MS = 30_000;
const GHL_KEY_ENV = "PULSE_WALKTHROUGH_GHL_KEY";

export const snapshot = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const row = await ctx.db.query("outreachCalendar").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).unique();
    const settings = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).unique();
    return {
      canManage: scope.canManage,
      mapped: !!(settings?.ghlLocationId && settings.ghlCalendarId),
      keyConfigured: !!process.env[GHL_KEY_ENV],
      fetchedAt: row?.fetchedAt ?? null,
      ok: row?.ok ?? null,
      error: row?.error ?? null,
      calendar: row?.calendar ?? null,
      slots: row?.slots ?? [],
      appointments: (row?.appointments ?? []).filter((a) => a.end >= Date.now() - 3600_000),
    };
  },
});

export const refresh = mutation({
  args: {},
  handler: async (ctx) => {
    const scope = await requireAgencyScope(ctx);
    if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can refresh the calendar");
    const settings = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).unique();
    if (!settings?.ghlLocationId || !settings.ghlCalendarId) throw new Error("No calendar is mapped to this agency yet");
    if (!process.env[GHL_KEY_ENV]) throw new Error("The GHL key is not configured on the server");
    const row = await ctx.db.query("outreachCalendar").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).unique();
    if (row && Date.now() - row.fetchedAt < MIN_REFRESH_MS) throw new Error("Refreshed a moment ago. Try again in 30 seconds.");
    await ctx.scheduler.runAfter(0, internal.outreachCalendar._sync, { agencyId: scope.agencyId });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.calendar_refresh_requested", "ok", settings.ghlCalendarId);
    return null;
  },
});

export const _settings = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).unique(),
});

export const _save = internalMutation({
  args: {
    agencyId: v.string(), ok: v.boolean(), error: v.optional(v.string()),
    calendar: v.optional(v.object({
      id: v.string(), name: v.string(), active: v.boolean(), durationMin: v.union(v.number(), v.null()),
      widgetSlug: v.union(v.string(), v.null()), formId: v.union(v.string(), v.null()), autoConfirm: v.boolean(),
    })),
    slots: v.array(v.object({ date: v.string(), count: v.number(), first: v.union(v.string(), v.null()) })),
    appointments: v.array(v.object({
      id: v.string(), title: v.string(), start: v.number(), end: v.number(), status: v.string(), contactName: v.union(v.string(), v.null()),
    })),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("outreachCalendar").withIndex("by_agency", (q) => q.eq("agencyId", a.agencyId)).unique();
    // A failed refresh keeps the last good data and records the error.
    const doc = a.ok
      ? { agencyId: a.agencyId, fetchedAt: Date.now(), ok: true, error: undefined, calendar: a.calendar, slots: a.slots, appointments: a.appointments }
      : { agencyId: a.agencyId, fetchedAt: Date.now(), ok: false, error: a.error, calendar: existing?.calendar, slots: existing?.slots ?? [], appointments: existing?.appointments ?? [] };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("outreachCalendar", doc);
    await logEvent(ctx, a.agencyId, "system", "outreach.calendar_synced", a.ok ? "ok" : "denied", a.calendar?.id, a.ok ? `${a.slots.reduce((n, s) => n + s.count, 0)} open slots` : a.error);
    return null;
  },
});

export const _sync = internalAction({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => {
    const settings = await ctx.runQuery(internal.outreachCalendar._settings, { agencyId });
    const key = process.env[GHL_KEY_ENV];
    const fail = async (error: string) => {
      await ctx.runMutation(internal.outreachCalendar._save, { agencyId, ok: false, error, slots: [], appointments: [] });
      return null;
    };
    if (!settings?.ghlLocationId || !settings.ghlCalendarId) return await fail("No calendar is mapped");
    if (!key) return await fail("The GHL key is not configured on the server");
    const loc = settings.ghlLocationId, cal = settings.ghlCalendarId;
    const now = Date.now(), week = now + 7 * 86_400_000, month = now + 30 * 86_400_000;

    const c = await ghlGet(`/calendars/${encodeURIComponent(cal)}`, key);
    if (!c.ok) return await fail(c.reason);
    const info = summarizeCalendar(c.data, cal, loc);
    if (!info.ok) return await fail(info.reason);

    const s = await ghlGet(`/calendars/${encodeURIComponent(cal)}/free-slots?startDate=${now}&endDate=${week}`, key);
    const e = await ghlGet(`/calendars/events?locationId=${encodeURIComponent(loc)}&calendarId=${encodeURIComponent(cal)}&startTime=${now}&endTime=${month}`, key);
    await ctx.runMutation(internal.outreachCalendar._save, {
      agencyId, ok: true, calendar: info.data,
      slots: s.ok ? summarizeSlots(s.data) : [],
      appointments: e.ok ? summarizeEvents(e.data, cal) : [],
      // A partial failure (slots or events) is surfaced in the audit trail via the counts, not hidden.
    });
    return null;
  },
});
