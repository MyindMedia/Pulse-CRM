import {TARGET,type Appointment} from './policy';
type Json=Record<string,any>;
export function providers(fetcher:typeof fetch, keys:{ghl:string;bland:string}, callback:string){
 async function request(provider:'ghl'|'bland',path:string,method='GET',body?:Json):Promise<Json>{
  const base=provider==='ghl'?'https://services.leadconnectorhq.com':'https://api.bland.ai';
  const response=await fetcher(base+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{Authorization:provider==='ghl'?`Bearer ${keys.ghl}`:keys.bland,'Content-Type':'application/json',...(provider==='ghl'?{Version:'2021-07-28'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('Provider request failed');return await response.json();
 }
 const safe=(id:string)=>{if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Invalid ID');return id;};
 async function contact(id:string){const r=await request('ghl',`/contacts/${safe(id)}`);const c=r.contact;if(c?.id!==id||c.locationId!==TARGET.location)throw Error('Contact boundary');return c;}
 return{
  async appointment(id:string):Promise<Appointment>{const r=await request('ghl',`/calendars/events/appointments/${safe(id)}`);const e=r.event;
   if(e?.id!==id||e.calendarId!==TARGET.calendar||e.locationId!==TARGET.location||typeof e.contactId!=='string')throw Error('Appointment boundary/schema');
   const c=await contact(e.contactId);const consent=c.customFields?.find((f:Json)=>f.id==='McAqWQdi1d78BzlzfIp5');
   // These exact field shapes must be audited with an approved read before enablement.
   if(typeof c.dnd!=='boolean'||typeof e.appointmentStatus!=='string'||typeof e.timezone!=='string'||typeof consent?.value!=='string')throw Error('Unaudited appointment/consent schema');
   return{id,contactId:c.id,locationId:e.locationId,calendarId:e.calendarId,start:Date.parse(e.startTime),timezone:e.timezone,phone:c.phone,name:c.name??'',status:e.appointmentStatus,consent:consent.value==='Yes',dnd:c.dnd,consentEvidence:consent.value==='Yes'?'GHL affirmative consent field McAqWQdi1d78BzlzfIp5':''};
  },
  async call(a:Appointment){if(new URL(callback).protocol!=='https:')throw Error('HTTPS callback required');const r=await request('bland','/v1/calls','POST',{phone_number:a.phone,task:`Confirm the Pulse Walkthrough demo for ${a.name} on ${new Date(a.start).toISOString()} in ${a.timezone}. Ask about their studio needs. Do not claim to change the booking. Honor refusal and end promptly.`,voice:'0ad34a7c-ccd2-485c-977d-deb84bd23976',max_duration:5,record:false,ivr_mode:false,voicemail:{action:'hangup'},webhook:callback,metadata:{location_id:TARGET.location,calendar_id:TARGET.calendar,contact_id:a.contactId,appointment_id:a.id}});if(r.status!=='success'||typeof r.call_id!=='string')throw Error('Unconfirmed call');return r.call_id;},
  async getCall(id:string){const r=await request('bland',`/v1/calls/${safe(id)}`);if(r.call_id!==id)throw Error('Call mismatch');return r;},
  async note(a:Appointment,callId:string,summary:string){await contact(a.contactId);const marker=`Call ID: ${callId}`;const n=await request('ghl',`/contacts/${safe(a.contactId)}/notes`);
   if(!Array.isArray(n.notes)||n.nextPage||n.nextPageUrl||n.meta?.nextPage)throw Error('Incomplete notes');
   for(const note of n.notes){if(note.contactId!==a.contactId||typeof note.body!=='string'||typeof note.id!=='string')throw Error('Note schema');if(note.body.split('\n').includes(marker))return note.id;}
   const r=await request('ghl',`/contacts/${safe(a.contactId)}/notes`,'POST',{title:'Pulse demo call brief',body:`Pulse demo call brief\nAppointment ID: ${a.id}\n${marker}\n${summary}`});if(!r.note?.id||r.note.contactId!==a.contactId)throw Error('Unconfirmed note');return r.note.id;
  },
  async sms(text:string){const c=await contact(TARGET.ownerContact);if(c.phone!==TARGET.owner||c.dnd!==false)throw Error('Owner identity/DND');const r=await request('ghl','/conversations/messages','POST',{type:'SMS',contactId:TARGET.ownerContact,message:text,fromNumber:TARGET.sender,toNumber:TARGET.owner,status:'pending'});if(!r.messageId||!r.conversationId)throw Error('Unconfirmed SMS');return r.messageId;}
 };
}
