import { query, internalQuery, action, internalAction, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { crmAccess, pinnedAgencyId, requireCrm } from "./crm/access";
import { zuRequest, zuTarget, zuWritesOn, type ZuResult } from "./crm/zu";
import { logEvent } from "./outreach/scope";

/* ============================================================
   Outreach prospects into Zuops (owner decision 2026-11-11).

   Pulse's own outreachProspects rows become leads in the Zuops sub-account, in a
   pipeline stage named "Outreach". Pulse stays the record for prospecting; the
   owner tiers the leads by hand in Zuops when a studio responds.

   The rules this file exists to keep:
   1. A lead is created with name, email, source, stage, tags, inquiry and notes
      ONLY (leadBody is a whitelist). No contact number is ever sent, so Zuops
      cannot text or call these studios, who never opted in to that.
   2. The intake flag is never sent, so Zuops does not work the lead as new.
   3. An opted-out prospect (status "suppressed", a reply read as an opt-out, or
      any of its addresses on the opt-out list) is never pushed. One that opts
      out after linking is marked do-not-contact on its lead, once.
   4. Everything refuses unless ZUOPS_CRM_WRITES is exactly "on".
   5. The bulk push needs confirm: true (in the UI, only ConfirmDialog makes it).
   6. Access is crmAccess: an owner or admin of the pinned Pulse agency.
   7. crmProspectLinks, audit rows and logs carry ids, counts and status words only.

   This path does not go through crm.call. It makes a fixed set of requests:
   list stages, add the Outreach stage, create a lead, add or remove its tags,
   mark it do-not-contact. Nothing here sends a message.
   ============================================================ */

/** The prospect list is capped at 300 elsewhere (outreachProspects.list); so is this. */
const MAX_PROSPECTS = 300;
const MAX_LINKS = 300;
const MAX_EMAILS_CHECKED = 20;
const BATCH_DEFAULT = 25;
const BATCH_MAX = 50;
const SYNC_MAX = 25;
const STOP_AFTER_FAILURES = 3;
const STAGE_LABEL = "Outreach";
const ZU_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const STATUS_TAGS = ["Outreach: not emailed", "Outreach: email sent", "Outreach: replied", "Outreach: booked"] as const;
export type StatusTag = (typeof STATUS_TAGS)[number];

/* ------------------------------ pure parts ------------------------------ */

type ProspectState = Pick<Doc<"outreachProspects">, "status" | "repliedAt" | "bookedAt">;

/** Exactly one status tag for a prospect. `emailed` = Lawrence's first email was
 *  accepted (a follow-up sequence exists). Booked beats replied beats emailed.
 *  Opt-out is checked separately (isOptedOut) and wins over all of these. */
export function statusTag(p: ProspectState, emailed: boolean): StatusTag {
  if (p.bookedAt !== undefined) return "Outreach: booked";
  if (p.status === "replied" || p.repliedAt !== undefined) return "Outreach: replied";
  if (emailed) return "Outreach: email sent";
  return "Outreach: not emailed";
}

/** The opted-out state: status "suppressed", a reply read as an opt-out, or an address on the opt-out list. */
export function isOptedOut(p: Pick<Doc<"outreachProspects">, "status" | "replyIntent">, anySuppressed: boolean): boolean {
  return p.status === "suppressed" || p.replyIntent?.optedOut === true || anySuppressed;
}

/** The first non-generic published email, else the first; null when there is none. */
export function primaryEmail(p: Pick<Doc<"outreachProspects">, "contacts">): string | null {
  const emails = p.contacts?.emails ?? [];
  const pick = emails.find((e) => !e.generic && e.address.trim()) ?? emails.find((e) => e.address.trim());
  return pick ? pick.address.trim() : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export type LeadBody = {
  full_name: string;
  email: string;
  source: "other";
  stage_key: string;
  tags: string[];
  inquiry: string;
  notes: string;
};

/** The whole create body. A whitelist: nothing else about the prospect is read. */
export function leadBody(p: Pick<Doc<"outreachProspects">, "name" | "handle" | "websiteUrl">, email: string, stageKey: string, tag: StatusTag): LeadBody {
  const handle = p.handle?.trim() || "";
  const name = p.name?.trim() || (handle ? `@${handle.replace(/^@/, "")}` : "") || (p.websiteUrl ? hostOf(p.websiteUrl) : null) || "Outreach prospect";
  const notes = [p.websiteUrl ? `Website: ${p.websiteUrl}` : "", handle ? `Instagram: @${handle.replace(/^@/, "")}` : ""].filter(Boolean).join("\n");
  return {
    full_name: name.slice(0, 120),
    email,
    source: "other",
    stage_key: stageKey,
    tags: [STAGE_LABEL, tag],
    inquiry: "Pulse outreach prospect",
    notes,
  };
}

/** The batch size: default 25, at most 50, at least 1. */
export function batchSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return BATCH_DEFAULT;
  return Math.max(1, Math.min(BATCH_MAX, Math.floor(limit)));
}

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : {});

