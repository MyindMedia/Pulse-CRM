import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import { claimFile } from "./lib/media";
import { meterStorageUpload } from "./usage";
import { createUpload } from "./media";

/* ============================================================
   Finished mixes: the Core slice of the file story.

   Core keeps "Finished mixes" (numbered mix and master versions per song,
   with client approval) and "Notes on one version of a mix". The Songs page
   is Growth, so Core had the server capability but no screen. These
   functions back the /mixes screen. They are gated by the "finishedMixes"
   entitlement (the default for the deliverables.* capabilities) and expose
   only mix and master deliverables plus song titles. They never read or
   write the Growth media library (convex/mediaLibrary.ts).

   Uploads follow the same R2 path as the library: presigned PUT into the
   studio's own private bucket, media.confirmUpload, then attach here, with
   the real size metered against the plan's storage allowance.
   ============================================================ */

const MAX_NOTE = 2000;
const kindV = v.union(v.literal("mix"), v.literal("master"));

async function staffOrg(ctx: Parameters<typeof resolveViewer>[0], cap: "deliverables.read" | "deliverables.upload") {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind === "guest") throw new ConvexError("Only studio staff can manage mixes.");
  return await currentOrgWithCapability(ctx, cap);
}

/** Every mix and master in the studio, grouped by song, newest version first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await staffOrg(ctx, "deliverables.read");
    const rows = await ctx.db.query("deliverables").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(500);
    const mixes = rows.filter((d) => d.kind === "mix" || d.kind === "master");
    const bySong = new Map<string, typeof mixes>();
    for (const d of mixes) bySong.set(d.songId, [...(bySong.get(d.songId) ?? []), d]);
    const out = [];
    for (const [songId, versions] of bySong) {
      const song = await ctx.db.get(versions[0].songId);
      if (!song || song.orgId !== orgId) continue;
      const withNotes = await Promise.all(
        versions
          .sort((a, b) => b.version - a.version)
          .map(async (d) => ({
            _id: d._id,
            kind: d.kind,
            version: d.version,
            label: d.label,
            status: d.status,
            approvedBy: d.approvedBy ?? null,
            approvedAt: d.approvedAt ?? null,
            fileName: d.fileName ?? null,
            fileSize: d.fileSize ?? null,
            hasFile: !!d.fileId,
            noteCount: (await ctx.db.query("mediaNotes").withIndex("by_deliverable", (x) => x.eq("deliverableId", d._id)).take(200)).length,
          })),
      );
      out.push({ songId, songTitle: song.title, versions: withNotes });
    }
    return out.sort((a, b) => a.songTitle.localeCompare(b.songTitle));
  },
});

/** Notes on one version of a mix, oldest first. */
export const notes = query({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, { deliverableId }) => {
    const orgId = await staffOrg(ctx, "deliverables.read");
    const d = await ctx.db.get(deliverableId);
    if (!d || d.orgId !== orgId) throw new ConvexError("Mix not found.");
    return await ctx.db.query("mediaNotes").withIndex("by_deliverable", (q) => q.eq("deliverableId", deliverableId)).order("asc").take(200);
  },
});

export const addNote = mutation({
  args: { deliverableId: v.id("deliverables"), body: v.string() },
  handler: async (ctx, { deliverableId, body }) => {
    const orgId = await staffOrg(ctx, "deliverables.upload");
    const d = await ctx.db.get(deliverableId);
    if (!d || d.orgId !== orgId) throw new ConvexError("Mix not found.");
    const text = body.trim();
    if (!text) throw new ConvexError("Write a note first.");
    if (text.length > MAX_NOTE) throw new ConvexError("That note is too long.");
    return await ctx.db.insert("mediaNotes", { orgId, deliverableId, body: text, author: await currentActor(ctx), createdAt: Date.now() });
  },
});

/** Song titles for the "add a mix" picker. Titles only. */
export const songChoices = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await staffOrg(ctx, "deliverables.upload");
    const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(300);
    return songs.map((s) => ({ _id: s._id, title: s.title }));
  },
});

/** Step 1 of adding a mix: a signed PUT URL into the studio's own private bucket. */
export const prepareUpload = mutation({
  args: { fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, a) => {
    const orgId = await staffOrg(ctx, "deliverables.upload");
    const viewer = await resolveViewer(ctx);
    const actor = "clerkUserId" in viewer ? String(viewer.clerkUserId) : viewer.kind;
    return await createUpload(ctx, { scope: orgId, purpose: "deliverable", fileName: a.fileName, mimeType: a.mimeType, size: a.size, actor });
  },
});

/** Last step (after media.confirmUpload): the confirmed file becomes the next
 *  numbered version of this song's mix or master. Meters the real size against the
 *  plan's storage allowance and throws LIMIT_REACHED over the cap. */
export const addVersion = mutation({
  args: { songId: v.id("songs"), kind: kindV, label: v.string(), mediaId: v.id("mediaFiles"), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const orgId = await staffOrg(ctx, "deliverables.upload");
    const song = await ctx.db.get(a.songId);
    if (!song || song.orgId !== orgId) throw new ConvexError("Song not found.");
    const m = await ctx.db.get(a.mediaId);
    if (!m || m.orgId !== orgId || m.purpose !== "deliverable") throw new ConvexError("Upload not found.");
    if (m.status !== "ready") throw new ConvexError("The upload has not finished.");
    const claimedBy = await ctx.db.query("deliverables").withIndex("by_org", (q) => q.eq("orgId", orgId)).filter((q) => q.eq(q.field("fileId"), a.mediaId)).first();
    if (claimedBy) throw new ConvexError("That upload is already a version.");
    if (a.note && a.note.length > MAX_NOTE) throw new ConvexError("That note is too long.");
    await meterStorageUpload(ctx, orgId, a.mediaId, null);
    await claimFile(ctx, a.mediaId, orgId);
    const existing = await ctx.db.query("deliverables").withIndex("by_song", (q) => q.eq("songId", a.songId)).collect();
    const version = existing.filter((d) => d.orgId === orgId).reduce((max, d) => Math.max(max, d.version), 0) + 1;
    const id = await ctx.db.insert("deliverables", {
      orgId, songId: a.songId, kind: a.kind, version, label: a.label.trim().slice(0, 120) || (a.kind === "master" ? "Master" : "Mix"),
      status: "delivered", paymentGated: false, fileId: a.mediaId, fileName: m.fileName, fileSize: m.size ?? 0, mimeType: m.mimeType,
    });
    await ctx.db.insert("activity", {
      orgId, kind: "deliverable.created", summary: `${a.label.trim() || a.kind} v${version} delivered for "${song.title}"`,
      entityType: "song", entityId: a.songId, accent: "info",
    });
    const note = a.note?.trim();
    if (note) await ctx.db.insert("mediaNotes", { orgId, deliverableId: id, body: note, author: await currentActor(ctx), createdAt: Date.now() });
    return { deliverableId: id, version };
  },
});
