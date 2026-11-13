import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { currentOrgWithCapability, DEMO_ORG } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { memberPay, hoursBetween, payableEntries, needsClockOut } from "./lib/payroll";
import { orgTz, whenLabel } from "./lib/tz";

/* ============================================================
   Payroll - the admin side of the time clock. Per-staff hours +
   pay over a period (hours x rate, or prorated salary), manual
   corrections, and a one-click "post to expenses" that drops the
   period's labor cost into the P&L. Reads are insights.read; the pay
   schedule is schedule.manage; timesheet corrections and posting change
   what someone is paid, so both are invoices.send, and nobody corrects
   their own hours.
   ============================================================ */

/* Pay-period schedule preference. A studio is paid either monthly (calendar
   months) or biweekly (14-day windows aligned to an anchor date). The stored
   preference is just the choice + anchor; the client computes the concrete
   window boundaries in the viewer's timezone (src/lib/pay-period.ts). */

export const getSchedule = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return {
      schedule: org?.payrollSchedule ?? ("monthly" as const),
      anchorDate: org?.payrollAnchorDate ?? null,
    };
  },
});

export const setSchedule = mutation({
  args: {
    schedule: v.union(v.literal("monthly"), v.literal("biweekly")),
    // First day of a biweekly period, YYYY-MM-DD. Kept when omitted.
    anchorDate: v.optional(v.string()),
  },
  handler: async (ctx, { schedule, anchorDate }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    if (anchorDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      throw new Error("Anchor date must be YYYY-MM-DD.");
    }
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("This studio's workspace isn't set up yet.");
    await ctx.db.patch(org._id, {
      payrollSchedule: schedule,
      ...(anchorDate !== undefined ? { payrollAnchorDate: anchorDate } : {}),
    });
  },
});

/** Per-staff hours + pay for a window, plus totals. Voided entries count for
 *  nothing; an entry left open more than 12 hours is a forgotten clock-out,
 *  left out of pay and counted in `needsClockOutCount` until a manager fixes it. */
export const summary = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    const viewer = await requireCapability(ctx, "insights.read");
    const orgId = viewer.orgId ?? DEMO_ORG;
    const selfId = viewer.kind === "studio_member" ? (viewer.memberId as unknown as string) : null;
    const now = Date.now();
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_in", (q) => q.eq("orgId", orgId).gte("clockInAt", start).lt("clockInAt", end))
      .collect();

    const byMember = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.voidedAt) continue;
      const a = byMember.get(e.memberId) ?? [];
      a.push(e);
      byMember.set(e.memberId, a);
    }

    const rows = members
      .map((m) => {
        const es = byMember.get(m._id) ?? [];
        const { payable, needsClockOut } = payableEntries(es, now);
        const { hours, payCents } = memberPay(
          payable.map((e) => ({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, rateCentsSnapshot: e.rateCentsSnapshot })),
          { payType: m.payType, payRateCents: m.payRateCents },
          now,
          end - start,
        );
        return {
          memberId: m._id,
          name: m.name,
          role: m.role,
          // Nobody corrects their own hours; the page leaves them out of the editor.
          isYou: m._id === selfId,
          payType: m.payType ?? null,
          payRateCents: m.payRateCents ?? null,
          hours,
          payCents,
          entryCount: es.length,
          openCount: payable.filter((e) => !e.clockOutAt).length,
          needsClockOutCount: needsClockOut.length,
        };
      })
      .filter((r) => r.entryCount > 0 || r.payType)
      .sort((a, b) => b.payCents - a.payCents);

    return {
      rows,
      totalPayCents: rows.reduce((s, r) => s + r.payCents, 0),
      totalHours: rows.reduce((s, r) => s + r.hours, 0),
      needsClockOutCount: rows.reduce((s, r) => s + r.needsClockOutCount, 0),
    };
  },
});

/** Raw time entries in a window (newest first), hydrated with member name +
 *  computed hours, for the admin timesheet / corrections view. Voided entries
 *  are included, marked, with 0 hours, so the record of a removal stays visible. */
