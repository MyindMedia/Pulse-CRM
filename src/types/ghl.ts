import { z } from 'zod';

export const GhlContactSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const GhlOpportunitySchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  pipelineId: z.string(),
  pipelineStageId: z.string(),
  status: z.enum(['open', 'won', 'lost', 'abandoned']),
  monetaryValue: z.number(),
  contact: GhlContactSchema.optional(),
});

export const GhlWebhookEventSchema = z.object({
  type: z.string(),
  data: z.any(),
});

export const GhlMessageSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  type: z.enum(['sms', 'email']),
  direction: z.enum(['inbound', 'outbound']),
  content: z.string(),
  createdAt: z.string(),
});

export const GhlConversationSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  lastMessage: GhlMessageSchema.optional(),
});

export type GhlContact = z.infer<typeof GhlContactSchema>;
export type GhlOpportunity = z.infer<typeof GhlOpportunitySchema>;
export type GhlWebhookEvent = z.infer<typeof GhlWebhookEventSchema>;
export type GhlMessage = z.infer<typeof GhlMessageSchema>;
export type GhlConversation = z.infer<typeof GhlConversationSchema>;
