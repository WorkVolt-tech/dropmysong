import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type':'application/json' } });
}
function secret(primary: string, legacy: string) {
  const fallback = Deno.env.get(legacy);
  if (fallback) return fallback;
  const raw = Deno.env.get(primary) || '';
  try { const parsed = JSON.parse(raw); return String(parsed.default || Object.values(parsed)[0] || ''); }
  catch { return raw; }
}
async function hashToken(value: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(data)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
function videoId(link: string) {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^www\./,'').toLowerCase();
    const value = host === 'youtu.be' ? url.pathname.split('/')[1] :
      ['youtube.com','m.youtube.com','music.youtube.com'].includes(host)
        ? url.pathname === '/watch' ? url.searchParams.get('v') :
          ['embed','shorts','live'].includes(url.pathname.split('/')[1]) ? url.pathname.split('/')[2] : ''
        : '';
    return /^[A-Za-z0-9_-]{11}$/.test(value || '') ? value : null;
  } catch { return null; }
}
export default {
  async fetch(req: Request) {
    if(req.method === 'OPTIONS') return new Response('ok', { headers:cors });
    if(req.method !== 'POST') return json({error:'Method not allowed'},405);
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = secret('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
    if(!url || !serviceKey) return json({error:'Service unavailable'},500);
    const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    let body: {event_id?:string;request_id?:string;invite_token?:string} = {};
    try { body=await req.json(); } catch { return json({error:'Invalid request'},400); }
    if(!body.event_id || !body.request_id) return json({error:'Event and singer are required'},400);

    let authorized = false;
    if(body.invite_token && body.invite_token.length >= 20 && body.invite_token.length <= 200) {
      const {data} = await admin.from('host_invites')
        .select('event_id,expires_at').eq('token_hash',await hashToken(body.invite_token)).maybeSingle();
      authorized = !!data && data.event_id === body.event_id && Date.parse(data.expires_at) > Date.now();
    }
    if(!authorized && !body.invite_token) {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
      if(token) {
        const {data:userData} = await admin.auth.getUser(token);
        const email = userData?.user?.email?.toLowerCase();
        if(email) {
          const {data:assignment} = await admin.from('event_hosts')
            .select('id').eq('event_id',body.event_id).ilike('host_email',email).limit(1).maybeSingle();
          authorized=!!assignment;
        }
      }
    }
    if(!authorized) return json({error:'MC access not authorized for this event'},403);

    const {data:request,error} = await admin.from('song_requests')
      .select('id,event_id,request_type,status,song_url,karaoke_video_url')
      .eq('id',body.request_id).eq('event_id',body.event_id).maybeSingle();
    if(error) return json({error:error.message},500);
    if(!request || request.request_type !== 'karaoke' || request.status !== 'playing')
      return json({error:'This singer has not been called by the DJ'},409);
    if(!videoId(request.karaoke_video_url || request.song_url || ''))
      return json({error:'DJ must assign a valid YouTube karaoke video first'},409);
    const message = {
      action:'play',event_id:body.event_id,request_id:body.request_id,sent_at:Date.now(),source:'mc'
    };
    const sent = await fetch(url + '/realtime/v1/api/broadcast', {
      method:'POST',
      headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},
      body:JSON.stringify({messages:[{
        topic:'dropmysong-karaoke-remote-'+body.event_id,
        event:'karaoke-control',payload:message,private:false
      }]}),
    });
    if(!sent.ok) {
      console.error('MC karaoke broadcast failed',sent.status,await sent.text());
      return json({error:'Could not signal Karaoke TV. Confirm the TV is online.'},502);
    }
    return json({ok:true,action:'play',request_id:body.request_id});
  }
};
