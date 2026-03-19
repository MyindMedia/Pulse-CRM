import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const agentRole = v.union(
  v.literal("StudioManager"),
  v.literal("FinanceAgent"),
  v.literal("MarketingAgent"),
  v.literal("ClientRelationsAgent"),
  v.literal("ContractsAgent"),
  v.literal("GrowthAgent")
);

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.string(),
    businessName: v.string(),
    businessType: v.union(
      v.literal("studio"),
      v.literal("producer"),
      v.literal("artist"),
      v.literal("label"),
      v.literal("enterprise")
    ),
    ghlLocationId: v.string(),
    ghlAccessToken: v.string(),
    ghlRefreshToken: v.string(),
    subscriptionTier: v.union(
      v.literal("solo"),
      v.literal("studio"),
      v.literal("enterprise")
    ),
    subscriptionStatus: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("cancelled")
    ),
    agentConfig: v.any(), // Simplified for now
  }).index("by_email", ["email"]),

  goals: defineTable({
    userId: v.id("users"),
    title: v.string(),
    description: v.string(),
    type: v.union(
      v.literal("booking"),
      v.literal("revenue"),
      v.literal("marketing"),
      v.literal("growth"),
      v.literal("custom")
    ),
    status: v.union(
      v.literal("decomposing"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("escalated")
    ),
    successCriteria: v.any(),
    currentProgress: v.any(),
    deadline: v.number(),
    tasks: v.array(v.id("tasks")),
    completedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  tasks: defineTable({
    goalId: v.optional(v.id("goals")),
    assignedAgent: agentRole,
    type: v.string(), // e.g., "SEND_BOOKING_CONFIRMATION"
    payload: v.any(),
    priority: v.union(
      v.literal("urgent"),
      v.literal("high"),
      v.literal("normal"),
      v.literal("low")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("escalated")
    ),
    attempts: v.number(),
    deadline: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  }).index("by_goal", ["goalId"]),

  auditLog: defineTable({
    userId: v.id("users"),
    agentRole: agentRole,
    taskId: v.id("tasks"),
    action: v.string(),
    ghlEndpoint: v.string(),
    ghlPayload: v.any(),
    ghlResponse: v.any(),
    outcome: v.union(v.literal("success"), v.literal("failure"), v.literal("escalated")),
  }).index("by_user", ["userId"]),

  escalations: defineTable({
    userId: v.id("users"),
    agentRole: agentRole,
    taskId: v.id("tasks"),
    reason: v.string(),
    context: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("instructed")
    ),
    humanResponse: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  agentMemory: defineTable({
    userId: v.id("users"),
    agentRole: agentRole,
    memoryType: v.union(v.literal("short_term"), v.literal("episodic")),
    content: v.any(),
    embedding: v.optional(v.array(v.float64())),
    expiresAt: v.optional(v.number()),
  }).index("by_user_agent", ["userId", "agentRole"]),

  // ─── Missing tables queried by admin.ts ───
  tenants: defineTable({
    name: v.string(),
    slug: v.string(),
    ghlLocationId: v.optional(v.string()),
    plan: v.optional(v.string()),
    status: v.optional(v.string()),
  }),
  profiles: defineTable({}),
  clients: defineTable({}),
  projects: defineTable({}),
  sessions: defineTable({}),
  invoices: defineTable({}),
  payments: defineTable({}),
  roles: defineTable({}),
  permissions: defineTable({}),
  tenantMemberships: defineTable({}),
  webhookEventsRaw: defineTable({}),
  activityLog: defineTable({}),
  integrationSyncState: defineTable({}),
  
  // ─── Agent specific tables ───
  agentRuns: defineTable({
    tenantId: v.id("tenants"),
    agentName: v.string(),
    status: v.string(),
    input: v.optional(v.string()), // Added input field
    startedAt: v.string(), // Changed to string
    completedAt: v.optional(v.string()), // Also change to string assuming new Date().toISOString()
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_tenant", ["tenantId"]),
  
  agentActions: defineTable({
    tenantId: v.id("tenants"),
    agentRunId: v.id("agentRuns"),
    toolName: v.string(),
    toolArgs: v.any(),
    tier: v.string(),
    status: v.string(),
    proposedAt: v.string(),
    completedAt: v.optional(v.string()),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_tenant", ["tenantId"]),
});
