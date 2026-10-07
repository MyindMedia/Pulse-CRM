import { defineTable } from "convex/server";
import { v } from "convex/values";

/* Post-production project tracking tables.

   Spread into the schema from schema.ts (`...projectTables`). Every row
   carries `orgId` and an orgId-first `by_org` index, because the phone and
   Mac mirror pull by it (see lib/mirroredTables.ts). The client never sends
   an orgId: convex/projects.ts derives it from the signed-in viewer. */

/** Stage order is the order a record moves through after the room. */
export const PROJECT_STAGES = [
  "tracking",
  "editing",
  "mixing",
  "mastering",
  "delivery",
  "complete",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const projectStageV = v.union(
  v.literal("tracking"),
  v.literal("editing"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("delivery"),
  v.literal("complete"),
);

/** What a project can point at. `engineer` is a members row, `invoice` is the bill. */
export const PROJECT_LINK_KINDS = [
  "session",
  "song",
  "room",
  "engineer",
  "invoice",
  "deliverable",
  "opportunity",
  "artist",
] as const;
export type ProjectLinkKind = (typeof PROJECT_LINK_KINDS)[number];

export const projectLinkKindV = v.union(
  v.literal("session"),
  v.literal("song"),
  v.literal("room"),
  v.literal("engineer"),
  v.literal("invoice"),
  v.literal("deliverable"),
  v.literal("opportunity"),
  v.literal("artist"),
);

export const projectTables = {
  projects: defineTable({
    orgId: v.string(),
    name: v.string(),
    stage: projectStageV,
    ownerMemberId: v.optional(v.id("members")),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    /** The song this project moves. Mirrored here so the board needs no link lookup. */
    songId: v.optional(v.id("songs")),
    createdAt: v.number(),
    updatedAt: v.number(),
    stageChangedAt: v.number(),
    completedAt: v.optional(v.number()),
    /** Last time an overdue reminder went out, so a daily sweep sends one. */
    lastDueReminderAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_stage", ["orgId", "stage"])
    .index("by_org_due", ["orgId", "dueDate"]),

  projectTasks: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    title: v.string(),
    /** The stage this task belongs to, when it belongs to one. */
    stage: v.optional(projectStageV),
    ownerMemberId: v.optional(v.id("members")),
    dueDate: v.optional(v.number()),
    done: v.boolean(),
    completedAt: v.optional(v.number()),
    sortOrder: v.number(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_org_due", ["orgId", "dueDate"]),

  projectLinks: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    kind: projectLinkKindV,
    /** The linked row's id. Checked against the project's own org on create. */
    refId: v.string(),
    /** Snapshot of the target's name at link time, so a card reads without a join. */
    label: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_org_kind_ref", ["orgId", "kind", "refId"]),
};
