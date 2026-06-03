import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";

const contributorV = v.object({
  name: v.string(),
  role: v.string(),
  masterPct: v.number(),
  publishingPct: v.number(),
  pro: v.optional(v.string()),
  ipi: v.optional(v.string()),
  email: v.optional(v.string()),
  signed: v.boolean(),
});

type Contributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
};

/** A compact, human-readable snapshot of the allocation, e.g.
    "Alice 50/50, Bob 50/50" (master/publishing). Captured into the activity
    feed so every change is an on-the-record account of who held what. */
function splitSnapshot(contributors: Contributor[]): string {
  const parts = contributors.map(
    (c) => `${c.name || "Unnamed"} ${c.masterPct}/${c.publishingPct}`,
  );
  const shown = parts.slice(0, 4).join(", ");
  return parts.length > 4 ? `${shown} +${parts.length - 4} more` : shown;
}

/** True when the recorded allocation differs (names/roles/percentages/ids/
    signed) - i.e. there's an actual change worth logging. */
function contributorsChanged(a: Contributor[], b: Contributor[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export const forSong = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const sheet = await ctx.db
      .query("splitSheets")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .first();
    if (!sheet || sheet.orgId !== orgId) return null;
    const masterTotal = sheet.contributors.reduce((s, c) => s + c.masterPct, 0);
    const publishingTotal = sheet.contributors.reduce((s, c) => s + c.publishingPct, 0);
    return {
      ...sheet,
      masterTotal,
      publishingTotal,
      balanced: masterTotal === 100 && publishingTotal === 100,
      allSigned: sheet.contributors.length > 0 && sheet.contributors.every((c) => c.signed),
    };
  },
});

export const upsert = mutation({
  args: {
    songId: v.id("songs"),
    contributors: v.array(contributorV),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("sent"), v.literal("fully_executed")),
    ),
  },
  handler: async (ctx, { songId, contributors, status }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(songId);
    assertOrg(song, orgId);

    const masterTotal = contributors.reduce((s, c) => s + c.masterPct, 0);
    const publishingTotal = contributors.reduce((s, c) => s + c.publishingPct, 0);
    if (masterTotal !== 100 || publishingTotal !== 100) {
      throw new Error(
        `Splits must total 100% - master is ${masterTotal}%, publishing is ${publishingTotal}%`,
      );
    }

    const existing = await ctx.db
      .query("splitSheets")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .first();
    if (existing && existing.orgId === orgId) {
      // Log the change BEFORE patching so the activity feed keeps an account of
      // each revision's allocation - the "for future records" trail.
      const changed = contributorsChanged(existing.contributors, contributors);
      await ctx.db.patch(existing._id, {
        contributors,
        status: status ?? existing.status,
        updatedAt: Date.now(),
      });
      if (changed) {
        await ctx.db.insert("activity", {
          orgId,
          kind: "split.updated",
          summary: `Split sheet updated for "${song.title}" - ${splitSnapshot(contributors)}`,
          entityType: "song",
          entityId: songId,
          accent: "gold",
        });
      }
      return existing._id;
    }
    const id = await ctx.db.insert("splitSheets", {
      orgId,
      songId,
      status: status ?? "draft",
      contributors,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "split.created",
      summary: `Split sheet drafted for "${song.title}" - ${splitSnapshot(contributors)}`,
      entityType: "song",
      entityId: songId,
      accent: "gold",
    });
    return id;
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("splitSheets"),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("fully_executed")),
  },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const sheet = await ctx.db.get(id);
    assertOrg(sheet, orgId);
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    if (status === "fully_executed") {
      const song = await ctx.db.get(sheet.songId);
      await ctx.db.insert("activity", {
        orgId,
        kind: "split.executed",
        summary: `Split sheet fully executed${song ? ` - "${song.title}"` : ""}`,
        entityType: "song",
        entityId: sheet.songId,
        accent: "positive",
      });
    }
  },
});
