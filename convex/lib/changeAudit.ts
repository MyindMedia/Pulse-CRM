/* What the change log records, and how.
 *
 * One trigger per audited table (convex/functions.ts) calls `auditEntry` on
 * every insert, update and delete. It records a person, not a process: a write
 * with no signed-in identity - a cron, a scheduled job, the nightly demo
 * refresh - is skipped, or the log would drown in the studio's own automation.
 * An update that changed nothing a person would recognise (a timestamp) is
 * skipped too.
 *
 * Values are kept for small scalar fields only, so a manager can read "rate
 * 7500 -> 9000" or "Studio A -> Live Room" without the log becoming a second
 * copy of every document. */
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { MIRRORED_TABLES } from "./mirroredTables";

/** Every table the phone mirrors, plus the studio's membership plans. */
export const AUDITED_TABLES = [...MIRRORED_TABLES, "membershipPlans"] as const;

/** Areas the log is filtered by, in the words a studio uses. */
export const AUDIT_AREAS: Readonly<Record<string, { label: string; tables: readonly string[] }>> = {
  patch: {
    label: "Patch",
    tables: ["patchSpaces", "deviceInstances", "ports", "connections", "patchAnnotations", "patchGroups"],
  },
  inventory: { label: "Inventory", tables: ["equipment", "softwareLicenses"] },
  checkins: { label: "Check-ins", tables: ["visitors"] },
  checklists: { label: "Checklists", tables: ["sessionChecklists", "arrivalPrep"] },
  bookings: { label: "Bookings and rooms", tables: ["sessions", "rooms", "bookableServices"] },
  clients: { label: "Clients", tables: ["artists", "clientMessages", "opportunities"] },
  team: { label: "Team and time", tables: ["members", "shifts", "timeEntries", "timeOff", "availability"] },
  money: {
    label: "Money",
    tables: ["invoices", "payments", "expenses", "payouts", "packageProducts", "packageCredits", "feeTemplates", "membershipPlans"],
  },
};

/** Rows from these tables never reach someone without money: even "updated an
 *  invoice" says there was one. */
export const MONEY_AREA_TABLES = new Set(AUDIT_AREAS.money.tables);

export function areaOf(table: string): string {
  for (const [key, area] of Object.entries(AUDIT_AREAS)) {
    if (area.tables.includes(table)) return key;
  }
  return "other";
}

/** Fields that move on their own and would fill the log with nothing. */
const QUIET_FIELDS = new Set([
  "updatedAt", "lastSeenAt", "lastActiveAt", "lastSyncedAt", "lastContactAt", "clerkImageUrl",
]);

type Change = {
  id: string;
  operation: "insert" | "update" | "delete";
  oldDoc: Record<string, unknown> | null;
  newDoc: Record<string, unknown> | null;
};

type AuditRow = {
  orgId: string;
  tableName: string;
  docId: string;
  op: "insert" | "update" | "delete";
  at: number;
  actorClerkUserId: string;
  actorMemberId?: DataModel["members"]["document"]["_id"];
  actorName: string;
  label?: string;
  fields: string[];
  before?: Record<string, string | number | boolean | null>;
  after?: Record<string, string | number | boolean | null>;
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Only small scalars, so the log stays a log. */
function small(doc: Record<string, unknown>, fields: string[]) {
  const out: Record<string, string | number | boolean | null> = {};
  for (const field of fields) {
    const value = doc[field];
    if (value === null || typeof value === "number" || typeof value === "boolean") out[field] = value;
    else if (typeof value === "string" && value.length <= 140) out[field] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function labelOf(doc: Record<string, unknown> | null): string | undefined {
  if (!doc) return undefined;
  for (const key of ["name", "title", "label", "number", "buyerName", "purpose", "supervisorName"]) {
    const value = doc[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 120);
  }
  return undefined;
}

export async function auditEntry(
  ctx: GenericMutationCtx<DataModel> & { innerDb: GenericMutationCtx<DataModel>["db"] },
  table: string,
  change: Change,
): Promise<AuditRow | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const doc = change.newDoc ?? change.oldDoc;
  const orgId = typeof doc?.orgId === "string" ? doc.orgId : undefined;
  if (!orgId) return null;

  const before = change.oldDoc ?? {};
  const after = change.newDoc ?? {};
  let fields: string[] = [];
  if (change.operation === "update") {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    fields = [...keys]
      .filter((key) => !key.startsWith("_") && key !== "orgId" && !QUIET_FIELDS.has(key))
      .filter((key) => !same(before[key], after[key]))
      .sort();
    if (fields.length === 0) return null;
  }

  const member = await ctx.innerDb
    .query("members")
    .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", identity.subject))
    .first();

  const row: AuditRow = {
    orgId,
    tableName: table,
    docId: change.id,
    op: change.operation,
    at: Date.now(),
    actorClerkUserId: identity.subject,
    actorName: member?.name ?? identity.name ?? identity.email ?? "Someone",
    fields,
  };
  if (member) row.actorMemberId = member._id;
  const label = labelOf(change.newDoc) ?? labelOf(change.oldDoc);
  if (label) row.label = label;
  if (change.operation === "update") {
    const was = small(before, fields);
    const now = small(after, fields);
    if (was) row.before = was;
    if (now) row.after = now;
  }
  return row;
}
