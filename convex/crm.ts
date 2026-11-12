import { query, internalQuery, action } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { crmAccess, pinnedAgencyId, requireCrm } from "./crm/access";
import { ZU_OPS, type ZuOp } from "./crm/ops.generated";
import { buildPath, gate, level, pickFields, redactSecrets } from "./crm/policy";
import { MOCK_KEY, mockBase, zuRequest, type ZuLimits } from "./crm/zu";
import { CRM_EVENTS, signalKind } from "./crm/webhook";
import { redact } from "./outreach/policy";

/* ============================================================
   Agency CRM on Zuops: pass-through, nothing stored (design addendum D2, D3, D11).

   `call` is the only way out to Zuops. Every screen reads live through it; the
   only rows the CRM writes are `crmPulses` (event name, kind and ids from the
   webhook) and audit rows in `outreachEvents` (actor, operation, path ids, HTTP
   status or refusal code). Keys stay on the server: the browser learns only which
   switches are on, and secret-looking values in answers are hidden (F-B12).

   Mock mode (F-B13): ZUOPS_CRM_MOCK_URL set to exactly http://127.0.0.1:<port>
   sends every request to that local mock with "Bearer zu-mock"; the real keys are
   never read. Any other value is ignored.
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
    const mock = mockBase() !== null;
    const out: { keyConfigured: boolean; writesOn: boolean; adminKey: boolean; webhookConfigured: boolean; mock?: true } = {
      keyConfigured: mock || !!env("ZUOPS_CRM_API_KEY"),
      writesOn: env("ZUOPS_CRM_WRITES") === "on",
      adminKey: mock || !!env("ZUOPS_CRM_ADMIN_KEY"),
      webhookConfigured: !!env("ZUOPS_CRM_WEBHOOK_SECRET"),
    };
    if (mock) out.mock = true;
    return out;
  },
});

const KINDS = ["lead", "booking", "message", "call", "deal"] as const;

/** The newest webhook pulse per kind (F-B10: one indexed read per kind, so a busy
 *  kind can never push a quiet one back to 0). Open screens subscribe and refetch. */
export const signal = query({
  args: {},
  handler: async (ctx) => {
    const a = await crmAccess(ctx);
    if (!a.allowed) return null;
    const out = { at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 };
    for (const kind of KINDS) {
      const row = await ctx.db
        .query("crmPulses")
        .withIndex("by_agency_kind_at", (q) => q.eq("agencyId", a.scope.agencyId).eq("kind", kind))
        .order("desc")
        .first();
      if (row) {
        out[kind] = row.at;
        out.at = Math.max(out.at, row.at);
      }
    }
    return out;
  },
});

/* --------------------------------- call --------------------------------- */

const JSON_MAX_BYTES = 900 * 1024;
const IDEM = /^[A-Za-z0-9_-]{8,128}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CallResult = { ok: boolean; status: number; json: string | null; reason?: string; code?: string; retryAfter?: number; limits: ZuLimits };

const refuse = (code: string, reason: string): CallResult => ({ ok: false, status: 0, json: null, code, reason, limits: {} });

/** The audit `resource`: the path with its ids, where a value with "@" (an email,
 *  say) is written as [masked] (F-B8), plus the lead id of a send (D6). */