export const listEntries = query({
  args: { start: v.number(), end: v.number(), memberId: v.optional(v.id("members")) },
  handler: async (ctx, { start, end, memberId }) => {
    const viewer = await requireCapability(ctx, "insights.read");
    const orgId = viewer.orgId ?? DEMO_ORG;
    const selfId = viewer.kind === "studio_member" ? (viewer.memberId as unknown as string) : null;
    const now = Date.now();
    let rows = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_in", (q) => q.eq("orgId", orgId).gte("clockInAt", start).lt("clockInAt", end))
      .collect();
    if (memberId) rows = rows.filter((r) => r.memberId === memberId);
    rows.sort((a, b) => b.clockInAt - a.clockInAt);
    const names = new Map<string, string>();
    const out = [];
    for (const r of rows) {
      if (!names.has(r.memberId)) names.set(r.memberId, (await ctx.db.get(r.memberId))?.name ?? "Unknown");
      out.push({
        ...r,
        memberName: names.get(r.memberId)!,
        voided: Boolean(r.voidedAt),
        mine: r.memberId === selfId,
        needsClockOut: needsClockOut(r, now),
        hours: r.voidedAt ? 0 : hoursBetween(r.clockInAt, r.clockOutAt ?? now),
      });
    }
    return out;
  },
});

/** Timesheet corrections change wages: the same permission as posting
 *  payroll (a manager the owner has kept away from money does not hold it),
 *  and never on your own hours, whatever your role. */
async function payrollEditor(ctx: MutationCtx): Promise<{ orgId: string; selfId: string | null }> {
  const viewer = await requireCapability(ctx, "invoices.send");
  return {
    orgId: viewer.orgId ?? DEMO_ORG,
    selfId: viewer.kind === "studio_member" ? (viewer.memberId as unknown as string) : null,
  };
}

function refuseOwnHours(selfId: string | null, memberId: string) {
  if (selfId !== null && selfId === memberId) {
    throw new Error("You can't change your own hours. Ask the owner or another manager.");
  }
}

/** Who made a timesheet change, for the log. */
async function actorName(ctx: MutationCtx): Promise<{ name: string; subject: string | null }> {
  const identity = await ctx.auth.getUserIdentity();
  return { name: identity?.name ?? identity?.email ?? "A manager", subject: identity?.subject ?? null };
}

async function studioTz(ctx: MutationCtx, orgId: string): Promise<string> {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  return orgTz(org);
}

const at = (ts: number | undefined, tz: string) => (ts === undefined ? "no clock-out" : whenLabel(ts, tz));

/** A clock-out can be now or earlier, never later: nobody is paid for time not yet worked. */
const FUTURE_SLACK_MS = 5 * 60_000;
const NOTE_MAX = 500;

/** The same hours are never paid twice: an added or moved entry may not share
 *  any time with another of the teammate's entries (a running clock counts up
 *  to now). Removed entries count for nothing and are ignored. Reads only this
 *  teammate's entries. */
async function refuseOverlap(
  ctx: MutationCtx,
  orgId: string,
  memberId: Id<"members">,
  inAt: number,
  outAt: number | undefined,
  exceptId?: Id<"timeEntries">,
  tz?: string,
) {
  const now = Date.now();
  const end = outAt ?? Math.max(now, inAt + 1);
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", memberId))
    .collect();
  for (const r of rows) {
    if (r._id === exceptId || r.voidedAt) continue;
    const rEnd = r.clockOutAt ?? Math.max(now, r.clockInAt + 1);
    if (r.clockInAt < end && rEnd > inAt) {
      const span = tz ? ` (${at(r.clockInAt, tz)} to ${at(r.clockOutAt, tz)})` : "";
      throw new Error(`Those times overlap another entry for this teammate${span}. Fix that entry instead.`);
    }
  }
}

