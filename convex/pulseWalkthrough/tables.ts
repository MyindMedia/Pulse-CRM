import {defineTable} from 'convex/server';
import {v} from 'convex/values';
export const appointmentV=v.object({id:v.string(),contactId:v.string(),locationId:v.string(),calendarId:v.string(),start:v.number(),timezone:v.string(),phone:v.string(),name:v.string(),status:v.string(),consent:v.boolean(),dnd:v.boolean(),consentEvidence:v.string()});
export const pulseWalkthroughTables={
 pulseWalkthroughAppointments:defineTable({appointment:appointmentV,version:v.number(),callId:v.optional(v.string()),callSnapshot:v.optional(appointmentV),summary:v.optional(v.string()),suppressed:v.boolean(),reviewEvidence:v.optional(v.string())}).index('by_appointmentId',['appointment.id']).index('by_callId',['callId']),
 pulseWalkthroughOutbox:defineTable({key:v.string(),appointmentId:v.string(),snapshot:appointmentV,version:v.number(),kind:v.union(v.literal('call'),v.literal('note'),v.literal('sms')),state:v.union(v.literal('pending'),v.literal('claimed'),v.literal('done'),v.literal('reconcile'),v.literal('cancelled')),reservedCents:v.number(),remoteId:v.optional(v.string()),reason:v.optional(v.string())}).index('by_key',['key']),
 pulseWalkthroughBudget:defineTable({scope:v.literal('pulseWalkthrough'),limitCents:v.number(),reservedCents:v.number()}).index('by_scope',['scope']),
};
