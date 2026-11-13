import { query } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { orgHasFeature } from "./lib/entitlements";
import { displayStatus, isSheetExecuted, legacyHandTick, signedByPerson } from "./lib/splitSigning";

/* ============================================================
   Rights-ready export.

   Pulse already captures more rights data than most studio tools
   (master/publishing splits, PRO, IPI, signatures, ISRC/ISWC). This
   turns that into a release-ready handoff: a clean metadata packet
   plus a contributor/splits CSV a studio can hand to a distributor
   or PRO, with a validation pass that says exactly what is missing
   before the song can ship.

   The packet builder is pure (data in / data out) so the
   release-ready logic is unit tested without a database.
   ============================================================ */

export type PacketContributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
  pro?: string;
  ipi?: string;
  /** Signed by the person, through their link. */
  signed: boolean;
  /** The studio recorded this person's signature outside Pulse (paper). */
  markedByStudio?: boolean;
};

export type RightsPacketInput = {
  title: string;
  primaryArtist: string;
  isrc?: string;
  iswc?: string;
  releaseDate?: number;
  genre?: string;
  bpm?: number;
  musicalKey?: string;
  kind: string;
  sheetStatus?: "draft" | "sent" | "fully_executed" | "marked_by_studio";
  contributors: PacketContributor[];
};

export type RightsPacket = ReturnType<typeof buildRightsPacket>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build the release-ready metadata packet + validation from raw song + split data. */
export function buildRightsPacket(input: RightsPacketInput) {
  const masterTotal = round2(input.contributors.reduce((s, c) => s + (c.masterPct || 0), 0));
  const publishingTotal = round2(input.contributors.reduce((s, c) => s + (c.publishingPct || 0), 0));
  const mastersBalanced = masterTotal === 100;
  const publishingBalanced = publishingTotal === 100;
  const allSigned = input.contributors.length > 0 && input.contributors.every((c) => c.signed);
  const hasIsrc = Boolean(input.isrc && input.isrc.trim());
  const hasIswc = Boolean(input.iswc && input.iswc.trim());
  const sheetExecuted = isSheetExecuted(input.sheetStatus);
  // Paper signatures the owner recorded count for release, but are never
  // reported as signed in Pulse.
  const signaturesCovered =
    allSigned ||
    (input.contributors.length > 0 &&
      (input.sheetStatus === "marked_by_studio" || input.contributors.every((c) => c.signed || c.markedByStudio)));

  const warnings: string[] = [];
  if (input.contributors.length === 0) warnings.push("No split sheet contributors on file.");
  if (!mastersBalanced) warnings.push(`Master split totals ${masterTotal}% (must be 100%).`);
  if (!publishingBalanced) warnings.push(`Publishing split totals ${publishingTotal}% (must be 100%).`);
  if (!allSigned && signaturesCovered) {
    warnings.push("Some signatures were collected outside Pulse and marked by the studio; Pulse holds no signature record for them.");
  } else if (!allSigned) {
    warnings.push("Not every contributor has signed the split sheet.");
  }
  if (!sheetExecuted) warnings.push("Split sheet is not executed.");
  if (!hasIsrc) warnings.push("No ISRC assigned (needed for distribution).");
  if (!hasIswc) warnings.push("No ISWC assigned (needed for PRO registration).");

  const releaseReady =
    mastersBalanced && publishingBalanced && signaturesCovered && hasIsrc && hasIswc && sheetExecuted;

  return {
    song: {
      title: input.title,
      primaryArtist: input.primaryArtist,
      kind: input.kind,
      isrc: input.isrc ?? null,
      iswc: input.iswc ?? null,
      releaseDate: input.releaseDate ?? null,
      genre: input.genre ?? null,
      bpm: input.bpm ?? null,
      musicalKey: input.musicalKey ?? null,
    },
    contributors: input.contributors,
    validation: {
      masterTotal,
      publishingTotal,
      mastersBalanced,
      publishingBalanced,
      allSigned,
      hasIsrc,
      hasIswc,
      sheetExecuted,
      releaseReady,
    },
    warnings,
  };
}

/** Pure: contributors -> a distributor/PRO-friendly CSV string. */
export function contributorsCsv(contributors: PacketContributor[]): string {
  const header = ["Name", "Role", "Master %", "Publishing %", "PRO", "IPI", "Signed"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(",")];
  for (const c of contributors) {
    lines.push(
      [
        esc(c.name),
        esc(c.role),
        String(c.masterPct),
        String(c.publishingPct),
        esc(c.pro ?? ""),
        esc(c.ipi ?? ""),
        c.signed ? "yes" : c.markedByStudio ? "marked by studio" : "no",
      ].join(","),
    );
  }
  return lines.join("\n");
}

/** Studio-facing: the rights packet for one song, plus a download-ready CSV. */
export const packet = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    // Gated on split sheets, not Songs: Core prints its sheets too.
    await requireCapability(ctx, "songs.read", { orgId, entitlement: "splitSheets" });
    // "Print who owns what" is sold with the split sheets (every plan). A read, so
    // it degrades to null (the dialog's "nothing to export" state) rather
    // than throwing into a page.
    if (!(await orgHasFeature(ctx, orgId, "splitSheets"))) return null;
    const song = await ctx.db.get(songId);
    if (!song || song.orgId !== orgId) return null;
    const artist = await ctx.db.get(song.artistId);
    const sheet = await ctx.db
      .query("splitSheets")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .first();

    const contributors: PacketContributor[] = (sheet?.contributors ?? []).map((c) => ({
      name: c.name,
      role: c.role,
      masterPct: c.masterPct,
      publishingPct: c.publishingPct,
      pro: c.pro,
      ipi: c.ipi,
      signed: signedByPerson(c),
      markedByStudio: !signedByPerson(c) && (legacyHandTick(c) || sheet?.status === "marked_by_studio"),
    }));

    const packet = buildRightsPacket({
      title: song.title,
      primaryArtist: artist?.name ?? "Unknown",
      isrc: song.isrc,
      iswc: song.iswc,
      releaseDate: song.releaseDate,
      genre: song.genre,
      bpm: song.bpm,
      musicalKey: song.musicalKey,
      kind: song.kind,
      sheetStatus: sheet ? displayStatus(sheet) : undefined,
      contributors,
    });

    return { ...packet, csv: contributorsCsv(contributors) };
  },
});
