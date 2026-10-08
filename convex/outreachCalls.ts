import { query, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import { zuopsGet, parseLead } from "./outreach/zuops";
import { buildCallBody, placeCall, webhookUrl } from "./lib/bland";
import {
  CALL_SCRIPT_APPROVED, buildFirstSentence, buildTask,
} from "./outreach/callScript";
import {
  DEFAULT_SETTINGS, capDay, evaluate, formatDemoTime, maskPhone, validateSettings, type CallSettings, type Decision,
} from "./outreach/callPolicy";

/* Confirmation calls: the automated Bland call that confirms a booked demo.
   Rules live in outreach/callPolicy.ts; this file reads, writes and dials.
   Spec: openspec/changes/confirmation-calls. Never log or return a raw phone. */

const MAX_DIALS_PER_RUN = 10;
const MAX_BOOKINGS_PER_AGENCY = 300;

function toSettings(row: Doc<"outreachCallSettings"> | null): CallSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    enabled: row.enabled, mode: row.mode, delayMinutes: row.delayMinutes, windowStart: row.windowStart,
    windowEnd: row.windowEnd, windowDays: row.windowDays, timezone: row.timezone, dailyCap: row.dailyCap,
    maxDurationMinutes: row.maxDurationMinutes, killSwitch: row.killSwitch, allowTestBookings: row.allowTestBookings,
    fromNumber: row.fromNumber ?? DEFAULT_SETTINGS.fromNumber, voice: row.voice, enabledAt: row.enabledAt,
  };
}

/** What stops a live dial even when every per-booking rule passes. */
export function liveBlockers(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  if (!CALL_SCRIPT_APPROVED) out.push("script_unapproved");
  if (!env.BLAND_API_KEY) out.push("bland_key_missing");
  if (!webhookUrl(env)) out.push("webhook_not_configured");
  return out;
}

/* ------------------------------ queries ------------------------------ */

export const callSettings = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const row = await ctx.db.query("outreachCallSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    return {
      canManage: scope.canManage,
      isOwner: scope.role === "owner",
      configured: row !== null,
      settings: toSettings(row),
      blockers: liveBlockers(),
      blandKeyConfigured: Boolean(process.env.BLAND_API_KEY),
      webhookConfigured: Boolean(process.env.BLAND_WEBHOOK_SECRET),
      scriptApproved: CALL_SCRIPT_APPROVED,
    };
  },
});

/** The would-send body for the browser: phone masked, long task trimmed. */
function safeBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = { ...(body as Record<string, unknown>) };
  if (typeof b.phone_number === "string") b.phone_number = maskPhone(b.phone_number);
  if (typeof b.task === "string") b.task = b.task.length > 400 ? `${b.task.slice(0, 400)}... (${b.task.length} characters in all)` : b.task;
  if (typeof b.webhook === "string") b.webhook = b.webhook.replace(/secret=[^&]*/, "secret=REDACTED");
  return b;
}

export const calls = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const rows = await ctx.db.query("outreachCalls").withIndex("by_agency_created", (q) => q.eq("agencyId", scope.agencyId)).order("desc").take(100);
    return await Promise.all(rows.map(async (r) => {
      const b = await ctx.db.get(r.bookingId);
      return {
        id: r._id, status: r.status, skipReason: r.skipReason ?? null, scheduledFor: r.scheduledFor, attempts: r.attempts,
        contactName: b?.contactName ?? null, startsAt: b?.startsAt ?? null, timezone: b?.timezone ?? null,
        phoneMasked: maskPhone(r.phone), answeredBy: r.answeredBy ?? null,
        summary: r.result?.summary ?? null, disposition: r.result?.disposition ?? null, optOut: r.result?.optOut ?? false,
        error: r.result?.error ?? null,
        dryRun: r.dryRun ? { body: safeBody(r.dryRun.body), reasons: r.dryRun.reasons } : null,
      };
    }));
  },
});

/* ------------------------------ settings ------------------------------ */

