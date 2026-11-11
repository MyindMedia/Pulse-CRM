/* What `crm.call` lets through (design D11, D12). Pure: no Convex imports.

   Every request is built from the generated registry (ops.generated.ts): the
   operation must exist, path values are checked and encoded, query and body keys
   must be fields the registry knows, and `workspace_id` never leaves Pulse. */

import { ZU_OPS, type ZuField, type ZuOp } from "./ops.generated";

/** Operations that reach real people or spend credits (D12), as (method, path)
 *  pairs. A test asserts every pair resolves in the registry, so a renamed or
 *  removed Zuops operation fails loudly instead of silently losing its confirm. */
export const REACHES_PATHS: ReadonlyArray<readonly [ZuOp["method"], string]> = [
  ["POST", "/v1/messages"],
  ["POST", "/v1/scheduled-messages/{scheduled_message_id}/send-now"],
  ["POST", "/v1/reply-suggestions/{suggestion_id}/approve"],
  ["POST", "/v1/email-campaigns/{campaign_id}/send"],
  ["POST", "/v1/email-campaigns/{campaign_id}/send-rest"],
  ["POST", "/v1/workspace-automations/{automation_id}/enroll"],
  ["POST", "/v1/workspace-automations/{automation_id}/toggle"],
  ["POST", "/v1/estimates/{estimate_id}/send"],
  ["POST", "/v1/contracts/{contract_id}/send"],
  ["POST", "/v1/proposals/{proposal_id}/send"],
  ["POST", "/v1/reports/{report_id}/send"],
  ["POST", "/v1/google-business/reports/test"],
  ["POST", "/v1/reward-games/{game_id}/send"],
  ["POST", "/v1/surveys/{form_id}/send"],
  ["POST", "/v1/google-business/posts/{post_id}/approve"],
  ["POST", "/v1/google-business/posts/{post_id}/publish"],
  ["POST", "/v1/google-business/reviews/{review_id}/reply"],
  ["POST", "/v1/support/tickets/{ticket_id}/messages"],
  ["POST", "/v1/support/tickets/{ticket_id}/reply"],
  ["POST", "/v1/messages/{message_id}/reaction"],
];

const BY_ROUTE = new Map(Object.values(ZU_OPS).map((op) => [`${op.method} ${op.path}`, op.id]));

/** The operation id of a (method, path) pair, or undefined when Zuops has no such route. */
export function opIdFor(method: string, path: string): string | undefined {
  return BY_ROUTE.get(`${method} ${path}`);
}

export const REACHES: ReadonlySet<string> = new Set(
  REACHES_PATHS.map(([m, p]) => opIdFor(m, p)).filter((id): id is string => typeof id === "string"),
);

/** Operations that change what Zuops sends automatically to real people: follow-up
 *  and AI texting, the AI receptionist, appointment emails, survey rules, auto-greet,
 *  who automated texts come from, automation building, and team invites. Same rule
 *  as REACHES_PATHS: every pair must resolve in the registry (a test checks it). */
export const CHANGES_SENDING_PATHS: ReadonlyArray<readonly [ZuOp["method"], string]> = [
  ["PUT", "/v1/nurture-sequence"],
  ["PATCH", "/v1/nurture-sequence"],
  ["PATCH", "/v1/ai-texting"],
  ["PUT", "/v1/ai-receptionist"],
  ["PUT", "/v1/appointment-emails"],
  ["PATCH", "/v1/surveys/{form_id}/rules"],
  ["POST", "/v1/workspaces/{workspace_id}/outreach"],
  ["PUT", "/v1/imessage/automated-texts"],
  ["POST", "/v1/workspace-automations"],
  ["PATCH", "/v1/workspace-automations/{automation_id}"],
  ["POST", "/v1/workspace-automations/{automation_id}/duplicate"],
  ["POST", "/v1/members"],
];

export const CHANGES_SENDING: ReadonlySet<string> = new Set(
  CHANGES_SENDING_PATHS.map(([m, p]) => opIdFor(m, p)).filter((id): id is string => typeof id === "string"),
);

export type Level = "read" | "write" | "admin";

export function level(op: ZuOp): Level {
  if (op.method === "GET") return "read";
  if (op.scope.endsWith(":admin")) return "admin";
  return "write";
}

export type ConfirmKind = "reaches" | "changes_sending" | "delete";

/** Why an operation needs a confirm, for the UI to word its dialog. Body-independent. */
export function confirmKind(op: ZuOp): ConfirmKind | null {
  if (REACHES.has(op.id)) return "reaches";
  if (CHANGES_SENDING.has(op.id)) return "changes_sending";
  if (op.method === "DELETE") return "delete";
  return null;
}

