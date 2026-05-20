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

type ParsedEvent = {
  uid: string;
  title: string;
  startTime: number;
  endTime: number;
  allDay: boolean;
  location?: string;
  description?: string;
};

async function fetchIcal(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Pulse/1.0 (https://pulse-dash-kit.netlify.app)" },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed with HTTP ${res.status}`);
  }
  return await res.text();
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
    const cal = await ctx.runQuery(api.externalCalendars.getInternal, { id });
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
    const all = (await ctx.runQuery(api.externalCalendars.listActiveInternal, {})) as Array<{
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
