import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { claimFile, retireFile, type FileRef } from "./media";
import { buildContributors, type ImportedCredit } from "./musicLink";

/* ============================================================
   Writing imported details onto a Song. One set of rules for the
   single-link importer (songImport.applyToSong) and Catalog Import
   (catalogImport._applyItem), so one song never has two behaviours:
     - imported metadata fills blanks, never overwrites studio data;
     - the source link joins the reference tracks once;
     - credits draft a split sheet only when there is none, or the
       existing one is an empty draft (a sheet with people is work).
   ============================================================ */

export type ImportFields = {
  coverStorageId?: FileRef;
  /** Single-link import replaces the cover; a catalog merge only fills a blank. */
  replaceCover?: boolean;
  genre?: string;
  releaseDate?: number;
  isrc?: string;
  iswc?: string;
  bpm?: number;
  sourceUrl?: string;
  artistName?: string;
  credits: ImportedCredit[];
};

export async function fillSongFromImport(
  ctx: MutationCtx,
  orgId: string,
  song: Doc<"songs">,
  f: ImportFields,
): Promise<{ sheetPrefilled: boolean }> {
  const takeCover = Boolean(f.coverStorageId) && (f.replaceCover || !song.coverArtId);
  // The cover must be this workspace's own upload.
  if (takeCover) await claimFile(ctx, f.coverStorageId, orgId);
  const previousCover = takeCover ? song.coverArtId : undefined;
  await ctx.db.patch(song._id, {
    ...(takeCover ? { coverArtId: f.coverStorageId } : {}),
    ...(f.genre && !song.genre ? { genre: f.genre } : {}),
    ...(f.releaseDate && !song.releaseDate ? { releaseDate: f.releaseDate } : {}),
    ...(f.isrc && !song.isrc ? { isrc: f.isrc.trim().toUpperCase().slice(0, 12) } : {}),
    ...(f.iswc && !song.iswc ? { iswc: f.iswc.trim().slice(0, 20) } : {}),
    ...(f.bpm && f.bpm > 0 && f.bpm < 400 && !song.bpm ? { bpm: Math.round(f.bpm) } : {}),
  });
  if (takeCover) await retireFile(ctx, previousCover, f.coverStorageId);
  // A cover we fetched but did not use is retired, not left orphaned.
  else if (f.coverStorageId) await retireFile(ctx, f.coverStorageId, undefined);

  if (f.sourceUrl && !song.referenceTracks.some((r) => r.url === f.sourceUrl)) {
    await ctx.db.patch(song._id, {
      referenceTracks: [...song.referenceTracks, { title: "Imported source", url: f.sourceUrl }],
    });
  }

  let sheetPrefilled = false;
  if (f.credits.length > 0) {
    const artist = await ctx.db.get(song.artistId);
    const contributors = buildContributors(f.credits, f.artistName ?? artist?.name);
    const existing = await ctx.db
      .query("splitSheets")
      .withIndex("by_song", (q) => q.eq("songId", song._id))
      .first();
    if (!existing) {
      await ctx.db.insert("splitSheets", { orgId, songId: song._id, status: "draft", contributors, updatedAt: Date.now() });
      sheetPrefilled = true;
    } else if (existing.status === "draft" && existing.contributors.length === 0) {
      await ctx.db.patch(existing._id, { contributors, updatedAt: Date.now() });
      sheetPrefilled = true;
    }
  }
  return { sheetPrefilled };
}
