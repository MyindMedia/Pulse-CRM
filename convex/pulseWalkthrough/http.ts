import {httpAction} from '../_generated/server';
import {enabled} from './actions';
import {ref} from './refs';
export async function verify(body:string,signature:string|null,secret:string|undefined){
 if(!secret||!signature||!/^([a-f0-9]{64})$/i.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16));return await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(body));
}
export const bland=httpAction(async(ctx,req)=>{
 if(!enabled())return new Response('disabled',{status:503});
 if(!req.headers.get('content-type')?.includes('application/json'))return new Response('JSON required',{status:415});
 const body=await req.text();if(new TextEncoder().encode(body).length>1_000_000)return new Response('too large',{status:413});
 // Actual vendor serialization/header must be confirmed before enabling.
 const signingMode=process.env.PULSE_WALKTHROUGH_BLAND_SIGNING_MODE;
 if(!['raw','json'].includes(signingMode??''))return new Response('signing mode unaudited',{status:503});
 let signingBody=body;try{if(signingMode==='json')signingBody=JSON.stringify(JSON.parse(body));}catch{return new Response('bad JSON',{status:400});}
 if(!await verify(signingBody,req.headers.get('x-webhook-signature'),process.env.PULSE_WALKTHROUGH_BLAND_SIGNING_SECRET))return new Response('unauthorized',{status:401});
 let data;try{data=JSON.parse(body);}catch{return new Response('bad JSON',{status:400});}
 if(typeof data.call_id!=='string'||!/^[0-9a-f-]{36}$/i.test(data.call_id))return new Response('invalid call ID',{status:400});
 const accepted=await ctx.runAction(ref('actions:callback'),{callId:data.call_id});return accepted?new Response('ok'):new Response('call registration pending',{status:503});
});
export const booking=httpAction(async(ctx,req)=>{
 if(!enabled())return new Response('disabled',{status:503});const body=await req.text();if(new TextEncoder().encode(body).length>16_384)return new Response('too large',{status:413});
 // Native GHL can supply a privately stored bearer header. Hash both values
 // before comparison; never put endpoint credentials in URLs or logs.
 const secret=process.env.PULSE_WALKTHROUGH_BOOKING_SECRET;
 const presented=req.headers.get('authorization');
 if(!secret||!presented)return new Response('unauthorized',{status:401});
 const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const expected=await digest(`Bearer ${secret}`),actual=await digest(presented);let difference=0;
 for(let i=0;i<expected.length;i++)difference|=expected[i]^actual[i];
 if(difference!==0)return new Response('unauthorized',{status:401});
 let data;try{data=JSON.parse(body);}catch{return new Response('bad JSON',{status:400});}
 if(typeof data.appointment_id!=='string')return new Response('appointment ID required',{status:400});
 await ctx.runAction(ref('actions:booking'),{id:data.appointment_id});return new Response('ok');
});
