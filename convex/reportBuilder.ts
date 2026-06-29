/* ============================================================
   Report Builder - the org-scoped data layer behind the custom
   report generator on the Reports page.

   The shape of a report (sources, dimensions, metrics) lives in the
   PURE engine (lib/reportEngine.ts), imported by both this query and
   the builder UI. This file only does the org-scoped IO: it reads the
   caller's own records for the chosen source, normalizes each into a
   { ts, dims, nums } record, and hands them to the pure aggregator.

   Read-only and capability-gated by `insights.read` (owner / manager /
   accountant) exactly like the rest of the Revenue Command Center.
   ============================================================ */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";
import {
  buildReport,
  findSource,
  SOURCES,
  type NormRecord,
  type ReportSpec,
} from "./lib/reportEngine";

const HOUR = 3_600_000;

/** Humanize an enum/snake value for a group label: "no_show" -> "No Show". */
function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "Jun 2026" - chronological-ish month label for grouping by month. */
function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function weekdayLabel(ts: number): string {
  return WEEKDAYS[new Date(ts).getDay()];
}
function hoursBetween(start: number, end: number): number {
  return Math.max(0, end - start) / HOUR;
}

/* ----------------------------------------------------------------
   Per-source gather: read the org's records, normalize to NormRecord[].
   ---------------------------------------------------------------- */
async function gather(ctx: QueryCtx, orgId: string, sourceKey: string): Promise<NormRecord[]> {
  switch (sourceKey) {
    case "sessions": {
      const [sessions, artists, rooms, members] = await Promise.all([
        ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ]);
      const artistName = new Map(artists.map((a) => [a._id, a.name]));
      const roomName = new Map(rooms.map((r) => [r._id, r.name]));
      const memberName = new Map(members.map((m) => [m._id, m.name]));
      const now = Date.now();

      return sessions.map((s) => {
        const live = s.status !== "cancelled" && s.status !== "no_show";
        const paid = s.amountPaidCents ?? 0;
        const owedNow = live && s.startTime <= now ? Math.max(0, s.rateCents - paid) : 0;
        return {
          ts: s.startTime,
          dims: {
            room: s.roomId ? roomName.get(s.roomId) ?? "Unknown room" : "Unassigned",
            engineer: s.engineerId ? memberName.get(s.engineerId) ?? "Unknown" : "Unassigned",
            client: artistName.get(s.artistId) ?? "Unknown",
            service: titleCase(s.serviceType),
            status: titleCase(s.status),
            month: monthLabel(s.startTime),
            weekday: weekdayLabel(s.startTime),
            comped: s.comped ? "Comped" : "Charged",
          },
          nums: {
            hours: live ? hoursBetween(s.startTime, s.endTime) : 0,
            revenue: live ? s.rateCents : 0,
            collected: paid,
            outstanding: owedNow,
            comped: s.comped ? s.compedValueCents ?? 0 : 0,
          },
        };
      });
    }

    case "payments": {
      const payments = await ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      // Only cleared money counts as "money in".
      return payments
        .filter((p) => p.status === "paid")
        .map((p) => {
          const ts = p.paidAt ?? p._creationTime;
          return {
            ts,
            dims: {
              kind: titleCase(p.kind),
              provider: titleCase(p.provider),
              month: monthLabel(ts),
              weekday: weekdayLabel(ts),
            },
            nums: { amount: p.amountCents },
          };
        });
    }

    case "invoices": {
      const [invoices, artists] = await Promise.all([
        ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ]);
      const artistName = new Map(artists.map((a) => [a._id, a.name]));
      return invoices
        .filter((i) => i.status !== "void")
        .map((i) => {
          const open = i.status !== "paid";
          return {
            ts: i._creationTime,
            dims: {
              status: titleCase(i.status),
              client: artistName.get(i.artistId) ?? "Unknown",
              month: monthLabel(i._creationTime),
            },
            nums: {
              amount: i.amountCents,
              collected: i.status === "paid" ? i.amountCents : 0,
              outstanding: open ? i.amountCents : 0,
            },
          };
        });
    }

    case "shifts": {
      const [shifts, members, rooms] = await Promise.all([
        ctx.db.query("shifts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ]);
      const memberName = new Map(members.map((m) => [m._id, m.name]));
      const memberRole = new Map(members.map((m) => [m._id, m.role]));
      const roomName = new Map(rooms.map((r) => [r._id, r.name]));
      return shifts.map((sh) => ({
        ts: sh.startTime,
        dims: {
          member: memberName.get(sh.memberId) ?? "Unknown",
          role: titleCase(memberRole.get(sh.memberId) ?? "—"),
          room: sh.roomId ? roomName.get(sh.roomId) ?? "Unknown room" : "Unassigned",
          status: titleCase(sh.status),
          month: monthLabel(sh.startTime),
          weekday: weekdayLabel(sh.startTime),
        },
        nums: {
          hours: sh.status === "cancelled" ? 0 : hoursBetween(sh.startTime, sh.endTime),
        },
      }));
    }

    default:
      throw new Error(`Unknown report source "${sourceKey}"`);
  }
}

/* ----------------------------------------------------------------
   Public query: catalog + generate.
   ---------------------------------------------------------------- */

/** The catalog of sources / dimensions / metrics, for the builder UI.
 *  (Also importable directly from lib/reportEngine, but exposed here so the
 *  page can stay decoupled from the convex/ lib path if it prefers.) */
export const catalog = query({
  args: {},
  handler: async (ctx) => {
    // Gate on the same capability so the builder only renders for allowed roles.
    await currentOrgWithCapability(ctx, "insights.read");
    return SOURCES;
  },
});

/** Generate a custom report: gather the source's org-scoped records and run
 *  the pure aggregator over the requested dimension + metrics + window. */
export const generate = query({
  args: {
    source: v.string(),
    from: v.optional(v.union(v.number(), v.null())),
    to: v.optional(v.union(v.number(), v.null())),
    groupBy: v.string(),
    metrics: v.array(v.string()),
    sortBy: v.optional(v.union(v.string(), v.null())),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    limit: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const source = findSource(args.source);
    if (!source) throw new Error(`Unknown report source "${args.source}"`);

    const records = await gather(ctx, orgId, source.key);
    const spec: ReportSpec = {
      source: args.source,
      from: args.from ?? null,
      to: args.to ?? null,
      groupBy: args.groupBy,
      metrics: args.metrics,
      sortBy: args.sortBy ?? null,
      sortDir: args.sortDir ?? "desc",
      limit: args.limit ?? null,
    };
    return {
      ...buildReport(records, spec, source),
      generatedAt: Date.now(),
      sourceLabel: source.label,
    };
  },
});
