import {v} from 'convex/values';
import {internalMutation,internalQuery} from '../_generated/server';
import {appointmentV} from './tables';
import {eligible,activeMeeting} from './policy';
import {ref} from './refs';
export const get=internalQuery({args:{id:v.string()},returns:v.any(),handler:async(ctx,{id})=>await ctx.db.query('pulseWalkthroughAppointments').withIndex('by_appointmentId',q=>q.eq('appointment.id',id)).unique()});
export const byCall=internalQuery({args:{callId:v.string()},returns:v.any(),handler:async(ctx,{callId})=>await ctx.db.query('pulseWalkthroughAppointments').withIndex('by_callId',q=>q.eq('callId',callId)).unique()});
export const operation=internalQuery({args:{key:v.string()},returns:v.any(),handler:async(ctx,{key})=>await ctx.db.query('pulseWalkthroughOutbox').withIndex('by_key',q=>q.eq('key',key)).unique()});
export const budget=internalMutation({args:{limitCents:v.number()},returns:v.null(),handler:async(ctx,{limitCents})=>{if(!Number.isSafeInteger(limitCents)||limitCents<0)throw Error('Invalid budget');const b=await ctx.db.query('pulseWalkthroughBudget').withIndex('by_scope',q=>q.eq('scope','pulseWalkthrough')).unique();if(b){if(limitCents<b.reservedCents)throw Error('Below reservations');await ctx.db.patch(b._id,{limitCents});}else await ctx.db.insert('pulseWalkthroughBudget',{scope:'pulseWalkthrough',limitCents,reservedCents:0});return null;}});
export const accept=internalMutation({args:{appointment:appointmentV},returns:v.null(),handler:async(ctx,{appointment:a})=>{
 const old=await ctx.db.query('pulseWalkthroughAppointments').withIndex('by_appointmentId',q=>q.eq('appointment.id',a.id)).unique();
 if(old && old.appointment.contactId!==a.contactId)throw Error('Immutable appointment contact mismatch');
 // Unchanged notifications do not schedule again; changed versions invalidate old jobs.
 if(old && JSON.stringify(old.appointment)===JSON.stringify(a))return null;
 const version=(old?.version??0)+1;const suppressed=!eligible(a,Date.now());
 if(old)await ctx.db.patch(old._id,{appointment:a,version,suppressed:suppressed||old.suppressed});else await ctx.db.insert('pulseWalkthroughAppointments',{appointment:a,version,suppressed});
 if(!activeMeeting(a,Date.now()))return null;
 if(!suppressed&&!old?.callId)await ctx.scheduler.runAfter(0,ref('actions:dispatch'),{id:a.id,version});
 const at=a.start-15*60_000;if(at>Date.now())await ctx.scheduler.runAt(at,ref('actions:sms'),{id:a.id,version});
 return null;
}});
export const reviewSuppression=internalMutation({args:{callId:v.string(),decision:v.union(v.literal('clear'),v.literal('refused')),evidence:v.string()},returns:v.null(),handler:async(ctx,a)=>{
 if(a.evidence.trim().length<20)throw Error('Specific reviewed evidence required');
 const row=await ctx.db.query('pulseWalkthroughAppointments').withIndex('by_callId',q=>q.eq('callId',a.callId)).unique();if(!row||!row.summary)throw Error('Verified note required');
 await ctx.db.patch(row._id,{suppressed:a.decision!=='clear'||!eligible(row.appointment,Date.now()),reviewEvidence:a.evidence.slice(0,2000)});return null;
}});
export const claim=internalMutation({args:{id:v.string(),version:v.number(),kind:v.union(v.literal('call'),v.literal('note'),v.literal('sms')),key:v.string(),cost:v.number()},returns:v.boolean(),handler:async(ctx,a)=>{
 const row=await ctx.db.query('pulseWalkthroughAppointments').withIndex('by_appointmentId',q=>q.eq('appointment.id',a.id)).unique();
 if(!row||row.version!==a.version||(a.kind==='call'&&(row.suppressed||!eligible(row.appointment,Date.now())))||(a.kind!=='note'&&!activeMeeting(row.appointment,Date.now())))return false;
 if(await ctx.db.query('pulseWalkthroughOutbox').withIndex('by_key',q=>q.eq('key',a.key)).unique())return false;
 const b=await ctx.db.query('pulseWalkthroughBudget').withIndex('by_scope',q=>q.eq('scope','pulseWalkthrough')).unique();
 if(!Number.isSafeInteger(a.cost)||a.cost<0||!b||b.reservedCents+a.cost>b.limitCents)return false;
 await ctx.db.patch(b._id,{reservedCents:b.reservedCents+a.cost});
 await ctx.db.insert('pulseWalkthroughOutbox',{key:a.key,appointmentId:a.id,snapshot:row.appointment,version:a.version,kind:a.kind,state:'claimed',reservedCents:a.cost});return true;
}});
export const finish=internalMutation({args:{key:v.string(),state:v.union(v.literal('done'),v.literal('reconcile'),v.literal('cancelled')),remoteId:v.optional(v.string()),reason:v.optional(v.string()),callId:v.optional(v.string()),summary:v.optional(v.string()),suppress:v.optional(v.boolean())},returns:v.null(),handler:async(ctx,a)=>{
 const op=await ctx.db.query('pulseWalkthroughOutbox').withIndex('by_key',q=>q.eq('key',a.key)).unique();if(!op||op.state!=='claimed')return null;
 await ctx.db.patch(op._id,{state:a.state,...(a.remoteId?{remoteId:a.remoteId}:{}),...(a.reason?{reason:a.reason}:{})});
 const row=await ctx.db.query('pulseWalkthroughAppointments').withIndex('by_appointmentId',q=>q.eq('appointment.id',op.appointmentId)).unique();
 if(row)await ctx.db.patch(row._id,{...(a.callId?{callId:a.callId,callSnapshot:op.snapshot}:{}),...(a.summary!==undefined?{summary:a.summary}:{}),...(a.suppress!==undefined?{suppressed:a.suppress}:{})});return null;
}});