export function needsConfirm(op: ZuOp): boolean {
  return confirmKind(op) !== null;
}

const CREATE_LEAD = opIdFor("POST", "/v1/leads");

/** `create_lead` with `run_intake` works the lead like a new form lead and sends the
 *  first text. Anything other than an absent or false `run_intake` counts, so a
 *  string "true" cannot slip past the confirm. */
function startsIntake(op: ZuOp, body: unknown): boolean {
  if (op.id !== CREATE_LEAD || !body || typeof body !== "object") return false;
  const v = (body as Record<string, unknown>).run_intake;
  return v !== undefined && v !== null && v !== false;
}

export const CONFIRM_REASONS = {
  reaches: "Confirm before this runs: it reaches real people.",
  changes_sending: "Confirm before this runs: it changes what is sent automatically to real people.",
  delete: "Confirm before this runs: it deletes something.",
  starts_intake: "Confirm before this runs: it starts the new-lead texts for this person.",
} as const;

/** The confirm reason for this operation with this body, or null when none is needed. */
export function confirmReason(op: ZuOp, body?: unknown): string | null {
  const kind = confirmKind(op);
  if (kind) return CONFIRM_REASONS[kind];
  if (startsIntake(op, body)) return CONFIRM_REASONS.starts_intake;
  return null;
}

export function needsConfirmFor(op: ZuOp, body?: unknown): boolean {
  return confirmReason(op, body) !== null;
}

export type GateResult = { ok: true } | { ok: false; code: "read_only" | "needs_admin_key" | "needs_confirm"; reason: string };

export const GATE_REASONS = {
  read_only: "This deployment is read only against Zuops.",
  needs_admin_key: "Needs a Full access key.",
} as const;

export function gate(op: ZuOp, flags: { writesOn: boolean; adminKey: boolean }, confirm: boolean, body?: unknown): GateResult {
  const lv = level(op);
  if (lv === "read") return { ok: true };
  if (!flags.writesOn) return { ok: false, code: "read_only", reason: GATE_REASONS.read_only };
  if (lv === "admin" && !flags.adminKey) return { ok: false, code: "needs_admin_key", reason: GATE_REASONS.needs_admin_key };
  const why = confirmReason(op, body);
  if (why && confirm !== true) return { ok: false, code: "needs_confirm", reason: why };
  return { ok: true };
}

const PATH_VALUE = /^[A-Za-z0-9_.:@-]{1,128}$/;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function buildPath(op: ZuOp, values: Record<string, string> | undefined): { ok: true; path: string } | { ok: false; reason: string } {
  const vals = values ?? {};
  for (const k of Object.keys(vals)) {
    if (!op.pathParams.includes(k)) return { ok: false, reason: `"${k}" is not part of this address.` };
  }
  let path = op.path;
  for (const name of op.pathParams) {
    const v = own(vals, name) ? vals[name] : undefined;
    if (typeof v !== "string" || v === "") return { ok: false, reason: `Missing "${name}".` };
    if (!PATH_VALUE.test(v) || v === "." || v === "..") return { ok: false, reason: `"${name}" has characters that are not allowed.` };
    path = path.replace(`{${name}}`, encodeURIComponent(v));
  }
  return { ok: true, path };
}

export const BODY_MAX_BYTES = 64 * 1024;

const isPlainObject = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

/** Keep only fields the registry knows for this operation.
 *
 *  Missing `required` fields are NOT refused here on purpose: Zuops answers 400
 *  with a sentence that names the field and the rule (for example "subject is
 *  required for email"), which is a better reason than a generic one from Pulse,
 *  and our copy of the rules could drift from theirs. Unknown keys ARE refused,
 *  so nothing outside the documented surface is ever sent. */
export function pickFields(
  fields: ZuField[],
  input: unknown,
  kind: "query" | "body",
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (!isPlainObject(input)) return { ok: false, reason: kind === "query" ? "The filters must be a set of named values." : "The request body must be a set of named fields." };
  const known = new Set(fields.map((f) => f.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "workspace_id") continue; // the key is locked to one sub-account; never sent
    if (!known.has(k)) return { ok: false, reason: `"${k}" is not a field this Zuops function accepts.` };
    if (v === undefined) continue;
    if (kind === "query") {
      const okType = typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
      if (!okType) return { ok: false, reason: `"${k}" must be text, a number or true/false.` };
    }
    out[k] = v;
  }
  if (kind === "body") {
    let size: number;
    try {
      size = new TextEncoder().encode(JSON.stringify(out)).length;
    } catch {
      return { ok: false, reason: "The request body could not be read." };
    }
    if (size > BODY_MAX_BYTES) return { ok: false, reason: "The request is too large (over 64 KB)." };
  }
  return { ok: true, value: out };
}
