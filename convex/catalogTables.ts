import { defineTable } from "convex/server";
import { v } from "convex/values";
import { fileRefV } from "./lib/fileRef";

/* Catalog Import and Royalty Statements tables (Grilled.md "Catalog Import +
   Royalty Statements", openspec change catalog-import-and-royalties).

   Spread into the schema from schema.ts (`...catalogTables`). Every row
   carries the workspace's `orgId` (for an import, the Import Destination) and
   an orgId-first index. The client never sends an orgId for a write: the
   modules derive it from the viewer, or check membership of the destination. */

export const CREDIT_ROLES = [
  "Artist",
  "Writer",
  "Producer",
  "Engineer",
  "Mix Engineer",
  "Mastering Engineer",
  "Vocalist",
  "Musician",
] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];

export const creditSourceV = v.union(
  v.literal("musicbrainz"),
  v.literal("genius"),
  v.literal("deezer"),
  v.literal("apple"),
);
export type CreditSource = "musicbrainz" | "genius" | "deezer" | "apple";

const subjectKindV = v.union(v.literal("member"), v.literal("artist"));

export const statementSourceV = v.union(
  v.literal("distrokid"),
  v.literal("tunecore"),
  v.literal("cdbaby"),
  v.literal("mapped"),
);

export const catalogTables = {
  /** One person's identity at one credit source, picked (never typed) so two
   *  people with one name stay apart. Copied per workspace, never shared. */
  creditIdentities: defineTable({
    orgId: v.string(),
    subjectKind: subjectKindV,
    subjectId: v.string(), // members._id or artists._id
    source: creditSourceV,
    sourceId: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_subject", ["orgId", "subjectKind", "subjectId"]),

  /** One background Catalog Import job. */
  catalogImports: defineTable({
    orgId: v.string(),
    subjectKind: subjectKindV,
    subjectId: v.string(),
    identityIds: v.array(v.id("creditIdentities")),
    roles: v.array(v.string()),
    status: v.union(
      v.literal("discovering"),
      v.literal("importing"),
      v.literal("done"),
      v.literal("failed"),
    ),
    found: v.number(),
    imported: v.number(),
    merged: v.number(),
    failed: v.number(),
    // Songs where the identity held none of the chosen roles (Genius lists).
    skipped: v.number(),
    // Candidates left out because of the 500-song cap.
    capped: v.number(),
    startedBy: v.string(),
    startedByName: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_subject", ["orgId", "subjectKind", "subjectId"]),

  /** One discovered song waiting for (or done with) enrichment. */
  catalogImportItems: defineTable({
    orgId: v.string(),
    importId: v.id("catalogImports"),
    title: v.string(),
    artistName: v.optional(v.string()),
    isrc: v.optional(v.string()),
    album: v.optional(v.string()),
    releaseDate: v.optional(v.number()),
    coverUrl: v.optional(v.string()),
    roles: v.array(v.string()),
    sources: v.array(v.string()),
    refs: v.object({
      deezerTrackId: v.optional(v.number()),
      mbRecordingId: v.optional(v.string()),
      mbWorkId: v.optional(v.string()),
      geniusSongId: v.optional(v.number()),
      appleTrackId: v.optional(v.number()),
    }),
    state: v.union(
      v.literal("pending"),
      v.literal("imported"),
      v.literal("merged"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    songId: v.optional(v.id("songs")),
    error: v.optional(v.string()),
  })
    .index("by_import_state", ["importId", "state"]),

  /** A Member's imported credit. Internal until an owner or manager approves
   *  it; only approved rows reach the booking page. Never moves money. */
  importedCredits: defineTable({
    orgId: v.string(),
    memberId: v.id("members"),
    songId: v.id("songs"),
    role: v.string(),
    source: v.string(),
    approved: v.boolean(),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_member_song", ["memberId", "songId"]),

  /** One uploaded distributor statement. */
  royaltyStatements: defineTable({
    orgId: v.string(),
    source: statementSourceV,
    fileId: fileRefV,
    fileName: v.string(),
    fileHash: v.string(), // SHA-256 of the bytes; refuses the same file twice
    status: v.union(v.literal("parsing"), v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    // Gross per currency, integer cents. Most statements carry one currency.
    totals: v.array(v.object({ currency: v.string(), cents: v.number() })),
    rowCount: v.number(), // rows in the file
    lineCount: v.number(), // royaltyLines written (one per song x currency)
    uploadedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_hash", ["orgId", "fileHash"]),

  /** A statement's earnings for one recording in one currency: every store and
   *  country row for that ISRC (or title when the file has no ISRC) summed. */
  royaltyLines: defineTable({
    orgId: v.string(),
    statementId: v.id("royaltyStatements"),
    isrc: v.optional(v.string()),
    title: v.optional(v.string()),
    artist: v.optional(v.string()),
    currency: v.string(),
    amountCents: v.number(),
    units: v.number(),
    rows: v.number(),
    songId: v.optional(v.id("songs")),
    state: v.union(v.literal("allocated"), v.literal("unallocated"), v.literal("unmatched")),
  })
    .index("by_statement", ["statementId"])
    .index("by_org_state", ["orgId", "state"])
    .index("by_org_song", ["orgId", "songId"]),

  /** What one contributor is owed from one line, from the signed master %. */
  royaltyShares: defineTable({
    orgId: v.string(),
    statementId: v.id("royaltyStatements"),
    lineId: v.id("royaltyLines"),
    songId: v.id("songs"),
    contributorKey: v.string(), // lower-cased email
    name: v.string(),
    pct: v.number(),
    currency: v.string(),
    amountCents: v.number(),
    paidAt: v.optional(v.number()),
    paidMethod: v.optional(v.string()),
    paidBy: v.optional(v.string()),
  })
    .index("by_line", ["lineId"])
    .index("by_statement", ["statementId"])
    .index("by_org_contributor", ["orgId", "contributorKey"]),

  /** A remembered column mapping for a CSV no built-in parser recognises. */
  royaltyMappings: defineTable({
    orgId: v.string(),
    headerSignature: v.string(),
    columns: v.object({
      isrc: v.optional(v.string()),
      title: v.optional(v.string()),
      artist: v.optional(v.string()),
      amount: v.string(),
      currency: v.optional(v.string()),
      units: v.optional(v.string()),
      period: v.optional(v.string()),
    }),
    createdAt: v.number(),
  }).index("by_org_signature", ["orgId", "headerSignature"]),
};