function auditResource(op: ZuOp, values: Record<string, string>, leadId: string | undefined): string {
  let path = op.path;
  for (const name of op.pathParams) {
    const v = values[name] ?? "";
    path = path.replace(`{${name}}`, v.includes("@") ? "[masked]" : encodeURIComponent(v));
  }
  return (leadId ? `${path} lead:${leadId}` : path).slice(0, 300);
}

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

    // 2. A key, or the local mock (whose requests never carry a real key).
    const mock = mockBase();
    const apiKey = mock ? MOCK_KEY : env("ZUOPS_CRM_API_KEY");
    if (!apiKey) return refuse("not_connected", "Zuops is not connected on this deployment yet.");

    // 3. A registry operation.
    const op = Object.prototype.hasOwnProperty.call(ZU_OPS, args.op) ? ZU_OPS[args.op] : undefined;
    if (!op) return refuse("unknown_op", "That is not a Zuops function Pulse knows.");

    // 4. Path values. F-B9: a {workspace_id} segment is the pinned workspace when one is
    //    set (the client's value is ignored), else the client's value must be a UUID.
    const pathValues: Record<string, string> = { ...(args.path ?? {}) };
    if (op.pathParams.includes("workspace_id")) {
      const pinnedWs = env("ZUOPS_CRM_WORKSPACE_ID").trim();
      if (pinnedWs) pathValues.workspace_id = pinnedWs;
      else if (!UUID.test(pathValues.workspace_id ?? "")) return refuse("bad_path", "The sub-account id must be a UUID.");
    }
    const built = buildPath(op, pathValues);
    if (!built.ok) return refuse("bad_path", built.reason);

    // 5. Query and body fields, and the retry key.
    const q = pickFields(op.query, args.query, "query");
    if (!q.ok) return refuse("bad_field", q.reason);
    if (op.method === "GET" && args.body !== undefined) return refuse("bad_field", "A read does not take a request body.");
    const b = pickFields(op.body, args.body, "body", op.openBody === true);
    if (!b.ok) return refuse("bad_field", b.reason);
    if (args.idem !== undefined && !IDEM.test(args.idem)) return refuse("bad_field", "That retry key is not valid.");

    const isWrite = op.method !== "GET";
    const leadId = typeof b.value.lead_id === "string" && ID.test(b.value.lead_id) ? b.value.lead_id : undefined;
    const audit = { agencyId: who.agencyId, actor: who.actor, op: op.id, resource: auditResource(op, pathValues, leadId) };

    // 6. Switches and confirmation (some kinds depend on the body). Refusals here are audited.
    const adminKey = mock ? MOCK_KEY : env("ZUOPS_CRM_ADMIN_KEY");
    const g = gate(op, { writesOn: env("ZUOPS_CRM_WRITES") === "on", adminKey: !!adminKey }, args.confirm === true, b.value);
    if (!g.ok) {
      if (isWrite) await ctx.runMutation(internal.crm._auditDenied, { ...audit, code: g.code });
      return refuse(g.code, g.reason);
    }

    // 7. The key for this level.
    const key = level(op) === "admin" ? adminKey : apiKey;

    // 8. An idempotency key on every write: the caller's (already checked) or a new one.
    const idempotencyKey = isWrite ? (args.idem ?? crypto.randomUUID()) : undefined;
    // Writes other than DELETE always carry a JSON object; a DELETE carries one only when it has fields.
    const hasFields = Object.keys(b.value).length > 0;
    const body = !isWrite ? undefined : op.method === "DELETE" && !hasFields ? undefined : b.value;
    const query = Object.keys(q.value).length ? (q.value as Record<string, string | number | boolean>) : undefined;

    // 9. Audit first (F-B7): the row exists before anything reaches Zuops, as "unknown".
    const auditId: Id<"outreachEvents"> | null = isWrite ? await ctx.runMutation(internal.crm._auditStart, audit) : null;

    // 10. The request.
    const res = await zuRequest({ key, method: op.method, path: built.path, query, body, idempotencyKey, ...(mock ? { base: mock } : {}) });

    // 11. Close the audit row: ok or denied, with the HTTP status. Never the body or query values.
    if (auditId) await ctx.runMutation(internal.crm._auditEnd, { id: auditId, ok: res.ok, status: res.status });

    const out: CallResult = { ok: res.ok, status: res.status, json: null, limits: res.limits };
    if (res.ok) {
      const json = res.data === undefined ? null : JSON.stringify(redactSecrets(op.id, res.data));
      if (json !== null && new TextEncoder().encode(json).length > JSON_MAX_BYTES) {
        // F-B6: a write that succeeded still succeeded; only the answer is withheld.
        if (isWrite) return { ok: true, status: res.status, json: null, reason: "Done. The answer was too large to show.", limits: res.limits };
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
      const d = JSON.stringify(redactSecrets(op.id, res.details));
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

const auditArgs = { agencyId: v.string(), actor: v.string(), op: v.string(), resource: v.string() };

/** The audit row for a write, inserted before the request with result "unknown". */
export const _auditStart = internalMutation({
  args: auditArgs,
  handler: async (ctx, a): Promise<Id<"outreachEvents">> => {
    return await ctx.db.insert("outreachEvents", {
      agencyId: a.agencyId, at: Date.now(), actor: a.actor, action: `crm.${a.op}`, result: "unknown", resource: a.resource.slice(0, 300),
    });
  },
});

/** Closes an audit row after the request: ok or denied, and the HTTP status only. */
export const _auditEnd = internalMutation({
  args: { id: v.id("outreachEvents"), ok: v.boolean(), status: v.number() },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.id, { result: a.ok ? "ok" : "denied", detail: String(a.status) });
  },
});

/** A write refused by a switch or a missing confirm: denied, with the refusal code. */
export const _auditDenied = internalMutation({
  args: { ...auditArgs, code: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("outreachEvents", {
      agencyId: a.agencyId, at: Date.now(), actor: a.actor, action: `crm.${a.op}`, result: "denied", resource: a.resource.slice(0, 300), detail: redact(a.code),
    });
  },
});

const DELIVERY = /^[A-Za-z0-9_.:-]{1,128}$/;

/** One pulse per webhook delivery, de-duplicated on the SHA-256 of the signed body. Ids only. */
export const _pulse = internalMutation({
  args: {
    event: v.string(),
    deliveryId: v.string(),
    deliveryHeader: v.optional(v.string()),
    leadId: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    callId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<"stored" | "duplicate" | "no_agency" | "invalid"> => {
    if (!CRM_EVENTS.has(a.event) || !/^[0-9a-f]{64}$/.test(a.deliveryId)) return "invalid";
    if (a.deliveryHeader !== undefined && !DELIVERY.test(a.deliveryHeader)) return "invalid";
    for (const id of [a.leadId, a.bookingId, a.messageId, a.callId]) if (id !== undefined && !ID.test(id)) return "invalid";
    const kind = signalKind(a.event);
    if (!kind) return "invalid";
    // F-B3: the pinned agency only.
    const agencyId = pinnedAgencyId();
    if (!agencyId) return "no_agency";
    const seen = await ctx.db.query("crmPulses").withIndex("by_delivery", (q) => q.eq("deliveryId", a.deliveryId)).first();
    if (seen) return "duplicate";
    await ctx.db.insert("crmPulses", {
      agencyId,
      event: a.event,
      kind,
      deliveryId: a.deliveryId,
      deliveryHeader: a.deliveryHeader,
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
