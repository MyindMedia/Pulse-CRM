import {v} from 'convex/values';
import {internalAction} from '../_generated/server';
import {providers} from './providers';
import {eligible,activeMeeting,reminder,sameMeeting,sameAppointment,TARGET} from './policy';
import {ref} from './refs';
export function enabled(){return process.env.PULSE_WALKTHROUGH_ENABLED==='true' && process.env.PULSE_WALKTHROUGH_SCHEMA_AUDITED==='true';}
function client(){if(!enabled())throw Error('Disabled');const ghl=process.env.PULSE_WALKTHROUGH_GHL_KEY,bland=process.env.PULSE_WALKTHROUGH_BLAND_KEY,callback=process.env.PULSE_WALKTHROUGH_CALLBACK_URL;if(!ghl||!bland||!callback)throw Error('Private configuration incomplete');return providers(fetch,{ghl,bland},callback);}
function cost(kind:string){const n=Number(process.env[`PULSE_WALKTHROUGH_${kind.toUpperCase()}_MAX_CENTS`]);if(!Number.isSafeInteger(n)||n<=0)throw Error('Approved maximum cost absent');return n;}
const args={id:v.string(),version:v.number()};
export const booking=internalAction({args:{id:v.string()},returns:v.null(),handler:async(ctx,{id})=>{if(!enabled())return null;const a=await client().appointment(id);await ctx.runMutation(ref('state:accept'),{appointment:a});return null;}});
export const dispatch=internalAction({args,returns:v.null(),handler:async(ctx,a)=>{
 if(!enabled())return null;const row=await ctx.runQuery(ref('state:get'),{id:a.id});if(!row||row.version!==a.version)return null;const p=client();const current=await p.appointment(a.id);if(!eligible(current,Date.now())||!sameAppointment(current,row.appointment)){await ctx.runMutation(ref('state:accept'),{appointment:current});return null;}
 const key=`call:${a.id}`;if(!await ctx.runMutation(ref('state:claim'),{...a,kind:'call',key,cost:cost('call')}))return null;
 try{const fresh=await p.appointment(a.id);if(!eligible(fresh,Date.now())||!sameAppointment(current,fresh)){await ctx.runMutation(ref('state:finish'),{key,state:'cancelled'});return null;}const callId=await p.call(fresh);await ctx.runMutation(ref('state:finish'),{key,state:'done',callId,remoteId:callId});}catch{await ctx.runMutation(ref('state:finish'),{key,state:'reconcile',reason:'Uncertain call; never retry automatically'});}return null;
}});
export const callback=internalAction({args:{callId:v.string()},returns:v.boolean(),handler:async(ctx,{callId})=>{
 if(!enabled())return false;const row=await ctx.runQuery(ref('state:byCall'),{callId});if(!row)return false;const a=row.callSnapshot;if(!a)return false;const key=`note:${callId}`;
 if(!await ctx.runMutation(ref('state:claim'),{id:a.id,version:row.version,kind:'note',key,cost:cost('note')}))return !!await ctx.runQuery(ref('state:operation'),{key});
 try{const p=client(),r=await p.getCall(callId),m=r.metadata;if(r.completed!==true||r.status!=='completed'||m?.location_id!==TARGET.location||m.calendar_id!==TARGET.calendar||m.contact_id!==a.contactId||m.appointment_id!==a.id||r.to!==a.phone)throw Error('Call correlation');
  const summary=`Call brief for original booking ${new Date(a.start).toISOString()} (${a.timezone}):\n`+(typeof r.summary==='string'?r.summary.slice(0,8000):'Brief unavailable; completed call had no summary.');
  // Standard callbacks do not contain a reliable opt-out extraction. Save the
  // factual brief; conservatively suppress any further client call contact.
  // Owner notification is independent of the prospect's call consent/DND.
  const remoteId=await p.note(a,callId,summary);await ctx.runMutation(ref('state:finish'),{key,state:'done',summary,remoteId,suppress:true,reason:'Suppression outcome requires evidenced review'});
 }catch{await ctx.runMutation(ref('state:finish'),{key,state:'reconcile',reason:'Callback/note verification failed; inspect before retry'});}return true;
}});
export const sms=internalAction({args,returns:v.null(),handler:async(ctx,a)=>{
 if(!enabled())return null;const row=await ctx.runQuery(ref('state:get'),{id:a.id});if(!row||row.version!==a.version)return null;const p=client(),current=await p.appointment(a.id);
 if(!activeMeeting(current,Date.now())||!sameMeeting(current,row.appointment)){await ctx.runMutation(ref('state:accept'),{appointment:current});return null;}
 const due=current.start-900_000;if(Date.now()<due||Date.now()>due+60_000)return null;
 const key=`sms:${a.id}:${current.start}:${TARGET.owner}`;if(!await ctx.runMutation(ref('state:claim'),{...a,kind:'sms',key,cost:cost('sms')}))return null;
 try{const fresh=await p.appointment(a.id);const latest=await ctx.runQuery(ref('state:get'),{id:a.id});if(!latest||latest.version!==a.version||!activeMeeting(fresh,Date.now())||!sameMeeting(fresh,current)){await ctx.runMutation(ref('state:finish'),{key,state:'cancelled'});return null;}const remoteId=await p.sms(reminder(fresh,latest.summary??null));await ctx.runMutation(ref('state:finish'),{key,state:'done',remoteId});}catch{await ctx.runMutation(ref('state:finish'),{key,state:'reconcile',reason:'Uncertain SMS; never retry automatically'});}return null;
}});
