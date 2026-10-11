"use node";
/* ============================================================
   External calendar sync - Node.js runtime actions.
   Split out from externalCalendars.ts because node-ical needs
   Node's native deps and Convex's default V8 runtime can't run it.
   ============================================================ */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ical = require("node-ical") as typeof import("node-ical");
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { fetchFeed, lookupRefusal, type IcalHop } from "./lib/icalGuard";

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

function parseIcal(raw: string): ParsedEvent[] {
  const parsed = ical.parseICS(raw);
  const out: ParsedEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== "VEVENT") continue;
    const uid = String(ev.uid ?? key);
    const start = ev.start instanceof Date ? ev.start.getTime() : undefined;
    const end = ev.end instanceof Date ? ev.end.getTime() : undefined;
    if (start === undefined || end === undefined) continue;
    const allDay = (ev as { datetype?: string }).datetype === "date";
    out.push({
      uid,
      title: String(ev.summary ?? "(untitled)"),
      startTime: start,
      endTime: end,
      allDay,
      location: ev.location ? String(ev.location) : undefined,
      description: ev.description ? String(ev.description).slice(0, 1000) : undefined,
    });
  }
  return out;
}

/** Fetch + parse + upsert one feed. Idempotent. */
export const sync = action({
  args: { id: v.id("externalCalendars") },
  handler: async (ctx, { id }) => {
    const cal = await ctx.runQuery(internal.externalCalendars.getForCaller, { id });
    if (!cal) throw new Error("Calendar not found.");
    if (!cal.active) return { ok: false, reason: "inactive" } as const;
    try {
      const raw = await fetchIcal(cal.icalUrl);
      const events = parseIcal(raw);
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
  },
});

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
