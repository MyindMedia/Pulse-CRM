import { query, internalQuery, action } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { crmAccess, requireCrm } from "./crm/access";
import { ZU_OPS } from "./crm/ops.generated";
import { buildPath, gate, level, pickFields } from "./crm/policy";
import { zuRequest, type ZuLimits } from "./crm/zu";
import { CRM_EVENTS, signalKind } from "./crm/webhook";
import { logEvent } from "./outreach/scope";
import { platformAgencyId } from "./lib/platformAgency";

/* ============================================================
   Agency CRM on Zuops: pass-through, nothing stored (design addendum D2, D3, D11).

   `call` is the only way out to Zuops. Every screen reads live through it; the
   only rows the CRM writes are `crmPulses` (event name and ids from the webhook)
   and audit rows in `outreachEvents` (actor, operation, path ids, HTTP status).
   Keys stay on the server: the browser learns only which switches are on.
   ============================================================ */

const env = (name: string) => process.env[name] ?? "";

/** For the nav and the page: may this viewer use the CRM? */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const a = await crmAccess(ctx);
    return a.allowed ? { allowed: true } : { allowed: false, reason: a.reason };
  },
});

/** Which switches are on. Never a key, only whether one is set. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const a = await crmAccess(ctx);
    if (!a.allowed) return null;
    return {
      keyConfigured: !!env("ZUOPS_CRM_API_KEY"),
      writesOn: env("ZUOPS_CRM_WRITES") === "on",
      adminKey: !!env("ZUOPS_CRM_ADMIN_KEY"),
      webhookConfigured: !!env("ZUOPS_CRM_WEBHOOK_SECRET"),
    };
  },
});

/** The newest webhook pulse per kind. Open screens subscribe and refetch what changed. */
export const signal = query({
  args: {},
  handler: async (ctx) => {
    const a = await crmAccess(ctx);
    if (!a.allowed) return null;
    const rows = await ctx.db
      .query("crmPulses")
      .withIndex("by_agency_at", (q) => q.eq("agencyId", a.scope.agencyId))
      .order("desc")
      .take(50);
    const out = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
    for (const r of rows) {
      out.at = Math.max(out.at, r.at);
      const kind = signalKind(r.event);
      if (kind) out[kind] = Math.max(out[kind], r.at);
    }
    return out;
  },
});

/* --------------------------------- call --------------------------------- */

const JSON_MAX_BYTES = 900 * 1024;
const IDEM = /^[A-Za-z0-9_-]{8,128}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type CallResult = { ok: boolean; status: number; json: string | null; reason?: string; code?: string; retryAfter?: number; limits: ZuLimits };

const refuse = (code: string, reason: string): CallResult => ({ ok: false, status: 0, json: null, code, reason, limits: {} });

/** Runs one Zuops operation from the registry, after every gate in D11. A failure
 *  at any gate makes no request. On a Zuops refusal `json` carries Zuops's
 *  `details` (for example the id of the lead that already exists) when it sent one. */
