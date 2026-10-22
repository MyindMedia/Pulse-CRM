import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const SOURCE_LABEL: Record<string, string> = {
  genius: "Genius",
  musicbrainz: "MusicBrainz",
  deezer: "Deezer",
  apple: "Apple Music",
};

/** A Member's APPROVED imported credits as booking-page lines, labelled with
 *  their role and source ("Travis Scott - SICKO MODE (Producer, via Genius)").
 *  Unapproved credits never leave the Studio (Credit Approval). */
export async function approvedCreditLabels(
  ctx: QueryCtx,
  orgId: string,
  memberId: Id<"members">,
  limit = 6,
): Promise<string[]> {
  const rows = await ctx.db
    .query("importedCredits")
    .withIndex("by_org_member_approved", (q) => q.eq("orgId", orgId).eq("memberId", memberId).eq("approved", true))
    .take(limit * 3);
  // One line per song: roles on the same song join.
  const bySong = new Map<string, { songId: Id<"songs">; roles: string[]; source: string }>();
  for (const r of rows) {
    const hit = bySong.get(r.songId);
    if (hit) {
      if (!hit.roles.includes(r.role)) hit.roles.push(r.role);
    } else if (bySong.size < limit) {
      bySong.set(r.songId, { songId: r.songId, roles: [r.role], source: r.source });
    }
  }
  const out: string[] = [];
  for (const c of bySong.values()) {
    const song = await ctx.db.get(c.songId);
    if (!song || song.orgId !== orgId) continue;
    const artist = await ctx.db.get(song.artistId);
    const head = artist ? `${artist.name} - ${song.title}` : song.title;
    out.push(`${head} (${c.roles.join(", ")}, via ${SOURCE_LABEL[c.source] ?? c.source})`);
  }
  return out;
}

/** Hand-typed Notable Credits first, then approved imported ones. */
export async function publicCredits(
  ctx: QueryCtx,
  member: { _id: Id<"members">; orgId: string; credits?: string[] },
): Promise<string[]> {
  const typed = member.credits ?? [];
  if (typed.length >= 6) return typed;
  return [...typed, ...(await approvedCreditLabels(ctx, member.orgId, member._id, 6 - typed.length))];
}
