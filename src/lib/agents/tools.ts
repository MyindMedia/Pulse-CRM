import { z } from "zod";

// Base Tool Tiers based on PRD architecture
export type ActionTier = "A" | "B" | "C";
// A = Auto (low risk, executes without approval)
// B = Approval (medium risk, e.g., customer communication)
// C = Blocked (high risk, requires full admin intervention/UI)

// ==========================================
// PIpeline Agent Tools
// ==========================================

export const updatePipelineStageSchema = z.object({
  projectId: z.string().describe("The Convex ID of the project/opportunity to update."),
  newStage: z.enum([
    "Inquiry", "Qualified", "Proposal", "Booked", "In Session", "Delivered", "Upsell"
  ]).describe("The new pipeline stage to move the project to."),
  reasoning: z.string().describe("The agent's reasoning for proposing this stage change."),
});

// A tier action: Just updating internal CRM state based on data
export const UpdatePipelineStageTier: ActionTier = "A";

// ==========================================
// Booking & Comm Agent Tools
// ==========================================

export const draftClientMessageSchema = z.object({
  clientId: z.string().describe("The Convex ID of the client to message."),
  messageBody: z.string().describe("The drafted message content to send (SMS/Email)."),
  isUrgent: z.boolean().describe("Whether this message needs immediate attention."),
  reasoning: z.string().describe("Context for why this message was drafted."),
});

// B tier action: We want a human to review outgoing messages before they are actually sent.
export const DraftClientMessageTier: ActionTier = "B";

export const scheduleSessionSchema = z.object({
  clientId: z.string().describe("The Convex ID of the client."),
  projectId: z.string().describe("The Convex ID of the parent project/opportunity."),
  proposedStartTime: z.string().describe("ISO string of proposed start time."),
  serviceType: z.string().describe("The type of service being booked (e.g., Mixing, Recording)."),
});

// B tier action: We want human review before confirming a spot on the calendar.
export const ScheduleSessionTier: ActionTier = "B";
