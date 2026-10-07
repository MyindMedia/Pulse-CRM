import { defineTable } from "convex/server";
import { v } from "convex/values";

/* Media library tables (file management with version control).

   Spread into the schema from schema.ts (`...mediaLibraryTables`). Every row
   carries `orgId`; the client never sends one, convex/mediaLibrary.ts derives
   it from the signed-in viewer. File bytes are NOT here: a version points at a
   `mediaFiles` row, which points at the object in the studio's own R2 bucket. */

export const MEDIA_KINDS = ["session", "stem", "mix", "master", "artwork", "deliverable", "other"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const mediaKindV = v.union(
  v.literal("session"),
  v.literal("stem"),
  v.literal("mix"),
  v.literal("master"),
  v.literal("artwork"),
  v.literal("deliverable"),
  v.literal("other"),
);

export const approvalV = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("changes_requested"),
);

export const mediaLibraryTables = {
  // One row per logical file ("Final master"). Versions hang off it.
  mediaAssets: defineTable({
    orgId: v.string(),
    name: v.string(),
    kind: mediaKindV,
    tags: v.array(v.string()),
    songId: v.optional(v.id("songs")),
    sessionId: v.optional(v.id("sessions")),
    // Highest version number so far; never decreases, so numbers are not reused.
    currentVersion: v.number(),
    versionCount: v.number(),
    totalBytes: v.number(),
    // Lower-cased name + tags + song title + session title, for search.
    searchText: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId", "updatedAt"])
    .index("by_org_song", ["orgId", "songId"])
    .index("by_org_session", ["orgId", "sessionId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["orgId", "kind"] }),

  // One row per upload. Numbered per asset; a restore is a new row that
  // reuses an older version's file and records `restoredFrom`.
  mediaVersions: defineTable({
    orgId: v.string(),
    assetId: v.id("mediaAssets"),
    version: v.number(),
    mediaId: v.id("mediaFiles"),
    fileName: v.string(),
    size: v.number(),
    mimeType: v.string(),
    note: v.optional(v.string()),
    approval: approvalV,
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvalNote: v.optional(v.string()),
    restoredFrom: v.optional(v.number()),
    uploadedBy: v.string(),
    uploadedAt: v.number(),
  })
    .index("by_asset", ["assetId", "version"])
    .index("by_org", ["orgId", "uploadedAt"])
    .index("by_media", ["mediaId"]),

  // Notes on one version. `versionId` for library versions, `deliverableId`
  // for a finished mix (the Core "Notes on one version of a mix").
  mediaNotes: defineTable({
    orgId: v.string(),
    versionId: v.optional(v.id("mediaVersions")),
    deliverableId: v.optional(v.id("deliverables")),
    body: v.string(),
    author: v.string(),
    createdAt: v.number(),
  })
    .index("by_version", ["versionId", "createdAt"])
    .index("by_deliverable", ["deliverableId", "createdAt"])
    .index("by_org", ["orgId", "createdAt"]),

  // Who did what and when, per asset.
  mediaEvents: defineTable({
    orgId: v.string(),
    assetId: v.id("mediaAssets"),
    version: v.optional(v.number()),
    action: v.string(),
    actor: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_asset", ["assetId", "createdAt"])
    .index("by_org", ["orgId", "createdAt"]),
};