export const call = action({
  args: {
    op: v.string(),
    path: v.optional(v.record(v.string(), v.string())),
    query: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    body: v.optional(v.any()),
    idem: v.optional(v.string()),
    confirm: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CallResult> => {
    // 1. Access. The caller's identity carries into runQuery; this throws FORBIDDEN.
    const who: { agencyId: string; actor: string } = await ctx.runQuery(internal.crm._gate, {});

    // 2. A key.
    const apiKey = env("ZUOPS_CRM_API_KEY");
    if (!apiKey) return refuse("not_connected", "Zuops is not connected on this deployment yet.");

    // 3. A registry operation.
    const op = Object.prototype.hasOwnProperty.call(ZU_OPS, args.op) ? ZU_OPS[args.op] : undefined;
    if (!op) return refuse("unknown_op", "That is not a Zuops function Pulse knows.");

    // 4. Path values.
    const built = buildPath(op, args.path);
    if (!built.ok) return refuse("bad_path", built.reason);

    // 5. Query and body fields.
    const q = pickFields(op.query, args.query, "query");
    if (!q.ok) return refuse("bad_field", q.reason);
    if (op.method === "GET" && args.body !== undefined) return refuse("bad_field", "A read does not take a request body.");
    const b = pickFields(op.body, args.body, "body");
    if (!b.ok) return refuse("bad_field", b.reason);

    // 6. Switches and confirmation (the body matters for create_lead with run_intake).
    const adminKey = env("ZUOPS_CRM_ADMIN_KEY");
    const g = gate(op, { writesOn: env("ZUOPS_CRM_WRITES") === "on", adminKey: !!adminKey }, args.confirm === true, b.value);
    if (!g.ok) return refuse(g.code, g.reason);

    // 7. The key for this level.
    const key = level(op) === "admin" ? adminKey : apiKey;

    // 8. An idempotency key on every write, the caller's when it is well formed.
    const isWrite = op.method !== "GET";
    const idempotencyKey = isWrite ? (args.idem && IDEM.test(args.idem) ? args.idem : crypto.randomUUID()) : undefined;
    // Writes other than DELETE always carry a JSON object; a DELETE carries one only when it has fields.
    const hasFields = Object.keys(b.value).length > 0;
    const body = !isWrite ? undefined : op.method === "DELETE" && !hasFields ? undefined : b.value;
    const query = Object.keys(q.value).length ? (q.value as Record<string, string | number | boolean>) : undefined;

    // 9. The request.
    const res = await zuRequest({ key, method: op.method, path: built.path, query, body, idempotencyKey });

    // 10. Audit every write: who, which operation, the path with its ids, the status. Never the
    //     body or query values. The one exception is the lead id of a send (D6), which travels in
    //     the body; it is an id, checked against the same strict pattern as webhook ids.
    if (isWrite) {
      const leadId = typeof b.value.lead_id === "string" && ID.test(b.value.lead_id) ? b.value.lead_id : undefined;
      await ctx.runMutation(internal.crm._audit, {
        agencyId: who.agencyId,
        actor: who.actor,
        op: op.id,
        resource: leadId ? `${built.path} lead:${leadId}` : built.path,
        ok: res.ok,
        status: res.status,
      });
    }

    const out: CallResult = { ok: res.ok, status: res.status, json: null, limits: res.limits };
    if (res.ok) {
      const json = res.data === undefined ? null : JSON.stringify(res.data);
      if (json !== null && new TextEncoder().encode(json).length > JSON_MAX_BYTES) {
        return {
          ok: false,
          status: res.status,
          json: null,
          code: "too_large",
          reason: "That answer is too large to show. Narrow it with a filter or a smaller limit.",
          limits: res.limits,
        };
      }
      out.json = json;
      return out;
    }
    out.code = res.code;
    out.reason = res.reason;
    if (res.retryAfter !== undefined) out.retryAfter = res.retryAfter;
    if (res.details !== undefined) {
      const d = JSON.stringify(res.details);
      if (d !== undefined && d.length <= 64 * 1024) out.json = d;
    }
    return out;
  },
});

/* ------------------------------- internal ------------------------------- */

export const _gate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const scope = await requireCrm(ctx);
    return { agencyId: scope.agencyId, actor: scope.actor };
  },
});

export const _audit = internalMutation({
  args: {
    agencyId: v.string(),
    actor: v.string(),
    op: v.string(),
    resource: v.string(),
    ok: v.boolean(),
    status: v.number(),
  },
  handler: async (ctx, a) => {
    await logEvent(ctx, a.agencyId, a.actor, `crm.${a.op}`, a.ok ? "ok" : "denied", a.resource.slice(0, 300), String(a.status));
  },
});

const DELIVERY = /^[A-Za-z0-9_.:-]{1,128}$/;

/** One pulse per webhook delivery, de-duplicated on the delivery id. Ids only. */
export const _pulse = internalMutation({
  args: {
    event: v.string(),
    deliveryId: v.string(),
    leadId: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    callId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<"stored" | "duplicate" | "no_agency" | "invalid"> => {
    if (!CRM_EVENTS.has(a.event) || !DELIVERY.test(a.deliveryId)) return "invalid";
    for (const id of [a.leadId, a.bookingId, a.messageId, a.callId]) if (id !== undefined && !ID.test(id)) return "invalid";
    const agencyId = await platformAgencyId(ctx);
    if (!agencyId) return "no_agency";
    const seen = await ctx.db.query("crmPulses").withIndex("by_delivery", (q) => q.eq("deliveryId", a.deliveryId)).first();
    if (seen) return "duplicate";
    await ctx.db.insert("crmPulses", {
      agencyId,
      event: a.event,
      deliveryId: a.deliveryId,
      leadId: a.leadId,
      bookingId: a.bookingId,
      messageId: a.messageId,
      callId: a.callId,
      at: Date.now(),
    });
    return "stored";
  },
});

const PULSE_TTL_MS = 7 * 86_400_000;
const PRUNE_BATCH = 500;

/** Daily: drop pulses older than 7 days, at most 500 per run, oldest first. */
export const prunePulses = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - PULSE_TTL_MS;
    const old = await ctx.db
      .query("crmPulses")
      .withIndex("by_at", (q) => q.lt("at", cutoff))
      .take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    // A full batch means more may be waiting; drain the rest a minute later.
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(60_000, internal.crm.prunePulses, {});
    return old.length;
  },
});