const patchV = {
  enabled: v.optional(v.boolean()),
  mode: v.optional(v.union(v.literal("dry_run"), v.literal("live"))),
  delayMinutes: v.optional(v.number()),
  windowStart: v.optional(v.string()),
  windowEnd: v.optional(v.string()),
  windowDays: v.optional(v.array(v.number())),
  timezone: v.optional(v.string()),
  dailyCap: v.optional(v.number()),
  maxDurationMinutes: v.optional(v.number()),
  allowTestBookings: v.optional(v.boolean()),
  fromNumber: v.optional(v.string()),
  voice: v.optional(v.string()),
  /** Required (exactly "CALL") when switching to live. */
  confirm: v.optional(v.string()),
};

/** Owner only. Everything ships off and in dry run; going live needs a typed confirmation. */
export const setCallSettings = mutation({
  args: patchV,
  handler: async (ctx, a) => {
    const scope = await requireAgencyScope(ctx);
    if (scope.role !== "owner") throw new AccessError("FORBIDDEN", "Only the agency owner can change confirmation calls");
    const { confirm, ...patch } = a;
    const err = validateSettings(patch);
    if (err) throw new Error(err);
    const row = await ctx.db.query("outreachCallSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    const cur = toSettings(row);
    const next: CallSettings = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)) };
    if (next.mode === "live" && cur.mode !== "live" && confirm !== "CALL") throw new Error("Type CALL to turn live calling on");
    if (next.mode === "live" && !next.enabled) throw new Error("Turn confirmation calls on before choosing live");
    const now = Date.now();
    // Re-arming resets the "booked before it was on" line, so old bookings are never phoned.
    const enabledAt = next.enabled ? (cur.enabled && cur.enabledAt ? cur.enabledAt : now) : cur.enabledAt;
    const doc = {
      agencyId: scope.agencyId, enabled: next.enabled, mode: next.mode, delayMinutes: next.delayMinutes,
      windowStart: next.windowStart, windowEnd: next.windowEnd, windowDays: [...new Set(next.windowDays)].sort(),
      timezone: next.timezone, dailyCap: next.dailyCap, maxDurationMinutes: next.maxDurationMinutes,
      killSwitch: cur.killSwitch, allowTestBookings: next.allowTestBookings, fromNumber: next.fromNumber, voice: next.voice,
      enabledAt, updatedAt: now, updatedBy: scope.actor,
    };
    if (row) await ctx.db.replace(row._id, doc);
    else await ctx.db.insert("outreachCallSettings", doc);
    const what = [a.enabled !== undefined && (a.enabled ? "enabled" : "disabled"), a.mode && `mode ${a.mode}`].filter(Boolean).join(", ") || "settings";
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.calls_settings", "ok", undefined, what);
    return null;
  },
});

/** Any owner or admin can stop calling at once. Only the owner can lift it. */
export const setKillSwitch = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const scope = await requireAgencyScope(ctx);
    if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can change this");
    if (!on && scope.role !== "owner") throw new AccessError("FORBIDDEN", "Only the agency owner can lift the kill switch");
    const now = Date.now();
    const row = await ctx.db.query("outreachCallSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).first();
    if (row) await ctx.db.patch(row._id, { killSwitch: on, updatedAt: now, updatedBy: scope.actor });
    else {
      const d = DEFAULT_SETTINGS;
      await ctx.db.insert("outreachCallSettings", {
        agencyId: scope.agencyId, enabled: false, mode: "dry_run", delayMinutes: d.delayMinutes, windowStart: d.windowStart,
        windowEnd: d.windowEnd, windowDays: d.windowDays, timezone: d.timezone, dailyCap: d.dailyCap,
        maxDurationMinutes: d.maxDurationMinutes, killSwitch: on, allowTestBookings: false, updatedAt: now, updatedBy: scope.actor,
      });
    }
    await logEvent(ctx, scope.agencyId, scope.actor, on ? "outreach.calls_kill_on" : "outreach.calls_kill_off", "ok");
    return null;
  },
});

/* ----------------------------- dispatch ----------------------------- */

