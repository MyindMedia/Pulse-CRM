import { query, internalQuery, QueryCtx, MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import { commStatusV } from "./outreach/tables";
import {
  readiness, redact, maskPhone, callEligibility, canTransition, FAILED_STATUSES, STATUS_MEANING, liveBlockers,
} from "./outreach/policy";
import { TARGET } from "./pulseWalkthrough/policy";

/* ============================================================
   Outreach - the agency console's outbound communications tab.
   Everything here is scoped to the caller's agency. agencyId is derived from
   the authenticated viewer, never taken from arguments. This module makes no
   provider calls: it reads and records state only. Sending, calling and SMS
   stay behind their own disabled integrations.
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

async function settingsFor(ctx: Ctx, agencyId: string) {
  return await ctx.db
    .query("outreachSettings")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .unique();
}

const walkthroughEnabled = () => process.env.PULSE_WALKTHROUGH_ENABLED === "true";
const walkthroughAudited = () => process.env.PULSE_WALKTHROUGH_SCHEMA_AUDITED === "true";

/* ----------------------------- queries ----------------------------- */

/** Overview: readiness, status counts, failures. `null` = not an agency member. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const settings = await settingsFor(ctx, scope.agencyId);
    const comms = await ctx.db
      .query("outreachCommunications")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .order("desc")
      .take(200);
    const templates = await ctx.db
      .query("outreachTemplates")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .collect();
    const counts: Record<string, number> = {};
    for (const c of comms) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const items = readiness({
      settings,
      approvedTemplates: templates.filter((t) => t.approval === "approved").length,
      walkthroughEnabled: walkthroughEnabled(),
      walkthroughSchemaAudited: walkthroughAudited(),
      emailProviderConfigured: !!process.env.RESEND_API_KEY,
      mode: settings?.mode ?? "test_only",
    });
    return {
      canManage: scope.canManage,
      configured: settings !== null,
      paused: settings?.paused ?? true,
      mode: settings?.mode ?? ("test_only" as const),
      isOwner: scope.role === "owner",
      liveBlockers: liveBlockers({
        postalAddress: settings?.postalAddress, testConfirmedAt: settings?.testConfirmedAt, senders: settings?.senders ?? [],
        approvedTemplates: templates.filter((t) => t.approval === "approved").length, emailProviderConfigured: !!process.env.RESEND_API_KEY,
      }),
      readiness: items,
      counts,
      failures: comms
        .filter((c) => FAILED_STATUSES.includes(c.status))
        .slice(0, 10)
        .map((c) => ({ id: c._id, recipient: c.recipient, subject: c.subject, status: c.status, at: c.createdAt })),
    };
  },
});

export const communications = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const rows = await ctx.db
      .query("outreachCommunications")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .order("desc")
      .take(100);
    return rows.map((c) => ({
      id: c._id,
      at: c.createdAt,
      recipient: c.recipient,
      sender: c.sender,
      subject: c.subject,
      isTest: c.isTest,
      status: c.status,
      meaning: STATUS_MEANING[c.status],
      providerId: c.providerId ?? null,
      lastError: redact(c.lastError) ?? null,
    }));
  },
});

export const templates = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const rows = await ctx.db
      .query("outreachTemplates")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .collect();
    return rows.map((t) => ({
      key: t.key, name: t.name, subject: t.subject, bookingUrl: t.bookingUrl,
      approval: t.approval, approvedAt: t.approvedAt ?? null, source: t.source,
    }));
  },
});

/** Meetings come from the walkthrough appointment ledger, and only for an
 *  agency whose operator-verified mapping matches that integration's fixed
 *  location and calendar. Nobody else sees those rows. */
export const meetings = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const settings = await settingsFor(ctx, scope.agencyId);
    const mapped =
      settings?.ghlLocationId === TARGET.location && settings?.ghlCalendarId === TARGET.calendar;
    if (!mapped) return { mapped: false as const, rows: [] };
    const enabled = walkthroughEnabled();
    const all = await ctx.db.query("pulseWalkthroughAppointments").take(200);
    const rows = all
      .map((r) => ({
        id: r.appointment.id,
        name: r.appointment.name || "Unnamed",
        start: r.appointment.start,
        timezone: r.appointment.timezone,
        status: r.appointment.status,
        phone: maskPhone(r.appointment.phone),
        version: r.version,
        call: callEligibility(
          { consent: r.appointment.consent, dnd: r.appointment.dnd, suppressed: r.suppressed, callId: r.callId, status: r.appointment.status },
          enabled,
        ),
      }))
      .sort((a, b) => a.start - b.start);
    return { mapped: true as const, rows };
  },
});

