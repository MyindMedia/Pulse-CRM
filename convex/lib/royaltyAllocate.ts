import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { allocate, masterParts } from "./royaltyMath";

/* ============================================================
   Royalty Shares come from the song's FULLY EXECUTED split sheet,
   master % only. A matched line whose sheet is not signed yet is
   Unallocated Income and waits; when the last signature lands (or the
   owner marks the sheet executed) every waiting line for that song is
   allocated here. Shares are written once per line and never edited,
   so a later sheet revision cannot rewrite money already reported.
   ============================================================ */

export async function sheetFor(ctx: QueryCtx | MutationCtx, orgId: string, songId: Id<"songs">) {
  const sheet = await ctx.db
    .query("splitSheets")
    .withIndex("by_song", (q) => q.eq("songId", songId))
    .first();
  return sheet && sheet.orgId === orgId ? sheet : null;
}

/** Signatures a sheet is still waiting on; null when there is no sheet. */
export function waitingOn(sheet: Doc<"splitSheets"> | null): number | null {
  if (!sheet) return null;
  if (sheet.status === "fully_executed") return 0;
  return Math.max(1, sheet.contributors.filter((c) => !c.signed).length);
}

/** Allocate one matched line if its song's sheet is executed. */
export async function allocateLine(
  ctx: MutationCtx,
  line: Doc<"royaltyLines">,
  sheet?: Doc<"splitSheets"> | null,
): Promise<"allocated" | "unallocated"> {
  if (!line.songId) return "unallocated";
  const existing = await ctx.db.query("royaltyShares").withIndex("by_line", (q) => q.eq("lineId", line._id)).first();
  if (existing) {
    if (line.state !== "allocated") await ctx.db.patch(line._id, { state: "allocated" });
    return "allocated";
  }
  const s = sheet === undefined ? await sheetFor(ctx, line.orgId, line.songId) : sheet;
  const parts = s && s.status === "fully_executed" ? masterParts(s.contributors) : [];
  if (parts.length === 0) {
    if (line.state !== "unallocated") await ctx.db.patch(line._id, { state: "unallocated" });
    return "unallocated";
  }
  const amounts = allocate(line.amountCents, parts);
  for (let i = 0; i < parts.length; i++) {
    await ctx.db.insert("royaltyShares", {
      orgId: line.orgId,
      statementId: line.statementId,
      lineId: line._id,
      songId: line.songId,
      contributorKey: parts[i].key,
      name: parts[i].name,
      pct: parts[i].pct,
      currency: line.currency,
      amountCents: amounts[i],
    });
  }
  await ctx.db.patch(line._id, { state: "allocated" });
  return "allocated";
}

/** Called when a song's sheet becomes fully executed. */
export async function allocateSongLines(ctx: MutationCtx, orgId: string, songId: Id<"songs">): Promise<number> {
  const sheet = await sheetFor(ctx, orgId, songId);
  if (!sheet || sheet.status !== "fully_executed") return 0;
  const lines = await ctx.db
    .query("royaltyLines")
    .withIndex("by_org_song", (q) => q.eq("orgId", orgId).eq("songId", songId))
    .collect();
  let n = 0;
  for (const line of lines) {
    if (line.state === "unallocated" && (await allocateLine(ctx, line, sheet)) === "allocated") n++;
  }
  return n;
}
