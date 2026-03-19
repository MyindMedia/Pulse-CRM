import { v } from "convex/values";
import { action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  draftClientMessageSchema,
  scheduleSessionSchema,
  updatePipelineStageSchema,
  UpdatePipelineStageTier,
  DraftClientMessageTier,
  ScheduleSessionTier
} from "../src/lib/agents/tools";

/**
 * Entry point to start an agent run.
 */
export const startAgent = mutation({
  args: {
    tenantId: v.id("tenants"),
    agentName: v.union(v.literal("Booking Agent"), v.literal("Pipeline Agent")),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Create the run record
    const runId = await ctx.db.insert("agentRuns", {
      tenantId: args.tenantId,
      agentName: args.agentName,
      status: "running",
      input: args.input,
      startedAt: new Date().toISOString(),
    });

    // 2. We use Convex scheduling to kick off the long-running action returning immediately to the client
    await ctx.scheduler.runAfter(0, internal.agents.runAgentAction, {
      runId,
      tenantId: args.tenantId,
      agentName: args.agentName,
      input: args.input,
    });

    return runId;
  },
});

/**
 * The core Control Plane execution loop.
 * This connects to OpenAI, evaluates tools, and pauses for Tier B approvals if needed.
 */
export const runAgentAction = internalAction({
  args: {
    runId: v.id("agentRuns"),
    tenantId: v.id("tenants"),
    agentName: v.string(),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("Missing OPENAI_API_KEY environment variable. Check Convex dashboard.");
      }

      const systemPrompt = `You are the ${args.agentName} for Pulse CRM.
You are an intelligent music industry operations assistant.
Your goal is to complete the user's operational request.
Based on the tools available, decide if you need to take an action.`;

      // Call the AI SDK
      const { text, toolCalls, toolResults } = await generateText({
        model: openai("gpt-4o"),
        system: systemPrompt,
        prompt: args.input,
        tools: {
          updatePipelineStage: {
            description: "Move a project/deal to a new stage in the pipeline.",
            parameters: updatePipelineStageSchema,
          } as any,
          draftClientMessage: {
            description: "Draft a message to a client for human review.",
            parameters: draftClientMessageSchema,
          } as any,
          scheduleSession: {
            description: "Propose scheduling a new studio session.",
            parameters: scheduleSessionSchema,
          } as any
        },
      });

      // After generation, inspect if the LLM decided to call any tools
      if (toolCalls && toolCalls.length > 0) {
        // Evaluate Tier logic
        for (const call of toolCalls) {
          let tier = "C";
          let status = "pending_approval";

          if (call.toolName === "updatePipelineStage") {
            tier = UpdatePipelineStageTier;
            status = tier === "A" ? "pending_execution" : "pending_approval";
          } else if (call.toolName === "draftClientMessage") {
            tier = DraftClientMessageTier;
          } else if (call.toolName === "scheduleSession") {
            tier = ScheduleSessionTier;
          }

          // Persist the proposed action
          await ctx.runMutation(internal.agents.logAgentAction, {
            tenantId: args.tenantId,
            agentRunId: args.runId,
            toolName: call.toolName,
            toolArgs: (call as any).args,
            tier,
            status,
          });
        }

        // If any actions require approval, we pause the run. 
        // A cron or a separate mutation triggers execution once approved.
        await ctx.runMutation(internal.agents.updateRunStatus, {
          runId: args.runId,
          status: "paused_for_approval",
          output: text,
        });

      } else {
        // Completed without actions
        await ctx.runMutation(internal.agents.updateRunStatus, {
          runId: args.runId,
          status: "completed",
          output: text,
          completedAt: new Date().toISOString(),
        });
      }

    } catch (error: any) {
      console.error("Agent Run Failed:", error);
      await ctx.runMutation(internal.agents.updateRunStatus, {
        runId: args.runId,
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date().toISOString(),
      });
    }
  },
});

// Internals for state management
export const updateRunStatus = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.string(),
    output: v.optional(v.string()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { runId, ...updates } = args;
    await ctx.db.patch(runId, updates);
  },
});

export const logAgentAction = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    agentRunId: v.id("agentRuns"),
    toolName: v.string(),
    toolArgs: v.any(),
    tier: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentActions", {
      tenantId: args.tenantId,
      agentRunId: args.agentRunId,
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      tier: args.tier,
      status: args.status,
      proposedAt: new Date().toISOString(),
    });
  },
});

// UI Queries
export const getActiveRuns = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(50);
  },
});

export const getPendingActions = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentActions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .filter((q) => q.eq(q.field("status"), "pending_approval"))
      .order("desc")
      .take(50);
  },
});
