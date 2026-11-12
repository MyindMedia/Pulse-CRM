"use node";
/* ============================================================
   External calendar sync - Node.js runtime actions.
   Split out from externalCalendars.ts because node-ical needs
   Node's native deps and Convex's default V8 runtime can't run it.
   ============================================================ */
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ical = require("node-ical") as typeof import("node-ical");
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { fetchFeed, lookupRefusal, type IcalHop } from "./lib/icalGuard";
import { zonedMidnight } from "./lib/tz";

type ParsedEvent = {
  uid: string;
  title: string;
  startTime: number;
  endTime: number;
  allDay: boolean;
  location?: string;
  description?: string;
};

const MAX_ICAL_BYTES = 10_000_000;

/* The socket's own DNS lookup: every answer must be public, so the address
   checked is the address connected to and a rebinding name has no window. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const refused = lookupRefusal(addresses);
    if (refused) return callback(Object.assign(new Error(refused), { code: "EPRIVATE" }), "");
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/** One GET, no redirect following (fetchFeed checks and follows each hop). */
function getOnce(url: URL): Promise<IcalHop> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { lookup: publicLookup, timeout: 15_000, headers: { "User-Agent": "Pulse/1.0 (https://pulse-dash-kit.netlify.app)" } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          resolve({ status, location: res.headers.location });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_ICAL_BYTES) req.destroy(new Error("Calendar feed is too large."));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Calendar feed timed out.")));
    req.on("error", reject);
  });
}

async function fetchIcal(url: string): Promise<string> {
  return fetchFeed(url, getOnce);
}

type IcalEvent = {
  type?: string;
  uid?: unknown;
  summary?: unknown;
  location?: unknown;
  description?: unknown;
  start?: unknown;
  end?: unknown;
  datetype?: string;
  status?: string;
  transparency?: string;
};

/** Does this event hold time? A cancelled event, or one marked Free
 *  (TRANSP:TRANSPARENT, Google's default for all-day events), never blocks. */
function holdsTime(ev: IcalEvent): boolean {
  if (String(ev.status ?? "").toUpperCase() === "CANCELLED") return false;
  if (String(ev.transparency ?? "").toUpperCase() === "TRANSPARENT") return false;
  return true;
}

/** An all-day (VALUE=DATE) value as the studio's own midnight. node-ical builds
 *  a date-only value as midnight in the process zone (UTC on Convex), so the
 *  calendar date is read back with the local getters and rebuilt in `tz`. */
function dayStartIn(d: Date, tz: string): number {
  return zonedMidnight(d.getFullYear(), d.getMonth(), d.getDate(), tz);
}

/** Pure: an .ics body -> the busy events Pulse stores. `tz` is the studio's
 *  zone, used for all-day events. */
export function parseIcal(raw: string, opts: { tz: string }): ParsedEvent[] {
  const parsed = ical.sync.parseICS(raw) as Record<string, IcalEvent | undefined>;
  const out: ParsedEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== "VEVENT" || !holdsTime(ev)) continue;
    const uid = String(ev.uid ?? key);
    if (!(ev.start instanceof Date) || !(ev.end instanceof Date)) continue;
    const allDay = ev.datetype === "date";
    const startTime = allDay ? dayStartIn(ev.start, opts.tz) : ev.start.getTime();
    const endTime = allDay ? dayStartIn(ev.end, opts.tz) : ev.end.getTime();
    if (!(endTime > startTime)) continue;
    out.push({
      uid,
      title: String(ev.summary ?? "(untitled)"),
      startTime,
      endTime,
      allDay,
      location: ev.location ? String(ev.location) : undefined,
      description: ev.description ? String(ev.description).slice(0, 1000) : undefined,
    });
  }
  return out;
}

type SyncResult =
  | { readonly ok: true; readonly count: number; readonly error?: undefined; readonly reason?: undefined }
  | { readonly ok: false; readonly error: string; readonly reason?: undefined }
  | { readonly ok: false; readonly reason: "inactive"; readonly error?: undefined };

/** Fetch + parse + upsert one feed. Idempotent. */
export const sync = action({
  args: { id: v.id("externalCalendars") },
  handler: async (ctx, { id }): Promise<SyncResult> => {
    const cal: Doc<"externalCalendars"> | null = await ctx.runQuery(internal.externalCalendars.getForCaller, { id });
    if (!cal) throw new Error("Calendar not found.");
    if (!cal.active) return { ok: false, reason: "inactive" } as const;
    return await syncFeed(ctx, cal);
  },
});

/** Feeds refreshed per cron run. Each is one guarded GET + parse. */
const REFRESH_BATCH = 25;

/** Cron: refresh the stalest active feeds across every studio, so outside
 *  calendar busy time keeps blocking bookings without anyone pressing sync. */
export const refreshDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ refreshed: number; ok: number }> => {
    const due: Doc<"externalCalendars">[] = await ctx.runQuery(internal.externalCalendars.dueForRefresh, { limit: REFRESH_BATCH });
    let ok = 0;
    for (const cal of due) {
      const r = await syncFeed(ctx, cal);
      if (r.ok) ok++;
    }
    return { refreshed: due.length, ok };
  },
});

/** Fetch, parse and store one feed; a failure is recorded on the feed. */
async function syncFeed(ctx: ActionCtx, cal: Doc<"externalCalendars">): Promise<SyncResult> {
  const id = cal._id;
  try {
    const raw = await fetchIcal(cal.icalUrl);
    const tz: string = await ctx.runQuery(internal.externalCalendars.orgTimezone, { orgId: cal.orgId });
    const events = parseIcal(raw, { tz });
    await ctx.runMutation(internal.externalCalendars.upsertEvents, {
      calendarId: id,
      events,
    });
    return { ok: true, count: events.length } as const;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await ctx.runMutation(internal.externalCalendars.recordError, {
      id,
      error: msg,
    });
    return { ok: false, error: msg } as const;
  }
}

/** Sync every active feed in the org. Useful for a scheduled refresh. */
export const syncAll = action({
  args: {},
  handler: async (ctx) => {
    const all = (await ctx.runQuery(internal.externalCalendars.listActiveInternal, {})) as Array<{
      _id: Id<"externalCalendars">;
    }>;
    const results: Array<{ id: Id<"externalCalendars">; ok: boolean }> = [];
    for (const c of all) {
      const r = await ctx.runAction(api.externalCalendarsActions.sync, { id: c._id });
      results.push({ id: c._id, ok: r.ok });
    }
    return results;
  },
});