export type PlannedDial = {
  callId: Id<"outreachCalls">;
  body: Record<string, unknown>;
  leadId: string | null;
  workspaceId: string | null;
  agencyId: string;
};

/** Evaluate every candidate booking and write the outcome. Returns the dials to place. */
export const _planDue = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ dials: PlannedDial[] }> => {
    const now = a.now ?? Date.now();
    const dials: PlannedDial[] = [];
    for (const cs of await ctx.db.query("outreachCallSettings").collect()) {
      const s = toSettings(cs);
      if (!s.enabled || s.killSwitch) continue;
      const agencyId = cs.agencyId;
      const os = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).first();
      if (!os || os.paused) continue; // the Outreach pause also stops calls
      const blockers = s.mode === "live" ? liveBlockers() : [];

      // Candidates: every upcoming booking, plus bookings behind calls still waiting.
      const upcoming = await ctx.db.query("outreachBookings").withIndex("by_agency_start", (q) => q.eq("agencyId", agencyId).gte("startsAt", now - 60_000)).take(MAX_BOOKINGS_PER_AGENCY);
      const byId = new Map<string, Doc<"outreachBookings">>(upcoming.map((b) => [b._id as string, b]));
      for (const q of await ctx.db.query("outreachCalls").withIndex("by_agency_status", (x) => x.eq("agencyId", agencyId).eq("status", "queued")).take(MAX_BOOKINGS_PER_AGENCY)) {
        if (!byId.has(q.bookingId as string)) { const b = await ctx.db.get(q.bookingId); if (b) byId.set(b._id as string, b); }
      }
      const bookings = [...byId.values()].sort((x, y) => x.startsAt - y.startsAt);

      // Daily cap: every dialed call today in the agency zone. A dry run counts its own day's dry runs.
      const today = capDay(now, s.timezone);
      const recent = await ctx.db.query("outreachCalls").withIndex("by_agency_dialed", (q) => q.eq("agencyId", agencyId).gte("dialedAt", now - 36 * 3_600_000)).take(500);
      let used = recent.filter((c) => c.dialedAt !== undefined && capDay(c.dialedAt, s.timezone) === today).length;
      if (s.mode === "dry_run") {
        const dry = await ctx.db.query("outreachCalls").withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", "dry_run")).take(500);
        used += dry.filter((c) => capDay(c.updatedAt, s.timezone) === today).length;
      }

      const optPhones = new Set((await ctx.db.query("outreachCallOptOuts").withIndex("by_agency_phone", (q) => q.eq("agencyId", agencyId)).take(2000)).map((o) => o.phone).filter(Boolean));
      let dialsThisAgency = 0;

      for (const b of bookings) {
        const existing = await ctx.db.query("outreachCalls").withIndex("by_agency_booking", (q) => q.eq("agencyId", agencyId).eq("bookingId", b._id)).first();
        if (existing && !(existing.status === "queued" || (existing.status === "dry_run" && s.mode === "live"))) continue;

        const email = b.contactEmail?.toLowerCase();
        const optedOut = (b.phone ? optPhones.has(b.phone) : false) || (email
          ? (await ctx.db.query("outreachCallOptOuts").withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId).eq("email", email)).first()) !== null
          : false);
        const suppressed = email
          ? (await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId).eq("email", email)).first()) !== null
          : false;
        const scheduledFor = existing?.scheduledFor ?? b._creationTime + s.delayMinutes * 60_000;

        let d: Decision = evaluate(
          {
            leadSynced: b.phoneSynced === true, consentCall: b.consent?.call, status: b.status, startsAt: b.startsAt, firstSeenAt: b._creationTime,
            timezone: b.timezone, phone: b.phone, name: b.contactName, email: b.contactEmail,
          },
          s, { optedOut, suppressed, usedToday: used, scheduledFor }, now,
        );
        if (d.kind === "ok" && blockers.length) d = { kind: "wait", reason: blockers[0], trail: [...d.trail, `wait:${blockers[0]}`] };
        if (d.kind === "ok" && dialsThisAgency >= MAX_DIALS_PER_RUN) d = { kind: "wait", reason: "run_limit", trail: [...d.trail, "wait:run_limit"] };

        const base = { agencyId, bookingId: b._id, phone: b.phone, scheduledFor, updatedAt: now };
        const write = async (fields: Partial<Doc<"outreachCalls">> & { status: Doc<"outreachCalls">["status"] }) => {
          if (existing) { await ctx.db.patch(existing._id, { ...base, ...fields }); return existing._id; }
          return await ctx.db.insert("outreachCalls", { ...base, attempts: 0, createdAt: now, ...fields });
        };

        if (d.kind === "cancel") { await write({ status: "cancelled", skipReason: d.reason }); continue; }
        if (d.kind === "skip") { await write({ status: "skipped", skipReason: d.reason }); continue; }
        if (d.kind === "wait") { await write({ status: "queued", skipReason: d.reason }); continue; }

        const firstName = (b.contactName ?? "").split(/\s+/)[0];
        const vars = { firstName, demoTime: formatDemoTime(b.startsAt, d.calleeTz) };
        const id = await write({ status: "queued" }); // reserve the row (and its id) before building the body
        const input = {
          phone: d.phone, task: buildTask(vars), firstSentence: buildFirstSentence(vars), from: s.fromNumber, voice: s.voice,
          maxDurationMinutes: s.maxDurationMinutes, externalId: id as string,
          metadata: { agency_id: agencyId, booking_id: b._id as string, call_id: id as string },
        };
        used++;
        if (s.mode === "dry_run") {
          const body = buildCallBody({ ...input, webhook: webhookUrl(process.env, true) ?? "(BLAND_WEBHOOK_SECRET not set)" });
          await ctx.db.patch(id, { status: "dry_run", skipReason: undefined, dryRun: { body, reasons: d.trail }, phone: d.phone, updatedAt: now });
          continue;
        }
        // Live: claim BEFORE any network call. A crash after this leaves `dialing`, which is never re-picked.
        await ctx.db.patch(id, { status: "dialing", skipReason: undefined, attempts: 1, dialedAt: now, phone: d.phone, dryRun: undefined, updatedAt: now });
        dialsThisAgency++;
        dials.push({
          callId: id, agencyId, leadId: b.zuopsLeadId ?? null, workspaceId: os.zuopsWorkspaceId ?? null,
          body: buildCallBody({ ...input, webhook: webhookUrl() as string }),
        });
      }
    }
    return { dials };
  },
});