/** The key of the stage labeled "Outreach" (any case) in a GET /v1/stages answer. */
export function outreachStageKey(data: unknown): string | null {
  const list = Array.isArray(data) ? data : rec(data).stages;
  if (!Array.isArray(list)) return null;
  for (const s of list) {
    const r = rec(s);
    if (typeof r.label === "string" && r.label.trim().toLowerCase() === STAGE_LABEL.toLowerCase() && typeof r.key === "string" && r.key) return r.key;
  }
  return null;
}

/** An id from a create answer: { id }, { lead: { id } } or { stage: { key } }. */
function pickId(data: unknown, inner: string, field: "id" | "key"): string | null {
  const top = rec(data);
  const val = top[field] ?? rec(top[inner])[field];
  return typeof val === "string" && val ? val : null;
}

/** The existing lead's id on a 409 duplicate (details.lead_id). */
function duplicateLeadId(res: Extract<ZuResult, { ok: false }>): string | null {
  if (res.status !== 409) return null;
  const id = rec(res.details).lead_id;
  return typeof id === "string" && ZU_ID.test(id) ? id : null;
}

/* ------------------------------ reads ------------------------------ */

/** True when any of the prospect's published addresses is on the agency's opt-out list (indexed, bounded). */
async function anySuppressed(ctx: QueryCtx, agencyId: string, p: Doc<"outreachProspects">): Promise<boolean> {
  const seen = new Set<string>();
  for (const e of (p.contacts?.emails ?? []).slice(0, MAX_EMAILS_CHECKED)) {
    for (const addr of [e.address, e.address.trim().toLowerCase()]) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      const hit = await ctx.db
        .query("outreachSuppressions")
        .withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId).eq("email", addr))
        .first();
      if (hit) return true;
    }
  }
  return false;
}

async function emailed(ctx: QueryCtx, prospectId: Id<"outreachProspects">): Promise<boolean> {
  return (await ctx.db.query("outreachSequences").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).first()) !== null;
}

async function linkFor(ctx: QueryCtx, agencyId: string, prospectId: Id<"outreachProspects">) {
  return await ctx.db
    .query("crmProspectLinks")
    .withIndex("by_agency_prospect", (q) => q.eq("agencyId", agencyId).eq("prospectId", prospectId))
    .first();
}

type Classified = {
  row: Doc<"outreachProspects">;
  linked: boolean;
  optedOut: boolean;
  email: string | null;
};

/** The oldest 300 prospects, each with its link, opt-out and primary email. */
async function classifyAll(ctx: QueryCtx, agencyId: string): Promise<Classified[]> {
  const rows = await ctx.db
    .query("outreachProspects")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .order("asc")
    .take(MAX_PROSPECTS);
  const out: Classified[] = [];
  for (const row of rows) {
    const linked = (await linkFor(ctx, agencyId, row._id)) !== null;
    const optedOut = isOptedOut(row, await anySuppressed(ctx, agencyId, row));
    out.push({ row, linked, optedOut, email: primaryEmail(row) });
  }
  return out;
}

