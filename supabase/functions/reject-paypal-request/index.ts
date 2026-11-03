import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

// Only the DJ who owns the event can issue a refund.
// Never accept merchant credentials, amounts, or capture IDs from the browser.
const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{...cors,'Content-Type':'application/json'},
});
function serviceKey(){
  const legacy=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(legacy)return legacy;
  try{const data=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
    return String(data.default||Object.values(data)[0]||'');
  }catch{return '';}
}
const paypalBase=()=>Deno.env.get('DMS_PAYPAL_ENVIRONMENT')?.toLowerCase()==='live'
  ? 'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
async function paypalToken(){
  const id=Deno.env.get('DMS_PAYPAL_CLIENT_ID');
  const secret=Deno.env.get('DMS_PAYPAL_CLIENT_SECRET');
  if(!id||!secret)throw Error('PayPal credentials are not configured');
  const response=await fetch(paypalBase()+'/v1/oauth2/token',{
    method:'POST',headers:{
      Authorization:'Basic '+btoa(id+':'+secret),
      'Content-Type':'application/x-www-form-urlencoded',
    },body:'grant_type=client_credentials',
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.access_token)throw Error('PayPal authentication failed');
  return data.access_token as string;
}
async function paypal(path:string,token:string,init:RequestInit={}){
  const headers=new Headers(init.headers);
  headers.set('Authorization','Bearer '+token);
  headers.set('Accept','application/json');
  headers.set('Content-Type','application/json');
  const response=await fetch(paypalBase()+path,{...init,headers});
  const data=await response.json().catch(()=>null);
  if(!response.ok) {
    const error=new Error(data?.message||data?.name||'PayPal request failed');
    (error as any).status=response.status;
    throw error;
  }
  return data;
}
export default {
  async fetch(req:Request){
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
    if(req.method!=='POST')return reply({error:'Method not allowed'},405);
    const url=Deno.env.get('SUPABASE_URL')||'';
    const key=serviceKey();
    if(!url||!key)return reply({error:'Refund service unavailable'},503);
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!jwt)return reply({error:'DJ login required'},401);
    const {data:identity,error:identityError}=await admin.auth.getUser(jwt);
    if(identityError||!identity?.user)return reply({error:'DJ login required'},401);
    let body:{request_id?:string}={};
    try{body=await req.json();}catch{return reply({error:'Invalid request'},400);}
    if(!body.request_id||!/^[-0-9a-f]{36}$/i.test(body.request_id))return reply({error:'Invalid request ID'},400);
    const {data:row,error:readError}=await admin.from('song_requests')
      .select('id,event_id,status,payment_method,payment_status,tip_amount,paypal_order_id,paypal_capture_id,paypal_refund_state,paypal_refund_id,guest_token')
      .eq('id',body.request_id).maybeSingle();
    if(readError)return reply({error:'Request lookup failed'},500);
    if(!row)return reply({error:'Request not found'},404);
    const {data:event,error:eventError}=await admin.from('events')
      .select('owner_id').eq('id',row.event_id).maybeSingle();
    if(eventError||!event||event.owner_id!==identity.user.id)return reply({error:'Only the event owner can reject and refund'},403);

    if(row.paypal_refund_state==='completed' || row.payment_status==='refunded')
      return reply({ok:true,refunded:true,refund_id:row.paypal_refund_id});
    if(row.paypal_refund_state==='pending')
      return reply({ok:true,refund_pending:true,refund_id:row.paypal_refund_id});
    if(row.paypal_refund_state==='processing')
      return reply({error:'A refund is already being processed. Check again shortly.'},409);
    if(row.paypal_refund_state==='needs_review')
      return reply({error:'This refund needs manual review. No second refund will be attempted automatically.'},409);
    if(row.status==='played'||row.status==='playing'||row.status==='rejected')
      return reply({error:'Only unplayed, unrejected requests can be rejected'},409);
    if(!['pending','accepted','cant_find'].includes(row.status))
      return reply({error:'This request cannot be rejected'},409);
    if(row.payment_method!=='paypal')
      return reply({error:'This endpoint refunds PayPal payments only'},409);

    // An unpaid PayPal request has no funds to refund.
    if(row.payment_status!=='confirmed'){
      if(row.paypal_capture_id) return reply({error:'Payment state must be reviewed before rejection'},409);
      const {data:cancelled,error:cancelError}=await admin.from('song_requests')
        .update({status:'rejected',updated_at:new Date().toISOString()})
        .eq('id',row.id).in('status',['pending','accepted','cant_find'])
        .select('id').maybeSingle();
      if(cancelError||!cancelled)return reply({error:'Could not reject unpaid request'},409);
      return reply({ok:true,refunded:false,unpaid:true});
    }
    if(!row.paypal_capture_id||!row.paypal_order_id)
      return reply({error:'Confirmed payment lacks a verified PayPal capture; manual review required'},409);

    // Reserve exactly once; only one parallel request may call PayPal.
    const {data:reserved,error:reserveError}=await admin.from('song_requests')
      .update({paypal_refund_state:'processing',paypal_refund_error:null})
      .eq('id',row.id).eq('paypal_refund_state','none')
      .in('status',['pending','accepted','cant_find'])
      .select('id').maybeSingle();
    if(reserveError||!reserved)return reply({error:'Refund already started or request changed'},409);

    try{
      const token=await paypalToken();
      // Verify the capture with the *current PayPal environment* first.
      // This prevents an old Sandbox capture from being refunded using Live credentials.
      const capture=await paypal('/v2/payments/captures/'+encodeURIComponent(row.paypal_capture_id),token);
      if(capture?.id!==row.paypal_capture_id||capture?.status!=='COMPLETED'
        ||capture?.amount?.currency_code!=='CAD'
        ||Math.round(Number(capture?.amount?.value)*100)!==Math.round(Number(row.tip_amount)*100))
        throw Error('PayPal capture did not match the original CAD payment');
      const refund=await paypal('/v2/payments/captures/'+encodeURIComponent(row.paypal_capture_id)+'/refund',
        token,{
          method:'POST',
          headers:{'PayPal-Request-Id':'dms-refund-'+row.id,'Prefer':'return=representation'},
          body:JSON.stringify({note_to_payer:'Your Drop My Song request was declined. Your payment is being refunded.'}),
        });
      if(!refund?.id||!['COMPLETED','PENDING'].includes(refund.status))
        throw Error('PayPal did not confirm the refund state; review before retrying');
      const complete=refund.status==='COMPLETED';
      const {error:saveError}=await admin.from('song_requests')
        .update({
          paypal_refund_state:complete?'completed':'pending',
          paypal_refund_id:refund.id,
          paypal_refunded_at:complete?new Date().toISOString():null,
          payment_status:complete?'refunded':'refund_pending',
          status:'rejected',
          updated_at:new Date().toISOString(),
        })
        .eq('id',row.id).eq('paypal_refund_state','processing');
      if(saveError)throw Error('PayPal accepted the refund, but saving the result failed: '+saveError.message);
      return reply({ok:true,refunded:complete,refund_pending:!complete,refund_id:refund.id});
    }catch(error){
      // A network error can occur AFTER PayPal accepts a refund. Never automatically
      // retry with a fresh ID: hold for manual reconciliation instead.
      const reason=String(error instanceof Error?error.message:error).slice(0,350);
      await admin.from('song_requests').update({
        paypal_refund_state:'needs_review',paypal_refund_error:reason,
      }).eq('id',row.id).eq('paypal_refund_state','processing');
      console.error('DropMySong PayPal refund needs review',row.id,reason);
      return reply({error:'Refund could not be verified. Request was not rejected. Review the PayPal capture before trying again.'},409);
    }
  }
};
