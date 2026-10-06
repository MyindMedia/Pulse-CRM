import { query, QueryCtx, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import { meterStorageUpload } from "./usage";
import { fileUrl, deleteFile } from "./lib/media";
import { createUpload, scheduleObjectDelete } from "./media";

/* ============================================================
   Files - Convex storage seam for payment-gated deliverables.
   Upload is staff-only and org-scoped. Download is gated
   server-side: a gated deliverable only yields a signed URL once
   the song's balance is fully paid (or the caller is staff).
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

/** Staff = anyone who is not a magic-link guest collaborator. */
export function isStaff(viewerKind: string): boolean {
  return viewerKind !== "guest";
}

/**
 * Pure gate decision. A signed URL is released when the deliverable is
 * not payment-gated, the caller is staff/owner, or the song's outstanding
 * balance has been fully paid. Exported so the gate is unit-testable
 * independent of viewer resolution.
 */
export function gateAllows(opts: {
  paymentGated: boolean;
  staff: boolean;
  outstandingCents: number;
}): boolean {
  if (!opts.paymentGated) return true;
  if (opts.staff) return true;
  return opts.outstandingCents <= 0;
}

/**
 * Sum of what's still owed across a song's linked sessions.
 * Mirrors the per-session outstanding math in payments.ts: a session
 * is settled when its cleared payments reach its rate.
 */
async function songOutstandingCents(ctx: Ctx, songId: Doc<"deliverables">["songId"]): Promise<number> {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_song", (q) => q.eq("songId", songId))
    .collect();
  let outstanding = 0;
  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    const paid = s.amountPaidCents ?? 0;
    outstanding += Math.max(0, s.rateCents - paid);
  }
  return outstanding;
}

/** Step 1 of an upload - a short-lived Convex storage upload URL (staff-only). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx);
    if (!isStaff(viewer.kind)) throw new ConvexError("Only studio staff can upload files.");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2 - attach the uploaded file + metadata to a deliverable (staff-only). */
export const attachFile = mutation({
  args: {
    deliverableId: v.id("deliverables"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, { deliverableId, storageId, fileName, fileSize, mimeType }) => {
    const orgId = await currentOrg(ctx);
    const viewer = await resolveViewer(ctx);
    if (!isStaff(viewer.kind)) throw new ConvexError("Only studio staff can upload files.");
    const d = await ctx.db.get(deliverableId);
    if (!d || d.orgId !== orgId) throw new ConvexError("Deliverable not found.");
    // Meter storage delta + enforce the plan cap BEFORE patching. Uses the
    // actual stored size; replacing a file nets to the size delta. Throws
    // (and deletes the just-uploaded file) if the org would exceed its cap.
    await meterStorageUpload(ctx, orgId, storageId, d.fileId ?? null);
    await ctx.db.patch(deliverableId, {
      fileId: storageId,
      fileName,
      fileSize,
      mimeType,
    });
    return deliverableId;
  },
});

/** R2 upload, step 1 (staff-only): a one-time signed PUT URL for a deliverable's
 *  file. Deliverables go to the private bucket; the browser uploads straight to
 *  R2, then calls media.confirmUpload, then attachR2File. */
export const prepareDeliverableUpload = mutation({
  args: { fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, a) => {
    const orgId = await currentOrg(ctx);
    const viewer = await resolveViewer(ctx);
    if (!isStaff(viewer.kind)) throw new ConvexError("Only studio staff can upload files.");
    const actor = "clerkUserId" in viewer ? String(viewer.clerkUserId) : viewer.kind;
    return await createUpload(ctx, { scope: orgId, purpose: "deliverable", fileName: a.fileName, mimeType: a.mimeType, size: a.size, actor });
  },
});

/** R2 upload, last step: attach a confirmed upload to a deliverable. Meters the
 *  real size against the plan cap, then retires the file it replaces. */
export const attachR2File = mutation({
  args: { deliverableId: v.id("deliverables"), mediaId: v.id("mediaFiles") },
  handler: async (ctx, { deliverableId, mediaId }) => {
    const orgId = await currentOrg(ctx);
    const viewer = await resolveViewer(ctx);
    if (!isStaff(viewer.kind)) throw new ConvexError("Only studio staff can upload files.");
    const d = await ctx.db.get(deliverableId);
    if (!d || d.orgId !== orgId) throw new ConvexError("Deliverable not found.");
    const m = await ctx.db.get(mediaId);
    if (!m || m.orgId !== orgId || m.purpose !== "deliverable") throw new ConvexError("Upload not found.");
    if (m.status !== "ready") throw new ConvexError("The upload has not finished.");
    await meterStorageUpload(ctx, orgId, mediaId, d.fileId ?? null);
    const previous = d.fileId ?? null;
    await ctx.db.patch(deliverableId, { fileId: mediaId, fileName: m.fileName, fileSize: m.size ?? 0, mimeType: m.mimeType });
    // The replaced file is no longer reachable from any row; free it.
    if (previous && previous !== mediaId) await deleteFile(ctx, previous, (bucket, key) => scheduleObjectDelete(ctx, bucket, key));
    return deliverableId;
  },
});

/**
 * Gated download. Returns a signed URL only when the deliverable is not
 * payment-gated, the caller is staff/owner, or the song's balance is
 * fully paid. Otherwise throws so the UI can render a lock state.
 */
export const downloadUrl = query({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, { deliverableId }) => {
    const orgId = await currentOrg(ctx);
    const viewer = await resolveViewer(ctx);
    const d = await ctx.db.get(deliverableId);
    if (!d || d.orgId !== orgId) throw new ConvexError("Deliverable not found.");
    if (!d.fileId) throw new ConvexError("No file uploaded yet.");

    const staff = isStaff(viewer.kind);
    const outstandingCents = staff || !d.paymentGated
      ? 0
      : await songOutstandingCents(ctx, d.songId);
    if (!gateAllows({ paymentGated: d.paymentGated, staff, outstandingCents })) {
      throw new ConvexError("Locked until the balance is paid.");
    }

    // Legacy Convex storage or private R2 (signed URL, valid an hour). The gate
    // above has already passed, so minting the URL here is the release.
    const url = await fileUrl(ctx, d.fileId, { expiresIn: 3600 });
    if (!url) throw new ConvexError("File is no longer available.");
    return { url };
  },
});
