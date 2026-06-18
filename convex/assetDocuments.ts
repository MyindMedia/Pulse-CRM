import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";

/* ============================================================
   Asset documents - receipts / invoices / warranties attached to a
   hardware (equipment) or software item. The file lives in Convex
   storage; these functions manage the metadata rows + the link.
   Reads need equipment.read, writes need equipment.edit (the
   inventory capabilities cover both asset kinds).
   ============================================================ */

const kindV = v.union(v.literal("equipment"), v.literal("software"));
const docTypeV = v.union(
  v.literal("invoice"),
  v.literal("receipt"),
  v.literal("warranty"),
  v.literal("other"),
);

/** Throw unless the parent asset exists and belongs to the caller's org. */
async function assertRefInOrg(
  ctx: MutationCtx,
  kind: "equipment" | "software",
  refId: string,
  orgId: string,
) {
  const doc =
    kind === "equipment"
      ? await ctx.db.get(refId as Id<"equipment">)
      : await ctx.db.get(refId as Id<"softwareLicenses">);
  if (!doc || doc.orgId !== orgId) throw new Error("Item not found.");
}

/** Storage upload URL for a receipt/invoice file (any file type). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrgWithCapability(ctx, "equipment.edit");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach an uploaded file to an equipment/software item. */
export const attach = mutation({
  args: {
    kind: kindV,
    refId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    sizeBytes: v.optional(v.number()),
    docType: v.optional(docTypeV),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.edit");
    await assertRefInOrg(ctx, args.kind, args.refId, orgId);
    return await ctx.db.insert("assetDocuments", {
      orgId,
      kind: args.kind,
      refId: args.refId,
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: args.fileType,
      sizeBytes: args.sizeBytes,
      docType: args.docType ?? "receipt",
      note: args.note,
      uploadedAt: Date.now(),
      uploadedBy: await currentActor(ctx),
    });
  },
});

/** Documents attached to one asset, newest first, with resolved file URLs. */
export const list = query({
  args: { kind: kindV, refId: v.string() },
  handler: async (ctx, { kind, refId }) => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.read");
    const docs = await ctx.db
      .query("assetDocuments")
      .withIndex("by_ref", (q) => q.eq("kind", kind).eq("refId", refId))
      .order("desc")
      .collect();
    return await Promise.all(
      docs
        .filter((d) => d.orgId === orgId)
        .map(async (d) => ({ ...d, url: await ctx.storage.getUrl(d.storageId) })),
    );
  },
});

/** Detach + delete a document (removes the stored file too). */
export const remove = mutation({
  args: { id: v.id("assetDocuments") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.edit");
    const doc = await ctx.db.get(id);
    if (!doc || doc.orgId !== orgId) throw new Error("Not found.");
    await ctx.storage.delete(doc.storageId).catch(() => undefined);
    await ctx.db.delete(id);
  },
});
