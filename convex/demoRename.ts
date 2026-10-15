import { internalMutation } from "./functions";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/* ============================================================
   Demo artist rename. Swaps the pitch account's placeholder artist
   names for recognizable ones, everywhere the old name was copied as
   text (session titles, messages, insights, agent output...). Rows are
   matched by orgId and only string values are rewritten, so ids and
   numbers never change. Re-running is a no-op once names are swapped.

   Run: npx convex run demoRename:renameAll '{"orgId":"..."}'
   ============================================================ */

const PAIRS: [string, string][] = [
  ["Crosstown Records", "Def Jam Recordings"],
  ["Bishop Grey", "Kendrick Lamar"],
  ["Ye West", "Kanye West"],
  ["Test booking today", "Jhené Aiko"],
  ["Aurora Sky", "SZA"],
  ["Lila Ferrari", "Rihanna"],
  ["The Midnight Tape", "The Rolling Stones"],
  ["DJ Pulsewave", "DJ Mustard"],
  ["Nova Reign", "Teyana Taylor"],
  ["Sage Monroe", "H.E.R."],
  ["Echo & the Drift", "Silk Sonic"],
  ["Tomás Vela", "Bad Bunny"],
  ["Billy Bob", "Tyler, the Creator"],
  ["Mira Quartz", "Doja Cat"],
  ["Kairo", "Anderson .Paak"],
  ["Lawrence (demo)", "Childish Gambino"],
];

// Placeholder artist emails on invented domains move to example.com so a
// demo action can never mail a real inbox. Lawrence's own test addresses stay.
const KEEP_EMAIL = /myindsound\.com|lawrenceberment@gmail\.com|berlaw@gmail\.com/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

// Tables whose text copies an artist name. Audit trails are left as recorded.
const TABLES = [
  "sessions",
  "opportunities",
  "notifications",
  "clientMessages",
  "insights",
  "agentInsights",
  "agentMemories",
  "aiArtifacts",
  "activity",
  "studioGraphNodes",
  "opsActions",
  "splitSheets",
  "deliverables",
  "revisionComments",
  "engineeringLogs",
  "payments",
  "licenses",
  "reviews",
] as const;

function swap(value: unknown): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const [from, to] of PAIRS) if (s.includes(from)) s = s.split(from).join(to);
    return s;
  }
  if (Array.isArray(value)) return value.map(swap);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(value)) out[k] = swap(x);
    return out;
  }
  return value;
}

export const renameArtists = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    let changed = 0;
    for (const a of artists) {
      const name = swap(a.name) as string;
      if (name === a.name) continue;
      const patch: Record<string, unknown> = { name };
      if (!a.email || !KEEP_EMAIL.test(a.email)) patch.email = `${slug(name)}.mgmt@example.com`;
      await ctx.db.patch(a._id, patch);
      changed++;
    }
    return { changed };
  },
});

export const renamePage = internalMutation({
  args: { orgId: v.string(), table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { orgId, table, cursor }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (ctx.db.query(table as any) as any).paginate({ cursor, numItems: 80 });
    let changed = 0;
    for (const doc of page.page as Record<string, unknown>[]) {
      if (doc.orgId !== orgId) continue;
      const patch: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(doc)) {
        if (k.startsWith("_")) continue;
        const y = swap(x);
        if (JSON.stringify(y) !== JSON.stringify(x)) patch[k] = y;
      }
      if (Object.keys(patch).length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.patch(doc._id as any, patch);
        changed++;
      }
    }
    return { cursor: page.continueCursor as string, isDone: page.isDone as boolean, changed };
  },
});

export const renameAll = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const artists = await ctx.runMutation(internal.demoRename.renameArtists, { orgId });
    const counts: Record<string, number> = { artists: artists.changed };
    for (const table of TABLES) {
      let cursor: string | null = null;
      let n = 0;
      for (;;) {
        const r: { cursor: string; isDone: boolean; changed: number } = await ctx.runMutation(
          internal.demoRename.renamePage,
          { orgId, table, cursor },
        );
        n += r.changed;
        if (r.isDone) break;
        cursor = r.cursor;
      }
      counts[table] = n;
    }
    return counts;
  },
});