/** Put a claimed call back (nothing was dialed) or end it with a reason. */
export const _release = internalMutation({
  args: { callId: v.id("outreachCalls"), to: v.union(v.literal("queued"), v.literal("skipped")), reason: v.string() },
  handler: async (ctx, { callId, to, reason }) => {
    const c = await ctx.db.get(callId);
    if (!c || c.status !== "dialing" || c.blandCallId) return null; // never touch a call Bland has accepted
    await ctx.db.patch(callId, { status: to, skipReason: reason, attempts: 0, dialedAt: undefined, updatedAt: Date.now() });
    return null;
  },
});

export const _recordDial = internalMutation({
  args: { callId: v.id("outreachCalls"), blandCallId: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await ctx.db.get(a.callId);
    if (!c) return null;
    const now = Date.now();
    if (a.blandCallId) await ctx.db.patch(a.callId, { blandCallId: a.blandCallId, updatedAt: now });
    else await ctx.db.patch(a.callId, { status: "failed", result: { ...(c.result ?? {}), error: a.error ?? "Bland did not accept the call" }, updatedAt: now });
    await logEvent(ctx, c.agencyId, "system", a.blandCallId ? "outreach.call_dialed" : "outreach.call_failed", a.blandCallId ? "ok" : "denied", a.callId as string);
    return null;
  },
});

