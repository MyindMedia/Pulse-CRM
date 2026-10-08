import { query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import { zuopsGet, parseBookings, parseCalendar, parseLead, type ZuopsBooking, type ZuopsLead } from "./outreach/zuops";

/* ============================================================
   Zuops calendar sync. Bookings made on studiopulse.tech/demo (the Zuops calendar)
   are mirrored into Pulse so the Meetings tab shows them and a booked studio is
   marked on its prospect card. Read only: nothing here writes to Zuops.
   Two triggers, one idempotent job: a signed webhook from Zuops (appointment
   booked or cancelled) and a 15 minute cron as the safety net.
   ============================================================ */

const DAY = 24 * 60 * 60 * 1000;
const MAX_LEAD_LOOKUPS = 25;

async function requireManager(ctx: Parameters<typeof requireAgencyScope>[0]) {
  const scope = await requireAgencyScope(ctx);
  if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can change this");
  return scope;
}

/* ------------------------------- queries ------------------------------- */

export const bookings = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const settings = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    const rows = await ctx.db.query("outreachBookings").withIndex("by_agency_start", (q) => q.eq("agencyId", scope.agencyId)).order("desc").take(200);
    const now = Date.now();
    const shape = async (r: (typeof rows)[number]) => ({
      id: r._id, title: r.title, startsAt: r.startsAt, endsAt: r.endsAt, timezone: r.timezone ?? null, status: r.status,
      contactName: r.contactName ?? null, contactEmail: r.contactEmail ?? null, location: r.location ?? null,
      consent: { sms: r.consent?.sms ?? null, call: r.consent?.call ?? null, email: r.consent?.email ?? null },
      prospect: r.prospectId ? ((await ctx.db.get(r.prospectId))?.name ?? "matched studio") : null,
    });
    const upcoming = await Promise.all(rows.filter((r) => r.endsAt >= now && r.status === "confirmed").sort((a, b) => a.startsAt - b.startsAt).map(shape));
    const past = await Promise.all(rows.filter((r) => !(r.endsAt >= now && r.status === "confirmed")).slice(0, 50).map(shape));
    return { mapped: Boolean(settings?.zuopsWorkspaceId && settings?.zuopsCalendarId), upcoming, past };
  },
});

export const snapshot = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const settings = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    const snap = await ctx.db.query("outreachZuopsSnapshot").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    return {
      canManage: scope.canManage,
      mapped: Boolean(settings?.zuopsWorkspaceId && settings?.zuopsCalendarId),
      keyConfigured: Boolean(process.env.ZUOPS_API_KEY),
      webhookConfigured: Boolean(process.env.ZUOPS_WEBHOOK_SECRET),
      bookingUrl: settings?.bookingUrl ?? null,
      fetchedAt: snap?.fetchedAt ?? null,
      ok: snap?.ok ?? null,
      error: snap?.error ?? null,
      bookingCount: snap?.bookings ?? 0,
      calendar: snap?.calendar ?? null,
    };
  },
});

/* ------------------------------ mutations ------------------------------ */

export const refresh = mutation({
  args: {},
  handler: async (ctx) => {
    const scope = await requireManager(ctx);
    const snap = await ctx.db.query("outreachZuopsSnapshot").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    if (snap && Date.now() - snap.fetchedAt < 60_000) throw new Error("Just refreshed. Wait a minute and try again.");
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.zuops_refresh", "ok");
    await ctx.scheduler.runAfter(0, internal.outreachZuops.sync, { agencyId: scope.agencyId });
    return null;
  },
});

/** Operator: bind an agency to ONE Zuops workspace and calendar. Not callable from the browser. */
export const setMapping = internalMutation({
  args: { agencyId: v.string(), workspaceId: v.string(), calendarId: v.string(), operator: v.string() },
  handler: async (ctx, a) => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(a.workspaceId) || !uuid.test(a.calendarId)) throw new Error("Workspace and calendar ids must be UUIDs");
    const s = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", a.agencyId)).first();
    if (!s) throw new Error("No outreach settings for this agency");
    // One workspace may serve one agency only, so one tenant can never read another's bookings.
    const all = await ctx.db.query("outreachSettings").collect();
    if (all.some((o) => o.agencyId !== a.agencyId && o.zuopsWorkspaceId === a.workspaceId)) throw new Error("That Zuops workspace is already mapped to another agency");
    await ctx.db.patch(s._id, { zuopsWorkspaceId: a.workspaceId, zuopsCalendarId: a.calendarId, updatedAt: Date.now(), updatedBy: a.operator });
    await logEvent(ctx, a.agencyId, a.operator, "outreach.zuops_mapped", "ok", a.calendarId);
    return null;
  },
});

/* --------------------------- internal (no client) --------------------------- */

export const _mapped = internalQuery({
  args: { agencyId: v.optional(v.string()), workspaceId: v.optional(v.string()) },
  handler: async (ctx, { agencyId, workspaceId }) => {
    const rows = await ctx.db.query("outreachSettings").collect();
    return rows
      .filter((s) => s.zuopsWorkspaceId && s.zuopsCalendarId)
      .filter((s) => (agencyId ? s.agencyId === agencyId : true) && (workspaceId ? s.zuopsWorkspaceId === workspaceId : true))
      .map((s) => ({ agencyId: s.agencyId, workspaceId: s.zuopsWorkspaceId as string, calendarId: s.zuopsCalendarId as string }));
  },
});

export const _knownContacts = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => {
    const rows = await ctx.db.query("outreachBookings").withIndex("by_agency_start", (q) => q.eq("agencyId", agencyId)).take(500);
    return rows.filter((r) => r.zuopsLeadId && r.contactEmail && r.phoneSynced).map((r) => r.zuopsLeadId as string);
  },
});

