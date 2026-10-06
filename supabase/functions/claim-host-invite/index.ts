import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getDefaultKey(jsonName: string, legacyName: string) {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;

  const raw = Deno.env.get(jsonName);
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || '';
  } catch {
    return '';
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Host QR service is missing its Supabase service key' }, 500);
    }

    let body: {
      token?: string;
      action?: string;
      request_id?: string;
      host_name?: string;
    } = {};

    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    const token = body.token?.trim() || '';
    const action = body.action?.trim() || 'bootstrap';

    if (token.length < 20 || token.length > 200) {
      return json({ error: 'Invalid host invite' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const tokenHash = await sha256Hex(token);

    const { data: invite, error: inviteError } = await admin
      .from('host_invites')
      .select('id,event_id,event_name,event_slug,expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (inviteError) return json({ error: inviteError.message }, 500);
    if (!invite) return json({ error: 'Host invite not found' }, 404);

    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return json({ error: 'This host QR has expired' }, 410);
    }

    if (action === 'bootstrap') {
      return json({
        event_id: invite.event_id,
        event_name: invite.event_name,
        event_slug: invite.event_slug,
        expires_at: invite.expires_at,
        multi_host: true,
      });
    }

    if (action === 'queue') {
      const [{ data: requests, error: requestError }, { data: calls, error: callsError }] = await Promise.all([
        admin
          .from('song_requests')
          .select('id,event_id,request_type,artist,song,requester_name,status,sort_order,created_at,updated_at')
          .eq('event_id', invite.event_id)
          .in('status', ['pending', 'accepted', 'playing', 'cant_find'])
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        admin
          .from('host_calls')
          .select('request_id,called_at,host_email')
          .eq('event_id', invite.event_id),
      ]);

      if (requestError) return json({ error: requestError.message }, 500);
      if (callsError) return json({ error: callsError.message }, 500);

      return json({
        event_id: invite.event_id,
        event_name: invite.event_name,
        event_slug: invite.event_slug,
        expires_at: invite.expires_at,
        requests: requests || [],
        calls: calls || [],
      });
    }

    if (action === 'mark_called') {
      const requestId = body.request_id?.trim() || '';
      const hostName = (body.host_name?.trim() || 'Host').slice(0, 80);

      if (!requestId) return json({ error: 'request_id is required' }, 400);

      const { data: requestRow, error: requestError } = await admin
        .from('song_requests')
        .select('id,event_id')
        .eq('id', requestId)
        .eq('event_id', invite.event_id)
        .maybeSingle();

      if (requestError) return json({ error: requestError.message }, 500);
      if (!requestRow) return json({ error: 'Request not found for this event' }, 404);

      const { data: existing, error: existingError } = await admin
        .from('host_calls')
        .select('request_id,called_at,host_email')
        .eq('request_id', requestId)
        .maybeSingle();

      if (existingError) return json({ error: existingError.message }, 500);
      if (existing) return json({ called: true, call: existing });

      const { data: call, error: callError } = await admin
        .from('host_calls')
        .insert({
          request_id: requestId,
          event_id: invite.event_id,
          host_email: hostName,
        })
        .select('request_id,called_at,host_email')
        .single();

      if (callError && callError.code !== '23505') {
        return json({ error: callError.message }, 500);
      }

      if (!call && callError?.code === '23505') {
        const { data: duplicate, error: duplicateError } = await admin
          .from('host_calls')
          .select('request_id,called_at,host_email')
          .eq('request_id', requestId)
          .maybeSingle();

        if (duplicateError) return json({ error: duplicateError.message }, 500);
        return json({ called: true, call: duplicate || null });
      }

      return json({ called: true, call });
    }

    return json({ error: 'Unknown action' }, 400);
  },
};