/** Cron entry, every minute. Plans in one mutation, then dials sequentially. */
export const dispatchDueCalls = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ planned: number; dialed: number }> => {
    const { dials } = await ctx.runMutation(internal.outreachCalls._planDue, { now: a.now });
    let dialed = 0;
    for (const d of dials) {
      // Consent can be withdrawn after booking. Ask Zuops again right before dialing.
      const key = process.env.ZUOPS_API_KEY;
      if (!d.leadId || !d.workspaceId || !key) {
        await ctx.runMutation(internal.outreachCalls._release, { callId: d.callId, to: "queued", reason: "consent_recheck_unavailable" });
        continue;
      }
      const r = await zuopsGet(`/v1/leads/${encodeURIComponent(d.leadId)}`, { workspace_id: d.workspaceId });
      if (!r.ok) {
        await ctx.runMutation(internal.outreachCalls._release, { callId: d.callId, to: "queued", reason: "consent_recheck_unavailable" });
        continue;
      }
      const lead = parseLead(r.json);
      if (!lead || lead.consent.call !== true) {
        await ctx.runMutation(internal.outreachCalls._release, { callId: d.callId, to: "skipped", reason: "consent_revoked" });
        continue;
      }
      const res = await placeCall(d.body, process.env.BLAND_API_KEY);
      await ctx.runMutation(internal.outreachCalls._recordDial, res.ok ? { callId: d.callId, blandCallId: res.callId } : { callId: d.callId, error: res.error });
      if (res.ok) dialed++;
    }
    return { planned: dials.length, dialed };
  },
});

/* ----------------------------- webhook ----------------------------- */

export const _applyEvent = internalMutation({
  args: {
    blandCallId: v.string(),
    externalId: v.optional(v.string()),
    completed: v.boolean(),
    failed: v.boolean(),
    errorMessage: v.optional(v.string()),
    answeredBy: v.optional(v.string()),
    summary: v.optional(v.string()),
    disposition: v.optional(v.string()),
    callLengthMin: v.optional(v.number()),
    optOut: v.boolean(),
  },
  handler: async (ctx, a): Promise<{ found: boolean }> => {
    let row = await ctx.db.query("outreachCalls").withIndex("by_bland_call", (q) => q.eq("blandCallId", a.blandCallId)).first();
    if (!row && a.externalId) {
      // The dial's response was lost; our own id came back in external_id.
      const id = ctx.db.normalizeId("outreachCalls", a.externalId);
      const byExt = id ? await ctx.db.get(id) : null;
      if (byExt && (byExt.status === "dialing" || byExt.status === "failed")) row = byExt;
    }
    if (!row || !(row.status === "dialing" || row.status === "completed" || row.status === "failed")) return { found: false };
    const now = Date.now();
    const status = a.completed && !a.failed ? "completed" : a.failed ? "failed" : row.status;
    await ctx.db.patch(row._id, {
      blandCallId: row.blandCallId ?? a.blandCallId,
      status, updatedAt: now,
      answeredBy: a.answeredBy ?? row.answeredBy,
      result: {
        summary: a.summary?.slice(0, 600) ?? row.result?.summary,
        disposition: a.disposition ?? row.result?.disposition,
        callLengthMin: a.callLengthMin ?? row.result?.callLengthMin,
        optOut: a.optOut || row.result?.optOut || undefined,
        error: a.failed ? (a.errorMessage?.slice(0, 200) ?? "The call failed") : undefined,
      },
    });
    if (a.optOut) {
      const booking = await ctx.db.get(row.bookingId);
      const email = booking?.contactEmail?.toLowerCase();
      const phone = row.phone;
      const dup = phone ? await ctx.db.query("outreachCallOptOuts").withIndex("by_agency_phone", (q) => q.eq("agencyId", row.agencyId).eq("phone", phone)).first() : null;
      if (!dup) await ctx.db.insert("outreachCallOptOuts", { agencyId: row.agencyId, phone, email, reason: "Asked not to be called during the confirmation call", at: now, callId: row._id });
      await logEvent(ctx, row.agencyId, "system", "outreach.call_opt_out", "ok", row._id as string);
    }
    return { found: true };
  },
});
