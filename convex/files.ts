import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import { recordUsage } from "./usage";

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
    await ctx.db.patch(deliverableId, {
      fileId: storageId,
      fileName,
      fileSize,
      mimeType,
    });
    // Meter storage delta (replacing a file adjusts by the difference).
    await recordUsage(ctx, orgId, "storage_bytes", fileSize - (d.fileSize ?? 0));
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

    const url = await ctx.storage.getUrl(d.fileId);
    if (!url) throw new ConvexError("File is no longer available.");
    return { url };
  },
});