/** Links and calendars: shows configuration provenance, never infers it. */
export const links = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const s = await settingsFor(ctx, scope.agencyId);
    return {
      configured: s !== null,
      bookingUrl: s?.bookingUrl ?? null,
      calendarId: s?.ghlCalendarId ?? null,
      locationId: s?.ghlLocationId ?? null,
      durationMin: s?.bookingDurationMin ?? null,
      timezone: s?.timezone ?? null,
      verifiedAt: s?.verifiedAt ?? null,
      senders: (s?.senders ?? []).map((x) => ({ label: x.label, address: x.address, verified: x.verified })),
    };
  },
});

export const activity = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const rows = await ctx.db
      .query("outreachEvents")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .order("desc")
      .take(100);
    return rows.map((e) => ({
      id: e._id, at: e.at, actor: e.actor, action: e.action,
      resource: e.resource ?? null, result: e.result, detail: e.detail ?? null,
    }));
  },
});

/* --------------------------- client mutation --------------------------- */

/** Overall Outreach pause. The only write the browser can make. Owners and
 *  admins only; enforced here even if the UI is bypassed. Pausing never
 *  touches the already-live Bland agent. */
export const setPaused = mutation({
  args: { paused: v.boolean() },
  handler: async (ctx, { paused }) => {
    const scope = await requireAgencyScope(ctx);
    if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can pause Outreach");
    const existing = await settingsFor(ctx, scope.agencyId);
    if (existing) {
      await ctx.db.patch(existing._id, { paused, updatedAt: Date.now(), updatedBy: scope.actor });
    } else {
      await ctx.db.insert("outreachSettings", {
        agencyId: scope.agencyId, paused, mode: "test_only", senders: [],
        updatedAt: Date.now(), updatedBy: scope.actor,
      });
    }
    await logEvent(ctx, scope.agencyId, scope.actor, paused ? "outreach.paused" : "outreach.resumed", "ok");
    return null;
  },
});

/** Turns live sending on or off. Owner only. Turning it on needs every gate
 *  met and the word SEND typed. Nothing is sent by this: each email still
 *  needs its own approval and its own Send click. */
export const setLive = mutation({
  args: { enabled: v.boolean(), confirm: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const scope = await requireAgencyScope(ctx);
    if (scope.role !== "owner") throw new AccessError("FORBIDDEN", "Only the agency owner can change live sending");
    const existing = await settingsFor(ctx, scope.agencyId);
    if (a.enabled) {
      if (a.confirm !== "SEND") throw new Error('Type SEND to confirm');
      const templates = await ctx.db.query("outreachTemplates").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).collect();
      const blockers = liveBlockers({
        postalAddress: existing?.postalAddress, testConfirmedAt: existing?.testConfirmedAt, senders: existing?.senders ?? [],
        approvedTemplates: templates.filter((t) => t.approval === "approved").length, emailProviderConfigured: !!process.env.RESEND_API_KEY,
      });
      if (blockers.length) throw new Error(`Not ready: ${blockers.join("; ")}`);
    }
    const mode = a.enabled ? ("live" as const) : ("test_only" as const);
    if (existing) await ctx.db.patch(existing._id, { mode, updatedAt: Date.now(), updatedBy: scope.actor });
    else await ctx.db.insert("outreachSettings", { agencyId: scope.agencyId, paused: true, mode, senders: [], updatedAt: Date.now(), updatedBy: scope.actor });
    await logEvent(ctx, scope.agencyId, scope.actor, a.enabled ? "outreach.live_enabled" : "outreach.live_disabled", "ok");
    return null;
  },
});

/** Booleans only: which server settings exist. Never returns a value. */
export const _env = internalQuery({
  args: {},
  handler: async () => ({
    resend: !!process.env.RESEND_API_KEY, ghl: !!process.env.PULSE_WALKTHROUGH_GHL_KEY,
    intake: !!process.env.OUTREACH_INTAKE_SECRET && !!process.env.OUTREACH_INTAKE_AGENCY_ID,
    walkthroughEnabled: walkthroughEnabled(), walkthroughAudited: walkthroughAudited(),
  }),
});