export const _saveSnapshot = internalMutation({
  args: {
    agencyId: v.string(), ok: v.boolean(), error: v.optional(v.string()), bookings: v.optional(v.number()),
    calendar: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("outreachZuopsSnapshot").withIndex("by_agency", (q) => q.eq("agencyId", a.agencyId)).first();
    const doc = { agencyId: a.agencyId, fetchedAt: Date.now(), ok: a.ok, error: a.error, bookings: a.bookings, calendar: a.ok ? a.calendar : existing?.calendar };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("outreachZuopsSnapshot", doc);
    if (!a.ok) await logEvent(ctx, a.agencyId, "system", "outreach.zuops_sync_failed", "denied", undefined, a.error);
    return null;
  },
});

type Hydrated = ZuopsBooking & { lead?: ZuopsLead };

export const _upsert = internalMutation({
  args: { agencyId: v.string(), bookings: v.array(v.any()) },
  handler: async (ctx, { agencyId, bookings }) => {
    const now = Date.now();
    // Match a booking's email to a prospect the studio already published that address for.
    const prospects = await ctx.db.query("outreachProspects").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).take(300);
    const byEmail = new Map<string, (typeof prospects)[number]>();
    for (const p of prospects) for (const e of p.contacts?.emails ?? []) byEmail.set(e.address.toLowerCase(), p);
    let added = 0;
    for (const b of bookings as Hydrated[]) {
      const existing = await ctx.db.query("outreachBookings").withIndex("by_agency_booking", (q) => q.eq("agencyId", agencyId).eq("zuopsBookingId", b.id)).first();
      const email = b.lead?.email ?? existing?.contactEmail;
      const prospect = email ? byEmail.get(email) : undefined;
      const doc = {
        agencyId, zuopsBookingId: b.id, zuopsLeadId: b.leadId, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt,
        timezone: b.timezone, status: b.status, location: b.location, meetingUrl: b.meetingUrl,
        contactName: b.lead?.name ?? existing?.contactName, contactEmail: email,
        consent: b.lead ? b.lead.consent : existing?.consent, emailOptOut: b.lead ? b.lead.emailOptOut : existing?.emailOptOut,
        phone: b.lead ? b.lead.phone : existing?.phone, phoneSynced: b.lead ? true : existing?.phoneSynced,
        prospectId: prospect?._id ?? existing?.prospectId, syncedAt: now,
      };
      if (existing) await ctx.db.replace(existing._id, doc);
      else { await ctx.db.insert("outreachBookings", doc); added++; }
      if (prospect && (b.status === "confirmed" || b.status === "completed")) await ctx.db.patch(prospect._id, { bookedAt: b.startsAt, updatedAt: now });
    }
    if (added > 0) await logEvent(ctx, agencyId, "system", "outreach.bookings_synced", "ok", undefined, `${added} new`);
    return { added };
  },
});

export const sync = internalAction({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }): Promise<null> => {
    const [m] = await ctx.runQuery(internal.outreachZuops._mapped, { agencyId });
    if (!m) return null;
    const fail = async (error: string): Promise<null> => {
      await ctx.runMutation(internal.outreachZuops._saveSnapshot, { agencyId, ok: false, error });
      return null;
    };
    const now = Date.now();
    const cals = await zuopsGet("/v1/calendars", { workspace_id: m.workspaceId });
    if (!cals.ok) return await fail(cals.reason);
    const calendar = parseCalendar(cals.json, m.calendarId);
    if (!calendar) return await fail("The mapped calendar was not found in that Zuops workspace.");
    const res = await zuopsGet("/v1/bookings", { workspace_id: m.workspaceId, from: new Date(now - 30 * DAY).toISOString(), to: new Date(now + 90 * DAY).toISOString(), limit: 200 });
    if (!res.ok) return await fail(res.reason);
    // Only this calendar's bookings, and only ones that name this calendar or none.
    const list = parseBookings(res.json).filter((b) => !b.calendarId || b.calendarId === m.calendarId);
    const known = new Set(await ctx.runQuery(internal.outreachZuops._knownContacts, { agencyId }));
    const hydrated: Hydrated[] = [];
    let lookups = 0;
    const leads = new Map<string, ZuopsLead | null>();
    for (const b of list) {
      const h: Hydrated = { ...b };
      if (b.leadId && !known.has(b.leadId) && lookups < MAX_LEAD_LOOKUPS) {
        if (!leads.has(b.leadId)) {
          lookups++;
          const r = await zuopsGet(`/v1/leads/${encodeURIComponent(b.leadId)}`, { workspace_id: m.workspaceId });
          leads.set(b.leadId, r.ok ? parseLead(r.json) : null);
        }
        h.lead = leads.get(b.leadId) ?? undefined;
      }
      hydrated.push(h);
    }
    await ctx.runMutation(internal.outreachZuops._upsert, { agencyId, bookings: hydrated });
    await ctx.runMutation(internal.outreachZuops._saveSnapshot, { agencyId, ok: true, bookings: list.length, calendar });
    return null;
  },
});

/** Cron and webhook entry: sync every mapped agency, or just the one for a workspace. */
export const syncAll = internalAction({
  args: { workspaceId: v.optional(v.string()) },
  handler: async (ctx, { workspaceId }): Promise<null> => {
    if (!process.env.ZUOPS_API_KEY) return null;
    for (const m of await ctx.runQuery(internal.outreachZuops._mapped, { workspaceId })) {
      await ctx.runAction(internal.outreachZuops.sync, { agencyId: m.agencyId });
    }
    return null;
  },
});