/** What a push would do, for the Prospects card. Null for anyone without CRM access. */
export const plan = query({
  args: {},
  handler: async (ctx) => {
    const a = await crmAccess(ctx);
    if (!a.allowed) return null;
    const agencyId = a.scope.agencyId;
    const all = await classifyAll(ctx, agencyId);
    let eligible = 0, linked = 0, toPush = 0, skippedNoEmail = 0, skippedOptedOut = 0;
    for (const c of all) {
      if (c.linked) linked++;
      if (c.optedOut) { skippedOptedOut++; continue; }
      if (!c.email) { skippedNoEmail++; continue; }
      eligible++;
      if (!c.linked) toPush++;
    }
    const anyLink = await ctx.db.query("crmProspectLinks").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).first();
    return {
      total: all.length,
      eligible,
      linked,
      toPush,
      skippedNoEmail,
      skippedOptedOut,
      keyConfigured: !!zuTarget().apiKey,
      writesOn: zuWritesOn(),
      /** A push has found or made the Outreach stage (at least one prospect is linked). */
      stageReady: anyLink !== null,
    };
  },
});

/* ------------------------------ internal ------------------------------ */

export const _gate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const scope = await requireCrm(ctx);
    return { agencyId: scope.agencyId, actor: scope.actor };
  },
});

/** Up to `limit` eligible, unlinked prospects, oldest first, and how many there are in all.
 *  The fields returned are exactly what leadBody needs; nothing is stored from them. */
export const _candidates = internalQuery({
  args: { agencyId: v.string(), limit: v.number() },
  handler: async (ctx, a) => {
    const all = await classifyAll(ctx, a.agencyId);
    const ready = all.filter((c) => !c.linked && !c.optedOut && c.email);
    const picked = [];
    for (const c of ready.slice(0, a.limit)) {
      picked.push({
        prospectId: c.row._id,
        name: c.row.name,
        handle: c.row.handle,
        websiteUrl: c.row.websiteUrl,
        email: c.email as string,
        tag: statusTag(c.row, await emailed(ctx, c.row._id)),
      });
    }
    return { total: ready.length, picked };
  },
});

export const _link = internalMutation({
  args: { agencyId: v.string(), prospectId: v.id("outreachProspects"), zuLeadId: v.string(), lastStatus: v.string(), matched: v.boolean() },
  handler: async (ctx, a): Promise<boolean> => {
    if (!ZU_ID.test(a.zuLeadId)) return false;
    const existing = await linkFor(ctx, a.agencyId, a.prospectId);
    if (existing) return false;
    const now = Date.now();
    await ctx.db.insert("crmProspectLinks", {
      agencyId: a.agencyId, prospectId: a.prospectId, zuLeadId: a.zuLeadId, pushedAt: now,
      lastStatus: a.lastStatus, lastSyncedAt: now, ...(a.matched ? { matched: true } : {}),
    });
    return true;
  },
});

/** One audit row: the action, the result and counts only. */
export const _audit = internalMutation({
  args: { agencyId: v.string(), actor: v.string(), action: v.string(), result: v.union(v.literal("ok"), v.literal("denied"), v.literal("unknown")), detail: v.string() },
  handler: async (ctx, a) => {
    await logEvent(ctx, a.agencyId, a.actor, a.action, a.result, undefined, a.detail);
  },
});

/* ------------------------------ push ------------------------------ */

type PushResult = {
  ok: boolean;
  pushed: number;
  matched: number;
  failed: number;
  remaining: number;
  reason?: string;
  code?: string;
  retryAfter?: number;
};

const refusal = (code: string, reason: string): PushResult => ({ ok: false, pushed: 0, matched: 0, failed: 0, remaining: 0, code, reason });

/** Adds up to `limit` (default 25, max 50) eligible prospects to Zuops as leads in the
 *  Outreach stage. Refuses, with no request, without access, a key, writes on, or confirm. */