/* ------------------- operator-only (internal) mutations ------------------- */

/** Provider mapping. Run by an operator after the account is verified in the
 *  provider dashboard. Not callable from the browser. */
export const setProviderMapping = internalMutation({
  args: {
    agencyId: v.string(),
    ghlLocationId: v.string(),
    ghlCalendarId: v.string(),
    bookingUrl: v.string(),
    bookingDurationMin: v.number(),
    timezone: v.string(),
    operator: v.string(),
  },
  handler: async (ctx, a) => {
    if (!/^https:\/\//.test(a.bookingUrl)) throw new Error("Booking URL must be https");
    const now = Date.now();
    const patch = {
      ghlLocationId: a.ghlLocationId, ghlCalendarId: a.ghlCalendarId, bookingUrl: a.bookingUrl,
      bookingDurationMin: a.bookingDurationMin, timezone: a.timezone,
      verifiedAt: now, updatedAt: now, updatedBy: a.operator,
    };
    const existing = await settingsFor(ctx, a.agencyId);
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("outreachSettings", { agencyId: a.agencyId, paused: true, mode: "test_only", senders: [], ...patch });
    await logEvent(ctx, a.agencyId, a.operator, "outreach.mapping_set", "ok", a.ghlCalendarId);
    return null;
  },
});

/** Changes only the outreach CTA link. The provider mapping (GHL location and calendar)
 *  is untouched, and the link on every live template row is updated with it so the
 *  Communications tab never shows a stale address. Existing drafts keep their old
 *  link until prepared again; approval is bound to the rendered content, so they
 *  cannot be sent with a link nobody approved. */
export const setBookingUrl = internalMutation({
  args: { agencyId: v.string(), bookingUrl: v.string(), operator: v.string() },
  handler: async (ctx, a) => {
    const url = a.bookingUrl.trim();
    if (!/^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/.test(url)) throw new Error("Booking URL must be a plain https link");
    const existing = await settingsFor(ctx, a.agencyId);
    if (!existing) throw new Error("No outreach settings for this agency");
    const now = Date.now();
    await ctx.db.patch(existing._id, { bookingUrl: url, updatedAt: now, updatedBy: a.operator });
    const templates = await ctx.db.query("outreachTemplates").withIndex("by_agency", (q) => q.eq("agencyId", a.agencyId)).collect();
    for (const t of templates) if (t.approval !== "superseded") await ctx.db.patch(t._id, { bookingUrl: url });
    await logEvent(ctx, a.agencyId, a.operator, "outreach.booking_url_set", "ok", url);
    return { settings: true, templates: templates.filter((t) => t.approval !== "superseded").length };
  },
});

export const upsertSender = internalMutation({
  args: { agencyId: v.string(), label: v.string(), address: v.string(), verified: v.boolean(), operator: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const address = a.address.trim().toLowerCase();
    const existing = await settingsFor(ctx, a.agencyId);
    const entry = { label: a.label, address, verified: a.verified, ...(a.verified ? { verifiedAt: now } : {}) };
    if (existing) {
      const senders = existing.senders.filter((s) => s.address !== address).concat(entry);
      await ctx.db.patch(existing._id, { senders, updatedAt: now, updatedBy: a.operator });
    } else {
      await ctx.db.insert("outreachSettings", { agencyId: a.agencyId, paused: true, mode: "test_only", senders: [entry], updatedAt: now, updatedBy: a.operator });
    }
    await logEvent(ctx, a.agencyId, a.operator, "outreach.sender_set", "ok", address, a.verified ? "verified" : "unverified");
    return null;
  },
});

export const upsertTemplate = internalMutation({
  args: {
    agencyId: v.string(), key: v.string(), name: v.string(), subject: v.string(),
    bookingUrl: v.string(), contentHash: v.string(), signatureKey: v.optional(v.string()),
    source: v.string(), approvedBy: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("outreachTemplates").withIndex("by_agency", (q) => q.eq("agencyId", a.agencyId)).collect();
    // A changed content hash supersedes the old version; approval never carries over.
    for (const r of rows.filter((r) => r.key === a.key && r.contentHash !== a.contentHash && r.approval !== "superseded")) {
      await ctx.db.patch(r._id, { approval: "superseded" });
    }
    if (rows.some((r) => r.key === a.key && r.contentHash === a.contentHash && r.approval !== "superseded")) return null;
    await ctx.db.insert("outreachTemplates", {
      agencyId: a.agencyId, key: a.key, name: a.name, subject: a.subject, bookingUrl: a.bookingUrl,
      contentHash: a.contentHash, signatureKey: a.signatureKey, source: a.source,
      approval: a.approvedBy ? "approved" : "awaiting_review",
      approvedBy: a.approvedBy, approvedAt: a.approvedBy ? Date.now() : undefined, createdAt: Date.now(),
    });
    await logEvent(ctx, a.agencyId, a.approvedBy ?? "operator", "outreach.template_registered", "ok", a.key);
    return null;
  },
});

/** Ledger entry for one outbound message. Idempotent per (agency, key): a
 *  repeat returns the existing row instead of recording a second send. */
export const recordCommunication = internalMutation({
  args: {
    agencyId: v.string(), recipient: v.string(), sender: v.string(), subject: v.string(),
    isTest: v.boolean(), status: commStatusV, providerId: v.optional(v.string()),
    idempotencyKey: v.string(), templateKey: v.optional(v.string()), lastError: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const dup = await ctx.db
      .query("outreachCommunications")
      .withIndex("by_agency_key", (q) => q.eq("agencyId", a.agencyId).eq("idempotencyKey", a.idempotencyKey))
      .unique();
    if (dup) return dup._id;
    const id = await ctx.db.insert("outreachCommunications", {
      ...a, channel: "email", recipient: a.recipient.trim().toLowerCase(), lastError: redact(a.lastError), createdAt: Date.now(),
    });
    await logEvent(ctx, a.agencyId, "system", "outreach.email_recorded", a.status === "unknown" ? "unknown" : "ok", a.providerId, a.isTest ? "test" : "live");
    return id;
  },
});

export const updateCommunicationStatus = internalMutation({
  args: { agencyId: v.string(), idempotencyKey: v.string(), status: commStatusV, lastError: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("outreachCommunications")
      .withIndex("by_agency_key", (q) => q.eq("agencyId", a.agencyId).eq("idempotencyKey", a.idempotencyKey))
      .unique();
    if (!row) throw new Error("Unknown communication");
    if (!canTransition(row.status, a.status)) return false;
    await ctx.db.patch(row._id, { status: a.status, lastError: redact(a.lastError) });
    await logEvent(ctx, a.agencyId, "system", "outreach.email_status", "ok", row.providerId, `${row.status} -> ${a.status}`);
    return true;
  },
});

export const setPostalAddress = internalMutation({
  args: { agencyId: v.string(), address: v.string(), operator: v.string() },
  handler: async (ctx, a) => {
    const address = a.address.trim();
    if (address.length < 10) throw new Error("Enter the full business mailing address");
    const existing = await settingsFor(ctx, a.agencyId);
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { postalAddress: address, updatedAt: now, updatedBy: a.operator });
    else await ctx.db.insert("outreachSettings", { agencyId: a.agencyId, paused: true, mode: "test_only", senders: [], postalAddress: address, updatedAt: now, updatedBy: a.operator });
    await logEvent(ctx, a.agencyId, a.operator, "outreach.postal_address_set", "ok");
    return null;
  },
});

/** The operator records that an owner-only test email landed and looked right. */
export const confirmOwnerTest = internalMutation({
  args: { agencyId: v.string(), operator: v.string(), note: v.string() },
  handler: async (ctx, a) => {
    if (a.note.trim().length < 10) throw new Error("Say what was checked (inbox, signature, link)");
    const existing = await settingsFor(ctx, a.agencyId);
    const now = Date.now();
    const patch = { testConfirmedAt: now, testConfirmedNote: a.note.slice(0, 300), updatedAt: now, updatedBy: a.operator };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("outreachSettings", { agencyId: a.agencyId, paused: true, mode: "test_only", senders: [], ...patch });
    await logEvent(ctx, a.agencyId, a.operator, "outreach.owner_test_confirmed", "ok", undefined, a.note);
    return null;
  },
});

export const _settings = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => await settingsFor(ctx, agencyId),
});
