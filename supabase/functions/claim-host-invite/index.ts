import { createClient } from 'npm:@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const publishableKey = getDefaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    const secretKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization') || '';

    if (!supabaseUrl || !publishableKey || !secretKey) {
      return Response.json({ error: 'Host invite service is not configured' }, { status: 500, headers: corsHeaders });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user || !user.email) {
      return Response.json({ error: 'Sign in before claiming host access' }, { status: 401, headers: corsHeaders });
    }

    let body: { token?: string } = {};
    try { body = await req.json(); } catch {}

    const token = body.token?.trim() || '';
    if (token.length < 20 || token.length > 200) {
      return Response.json({ error: 'Invalid host invite' }, { status: 400, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tokenHash = await sha256Hex(token);
    const { data: invite, error: inviteError } = await admin
      .from('host_invites')
      .select('id,event_id,event_name,event_slug,expires_at,claimed_at,claimed_by,claimed_email')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (inviteError) {
      return Response.json({ error: inviteError.message }, { status: 500, headers: corsHeaders });
    }
    if (!invite) {
      return Response.json({ error: 'Host invite not found' }, { status: 404, headers: corsHeaders });
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return Response.json({ error: 'This host invite has expired' }, { status: 410, headers: corsHeaders });
    }

    const email = user.email.toLowerCase();

    if (invite.claimed_at) {
      const claimedEmail = String(invite.claimed_email || '').toLowerCase();
      const sameHost = invite.claimed_by === user.id || claimedEmail === email;
      if (!sameHost) {
        return Response.json({ error: 'This host invite has already been used' }, { status: 410, headers: corsHeaders });
      }

      return Response.json({
        claimed: true,
        event_id: invite.event_id,
        event_name: invite.event_name,
        event_slug: invite.event_slug,
      }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const claimedAt = new Date().toISOString();
    const { data: claimedInvite, error: claimError } = await admin
      .from('host_invites')
      .update({
        claimed_at: claimedAt,
        claimed_by: user.id,
        claimed_email: email,
      })
      .eq('id', invite.id)
      .is('claimed_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) {
      return Response.json({ error: claimError.message }, { status: 500, headers: corsHeaders });
    }
    if (!claimedInvite) {
      return Response.json({ error: 'This host invite has already been used' }, { status: 410, headers: corsHeaders });
    }

    const defaultName = email.split('@')[0] || 'Host';
    const { error: assignmentError } = await admin
      .from('event_hosts')
      .upsert({
        event_id: invite.event_id,
        host_email: email,
        display_name: defaultName,
        event_name: invite.event_name,
        event_slug: invite.event_slug,
      }, { onConflict: 'event_id,host_email' });

    if (assignmentError) {
      await admin
        .from('host_invites')
        .update({ claimed_at: null, claimed_by: null, claimed_email: null })
        .eq('id', invite.id)
        .eq('claimed_by', user.id);

      return Response.json({ error: assignmentError.message }, { status: 500, headers: corsHeaders });
    }

    return Response.json({
      claimed: true,
      event_id: invite.event_id,
      event_name: invite.event_name,
      event_slug: invite.event_slug,
    }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  },
};