export const push = action({
  args: { confirm: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<PushResult> => {
    // 1. Access (throws FORBIDDEN, like crm.call).
    const who: { agencyId: string; actor: string } = await ctx.runQuery(internal.crmProspects._gate, {});
    const audit = (result: "ok" | "denied" | "unknown", detail: string) =>
      ctx.runMutation(internal.crmProspects._audit, { agencyId: who.agencyId, actor: who.actor, action: "crm.prospects.push", result, detail });

    // 2. A key, 3. the write switch, 4. a person's confirm.
    const { mock, apiKey } = zuTarget();
    if (!apiKey) return refusal("not_connected", "Zuops is not connected on this deployment yet.");
    if (!zuWritesOn()) {
      await audit("denied", "read_only");
      return refusal("read_only", "Read only here. This deployment cannot change Zuops.");
    }
    if (args.confirm !== true) {
      await audit("denied", "needs_confirm");
      return refusal("needs_confirm", "Confirm first: this adds prospects to Zuops as leads.");
    }
    const base = mock ? { base: mock } : {};
    const req = (method: string, path: string, body?: unknown, idempotencyKey?: string) =>
      zuRequest({ key: apiKey, method, path, body, idempotencyKey, ...base });

    const size = batchSize(args.limit);
    const work: { total: number; picked: Array<{ prospectId: Id<"outreachProspects">; name?: string; handle?: string; websiteUrl?: string; email: string; tag: StatusTag }> } =
      await ctx.runQuery(internal.crmProspects._candidates, { agencyId: who.agencyId, limit: size });
    if (work.picked.length === 0) return { ok: true, pushed: 0, matched: 0, failed: 0, remaining: 0 };

    // The Outreach stage: find it, or add it once.
    const stages = await req("GET", "/v1/stages");
    if (!stages.ok) {
      await audit("denied", `stages ${stages.status}`);
      return { ...refusal(stages.code, stages.reason), remaining: work.total, ...(stages.retryAfter !== undefined ? { retryAfter: stages.retryAfter } : {}) };
    }
    let stageKey = outreachStageKey(stages.data);
    if (!stageKey) {
      const made = await req("POST", "/v1/stages", { label: STAGE_LABEL, behavior: "new", color: "slate", manual_only: true }, "pulse-outreach-stage");
      stageKey = made.ok ? pickId(made.data, "stage", "key") : null;
      if (!stageKey) {
        await audit("denied", `stage_create ${made.status}`);
        const reason = made.ok ? "Zuops did not return the new stage." : made.reason;
        return { ...refusal(made.ok ? "bad_response" : made.code, reason), remaining: work.total };
      }
    }

    let pushed = 0, matched = 0, failed = 0, streak = 0;
    let stop: { reason: string; code: string; retryAfter?: number } | null = null;
    for (const p of work.picked) {
      const body = leadBody(p, p.email, stageKey, p.tag);
      const res = await req("POST", "/v1/leads", body, `prospect-${p.prospectId}`);
      let leadId: string | null = null;
      let isMatch = false;
      if (res.ok) {
        leadId = pickId(res.data, "lead", "id");
        if (leadId && !ZU_ID.test(leadId)) leadId = null;
      } else {
        const dup = duplicateLeadId(res);
        if (dup) {
          // The lead already existed: link it and add the tags. Its stage is left alone.
          const tagged = await req("PATCH", `/v1/leads/${encodeURIComponent(dup)}`, { add_tags: [STAGE_LABEL, p.tag] });
          if (tagged.ok) { leadId = dup; isMatch = true; }
          else if (tagged.status === 429) { stop = { code: tagged.code, reason: tagged.reason, retryAfter: tagged.retryAfter }; }
        } else if (res.status === 429) {
          stop = { code: res.code, reason: res.reason, retryAfter: res.retryAfter };
        }
      }
      if (leadId) {
        await ctx.runMutation(internal.crmProspects._link, { agencyId: who.agencyId, prospectId: p.prospectId, zuLeadId: leadId, lastStatus: p.tag, matched: isMatch });
        if (isMatch) matched++;
        else pushed++;
        streak = 0;
      } else {
        failed++;
        streak++;
        if (!stop && streak >= STOP_AFTER_FAILURES) stop = { code: res.ok ? "bad_response" : res.code, reason: res.ok ? "Zuops did not return the new lead." : res.reason };
      }
      if (stop) break;
    }

    const remaining = Math.max(0, work.total - pushed - matched);
    await audit(failed === 0 && !stop ? "ok" : pushed + matched > 0 ? "unknown" : "denied", `${pushed} pushed, ${matched} matched, ${failed} failed, ${remaining} remaining`);
    const out: PushResult = { ok: failed === 0 && !stop, pushed, matched, failed, remaining };
    if (stop) {
      out.code = stop.code;
      out.reason = stop.reason;
      if (stop.retryAfter !== undefined) out.retryAfter = stop.retryAfter;
    } else if (failed > 0) {
      out.reason = `${failed} could not be added. Try again later.`;
    }
    return out;
  },
});

/* ------------------------------ status sync ------------------------------ */

/** Linked prospects whose lead needs a change: a new status tag, or do-not-contact. At most 25. */
export const _syncWork = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, a) => {
    const links = await ctx.db.query("crmProspectLinks").withIndex("by_agency", (q) => q.eq("agencyId", a.agencyId)).take(MAX_LINKS);
    const jobs: Array<{ linkId: Id<"crmProspectLinks">; zuLeadId: string; kind: "dnc" | "tag"; from: string; to: string }> = [];
    for (const l of links) {
      if (jobs.length >= SYNC_MAX) break;
      const p = await ctx.db.get(l.prospectId);
      if (!p || p.agencyId !== a.agencyId) continue;
      if (isOptedOut(p, await anySuppressed(ctx, a.agencyId, p))) {
        if (!l.dnc) jobs.push({ linkId: l._id, zuLeadId: l.zuLeadId, kind: "dnc", from: l.lastStatus, to: l.lastStatus });
        continue;
      }
      if (l.dnc) continue;
      const tag = statusTag(p, await emailed(ctx, p._id));
      if (tag !== l.lastStatus) jobs.push({ linkId: l._id, zuLeadId: l.zuLeadId, kind: "tag", from: l.lastStatus, to: tag });
    }
    return jobs;
  },
});

