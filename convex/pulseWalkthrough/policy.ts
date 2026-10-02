export const TARGET = Object.freeze({location: 'F0yle6iHmWc14SpOyijl', calendar: 'ocwM9E9SrVQnMOIK5OpZ', owner: '+14084100931', ownerContact: 'SlPAwHvJe4PRckad3NtK', sender: '+12134445199'});
export type Appointment = {id:string; contactId:string; locationId:string; calendarId:string; start:number; timezone:string; phone:string; name:string; status:string; consent:boolean; dnd:boolean; consentEvidence:string};
export function activeMeeting(a:Appointment, now:number) {
  return a.locationId===TARGET.location && a.calendarId===TARGET.calendar && !!a.id && !!a.contactId && Number.isFinite(a.start) && a.start>now && ['confirmed','new'].includes(a.status) && validTimezone(a.timezone);
}
export function eligible(a:Appointment,now:number){return activeMeeting(a,now)&&a.consent===true&&a.dnd===false&&!!a.consentEvidence&&/^\+[1-9]\d{7,14}$/.test(a.phone);}
function validTimezone(value:string){try{new Intl.DateTimeFormat('en-US',{timeZone:value});return !!value;}catch{return false;}}
export function reminder(a:Appointment, summary:string|null){return `Pulse demo: ${a.name || 'Prospect'} — ${new Intl.DateTimeFormat('en-US',{timeZone:a.timezone,dateStyle:'medium',timeStyle:'short'}).format(a.start)} ${a.timezone}\n${summary?.slice(0,480) || 'Brief unavailable; review contact notes.'}\nAppointment ID: ${a.id}`;}
export function sameAppointment(a:Appointment,b:Appointment){return a.id===b.id && a.contactId===b.contactId && a.start===b.start && a.phone===b.phone && a.timezone===b.timezone;}

export function sameMeeting(a:Appointment,b:Appointment){return a.id===b.id&&a.contactId===b.contactId&&a.start===b.start&&a.timezone===b.timezone;}