/** Manually add a completed entry (e.g. someone forgot to clock in). */
export const addManualEntry = mutation({
  args: {
    memberId: v.id("members"),
    clockInAt: v.number(),
    clockOutAt: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { memberId, clockInAt, clockOutAt, note }) => {
    const { orgId, selfId } = await payrollEditor(ctx);
    const member = await ctx.db.get(memberId);
    if (!member || member.orgId !== orgId) throw new Error("That team member isn't in this studio.");
    refuseOwnHours(selfId, memberId);
    if (clockOutAt <= clockInAt) throw new Error("Clock-out must be after clock-in.");
    if (clockOutAt > Date.now() + FUTURE_SLACK_MS) throw new Error("Clock-out can't be in the future.");
    if (note !== undefined && note.length > NOTE_MAX) throw new Error("Keep the note under 500 characters.");
    const tz = await studioTz(ctx, orgId);
    await refuseOverlap(ctx, orgId, memberId, clockInAt, clockOutAt, undefined, tz);
    const who = await actorName(ctx);
    const id = await ctx.db.insert("timeEntries", {
      orgId,
      memberId,
      clockInAt,
      clockOutAt,
      status: "completed",
      rateCentsSnapshot: member.payType === "hourly" ? member.payRateCents : undefined,
      source: "manual",
      note,
      editedBy: who.subject ?? undefined,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "timesheet.added",
      summary: `${who.name} added a time entry for ${member.name}: ${at(clockInAt, tz)} to ${at(clockOutAt, tz)}`,
      actorName: who.name,
      entityType: "timeEntry",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

/** Correct an entry's in/out times or note (admin). Logged with before and after. */
export const adjustEntry = mutation({
  args: {
    entryId: v.id("timeEntries"),
    clockInAt: v.optional(v.number()),
    clockOutAt: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { entryId, clockInAt, clockOutAt, note }) => {
    const { orgId, selfId } = await payrollEditor(ctx);
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.orgId !== orgId) throw new Error("Time entry not found.");
    refuseOwnHours(selfId, entry.memberId);
    if (entry.voidedAt) throw new Error("This entry was removed. Add a new one instead.");
    if (note !== undefined && note.length > NOTE_MAX) throw new Error("Keep the note under 500 characters.");
    const fields: Record<string, unknown> = {};
    if (clockInAt !== undefined) fields.clockInAt = clockInAt;
    if (clockOutAt !== undefined) {
      fields.clockOutAt = clockOutAt === null ? undefined : clockOutAt;
      fields.status = clockOutAt === null ? "active" : "completed";
    }
    if (note !== undefined) fields.note = note;
    const inAt = (fields.clockInAt as number) ?? entry.clockInAt;
    const outAt = clockOutAt === undefined ? entry.clockOutAt : clockOutAt ?? undefined;
    if (outAt !== undefined && outAt <= inAt) throw new Error("Clock-out must be after clock-in.");
    if (outAt !== undefined && outAt > Date.now() + FUTURE_SLACK_MS) throw new Error("Clock-out can't be in the future.");
    if (clockOutAt === null && entry.status !== "active") {
      // Re-opening must not leave the teammate with two running clocks.
      const running = await ctx.db
        .query("timeEntries")
        .withIndex("by_member_status", (q) => q.eq("memberId", entry.memberId).eq("status", "active"))
        .first();
      if (running && running._id !== entryId) throw new Error("This teammate already has an open clock.");
    }
    if (inAt !== entry.clockInAt || outAt !== entry.clockOutAt) {
      await refuseOverlap(ctx, orgId, entry.memberId, inAt, outAt, entryId, await studioTz(ctx, orgId));
    }
    const who = await actorName(ctx);
    fields.editedBy = who.subject ?? undefined;
    await ctx.db.patch(entryId, fields);

    const tz = await studioTz(ctx, orgId);
    const changes: string[] = [];
    if (inAt !== entry.clockInAt) changes.push(`in ${at(entry.clockInAt, tz)} -> ${at(inAt, tz)}`);
    if (outAt !== entry.clockOutAt) changes.push(`out ${at(entry.clockOutAt, tz)} -> ${at(outAt, tz)}`);
    if (note !== undefined && note !== (entry.note ?? "")) changes.push("note changed");
    if (changes.length > 0) {
      const member = await ctx.db.get(entry.memberId);
      await ctx.db.insert("activity", {
        orgId,
        kind: "timesheet.adjusted",
        summary: `${who.name} changed ${member?.name ?? "a teammate"}'s time entry: ${changes.join("; ")}`,
        actorName: who.name,
        entityType: "timeEntry",
        entityId: entryId,
        accent: "info",
      });
    }
  },
});

/** Remove an entry from pay. It is voided, not deleted, so the record of what
 *  was punched, and who removed it and why, is never lost. A second call on
 *  the same entry does nothing. */
export const removeEntry = mutation({
  args: { entryId: v.id("timeEntries"), reason: v.optional(v.string()) },
  handler: async (ctx, { entryId, reason }) => {
    const { orgId, selfId } = await payrollEditor(ctx);
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.orgId !== orgId) throw new Error("Time entry not found.");
    refuseOwnHours(selfId, entry.memberId);
    if (entry.voidedAt) return;
    const who = await actorName(ctx);
    const why = reason?.trim().slice(0, 300) || undefined;
    await ctx.db.patch(entryId, {
      voidedAt: Date.now(),
      voidedBy: who.subject ?? who.name,
      voidReason: why,
      // A voided clock is no longer running: it must not block the next
      // clock-in or be swept by the overtime and intern checks.
      status: "completed",
      // A running clock is closed at its own start, so any client that does
      // not know about voidedAt (an older phone build) counts it as 0 hours.
      ...(entry.clockOutAt === undefined ? { clockOutAt: entry.clockInAt } : {}),
      editedBy: who.subject ?? undefined,
    });
    const tz = await studioTz(ctx, orgId);
    const member = await ctx.db.get(entry.memberId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "timesheet.voided",
      summary: `${who.name} removed ${member?.name ?? "a teammate"}'s time entry ${at(entry.clockInAt, tz)} to ${at(entry.clockOutAt, tz)}${why ? ` (${why})` : ""}`,
      actorName: who.name,
      entityType: "timeEntry",
      entityId: entryId,
      accent: "critical",
    });
  },
});

/** The period key a payroll expense is filed under. */
export function payrollPeriodKey(start: number, end: number): string {
  return `${new Date(start).toISOString().slice(0, 10)}_${new Date(end).toISOString().slice(0, 10)}`;
}

/** The [start, end) a key names, at UTC day precision. */
function keyRange(key: string): { start: number; end: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m) return null;
  const start = Date.parse(`${m[1]}T00:00:00Z`);
  const end = Date.parse(`${m[2]}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/** The key a payroll expense was filed under: the field, or for rows posted
 *  before it existed, the "[payroll ...]" tag in its notes. */
function keyOf(x: { payrollPeriod?: string; notes?: string }): string | null {
  return x.payrollPeriod ?? x.notes?.match(/^\[payroll (.+)\]$/)?.[1] ?? null;
}

type PostedForMember = { sameCents: number; overlaps: boolean };

/**
 * What is already in the ledger for each teammate against this window.
 * `sameCents` sums the posts for this exact period (first post plus any
 * corrections). `overlaps` is set when a post for a different period shares
 * any time with this one, such as "Last month" after "Last pay period".
 * Posts made by payroll store their exact window; older rows only carry the
 * key, so both sides are compared at day precision for those.
 */
async function postedForWindow(
  ctx: QueryCtx,
  orgId: string,
  start: number,
  end: number,
): Promise<Map<string, PostedForMember>> {
  const key = payrollPeriodKey(start, end);
  const keyWin = keyRange(key) ?? { start, end };
  // A payroll post is dated the last moment of its window, so any post whose
  // window reaches into this one is dated at or after `start`.
  const rows = await ctx.db
    .query("expenses")
    .withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", "payroll").gte("date", start))
    .collect();
  const out = new Map<string, PostedForMember>();
  for (const x of rows) {
    if (!x.memberId) continue;
    const k = keyOf(x);
    if (!k) continue; // a session payout, not a period post
    const cur = out.get(x.memberId) ?? { sameCents: 0, overlaps: false };
    if (k === key) {
      cur.sameCents += x.amountCents;
    } else {
      const precise = x.payrollStart !== undefined && x.payrollEnd !== undefined;
      const theirs = precise ? { start: x.payrollStart!, end: x.payrollEnd! } : keyRange(k);
      const ours = precise ? { start, end } : keyWin;
      if (theirs && theirs.start < ours.end && ours.start < theirs.end) cur.overlaps = true;
    }
    out.set(x.memberId, cur);
  }
  return out;
}

/**
 * Post a finished pay period's labor cost into the Expenses ledger (one
 * "payroll" expense per paid teammate), so it flows into the P&L.
 *
 * Each teammate's hours reach the ledger once:
 * - A period that has not ended yet is refused: hours are still being worked.
 * - Posting the same period again posts only the difference from what is
 *   already there, so hours added or fixed after the first post land as a
 *   "Payroll correction" row, and a double click adds nothing. When less is
 *   owed than was posted (an entry removed later) nothing is taken back
 *   automatically; the teammate is listed in `overPosted` for a person to fix.
 * - A teammate already posted for a different period that shares any time
 *   with this one (a month over a pay period, a year over anything) is listed
 *   in `overlapping` and not posted.
 * - A teammate with a clock still open in the period, or one that needs a
 *   clock-out time, is held back in `blocked` until it is closed.
 */
export const postToExpenses = mutation({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    if (!(end > start)) throw new Error("The pay period must end after it starts.");
    const now = Date.now();
    if (end > now) {
      throw new Error("This pay period hasn't ended yet. Post it once it's over, so every hour worked is in it.");
    }
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_in", (q) => q.eq("orgId", orgId).gte("clockInAt", start).lt("clockInAt", end))
      .collect();
    const byMember = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.voidedAt) continue;
      const a = byMember.get(e.memberId) ?? [];
      a.push(e);
      byMember.set(e.memberId, a);
    }
    const payrollPeriod = payrollPeriodKey(start, end);
    const periodTag = `[payroll ${payrollPeriod}]`;
    const prior = await postedForWindow(ctx, orgId, start, end);
    let created = 0;
    let adjusted = 0;
    let skipped = 0;
    let totalCents = 0;
    const blocked: { memberId: Id<"members">; name: string }[] = [];
    const overlapping: { memberId: Id<"members">; name: string }[] = [];
    const overPosted: { memberId: Id<"members">; name: string; overCents: number }[] = [];
    for (const m of members) {
      const all = byMember.get(m._id) ?? [];
      if (!m.payType && all.length === 0) continue;
      const { payable: es, needsClockOut: stale } = payableEntries(all, now);
      if (stale.length > 0 || es.some((e) => e.clockOutAt === undefined)) {
        if (m.payType) blocked.push({ memberId: m._id, name: m.name });
        continue;
      }
      const { payCents } = memberPay(
        es.map((e) => ({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, rateCentsSnapshot: e.rateCentsSnapshot })),
        { payType: m.payType, payRateCents: m.payRateCents },
        now,
        end - start,
      );
      const before = prior.get(m._id);
      if (before?.overlaps) {
        if (payCents > 0) overlapping.push({ memberId: m._id, name: m.name });
        continue;
      }
      const already = before?.sameCents ?? 0;
      const delta = payCents - already;
      if (delta < 0) {
        overPosted.push({ memberId: m._id, name: m.name, overCents: -delta });
        continue;
      }
      if (delta === 0) {
        if (already > 0) skipped += 1;
        continue;
      }
      await ctx.db.insert("expenses", {
        orgId,
        category: "payroll",
        vendor: m.name,
        description: already > 0 ? "Payroll correction" : "Payroll",
        amountCents: delta,
        date: end - 1,
        memberId: m._id,
        notes: periodTag,
        payrollPeriod,
        payrollStart: start,
        payrollEnd: end,
      });
      if (already > 0) adjusted += 1;
      else created += 1;
      totalCents += delta;
    }
    return { created, adjusted, skipped, totalCents, blocked, overlapping, overPosted };
  },
});