export const _synced = internalMutation({
  args: { linkId: v.id("crmProspectLinks"), lastStatus: v.optional(v.string()), dnc: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const patch: Partial<Doc<"crmProspectLinks">> = { lastSyncedAt: Date.now() };
    if (a.lastStatus !== undefined) patch.lastStatus = a.lastStatus;
    if (a.dnc) patch.dnc = true;
    await ctx.db.patch(a.linkId, patch);
  },
});

/** Every 15 minutes: swap status tags on linked leads and mark opted-out ones
 *  do-not-contact. Never creates a lead, never moves a stage, never sends. A no-op
 *  unless a key is set and ZUOPS_CRM_WRITES is "on". */
export const syncStatuses = internalAction({
  args: {},
  handler: async (ctx): Promise<{ tagged: number; dnc: number; failed: number } | null> => {
    const { mock, apiKey } = zuTarget();
    if (!apiKey || !zuWritesOn()) return null;
    const agencyId = pinnedAgencyId();
    if (!agencyId) return null;
    const jobs = await ctx.runQuery(internal.crmProspects._syncWork, { agencyId });
    if (jobs.length === 0) return { tagged: 0, dnc: 0, failed: 0 };
    const base = mock ? { base: mock } : {};
    let tagged = 0, dnc = 0, failed = 0;
    for (const j of jobs) {
      if (!ZU_ID.test(j.zuLeadId)) { failed++; continue; }
      const id = encodeURIComponent(j.zuLeadId);
      const res = j.kind === "dnc"
        ? await zuRequest({ key: apiKey, method: "POST", path: `/v1/leads/${id}/do-not-contact`, idempotencyKey: `dnc-${j.linkId}`, ...base })
        : await zuRequest({ key: apiKey, method: "PATCH", path: `/v1/leads/${id}`, body: { add_tags: [j.to], remove_tags: [j.from] }, ...base });
      if (res.ok) {
        await ctx.runMutation(internal.crmProspects._synced, j.kind === "dnc" ? { linkId: j.linkId, dnc: true } : { linkId: j.linkId, lastStatus: j.to });
        if (j.kind === "dnc") dnc++;
        else tagged++;
      } else {
        failed++;
        if (res.status === 429) break;
      }
    }
    await ctx.runMutation(internal.crmProspects._audit, {
      agencyId, actor: "system", action: "crm.prospects.sync", result: failed === 0 ? "ok" : tagged + dnc > 0 ? "unknown" : "denied",
      detail: `${tagged} tagged, ${dnc} do-not-contact, ${failed} failed`,
    });
    return { tagged, dnc, failed };
  },
});
