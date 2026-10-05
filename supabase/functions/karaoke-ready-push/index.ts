import webpush from 'npm:web-push@3.6.7';
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

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const publishableKey = getDefaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    const secretKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublic = Deno.env.get('DMS_VAPID_PUBLIC_KEY') || '';
    const vapidPrivate = Deno.env.get('DMS_VAPID_PRIVATE_KEY') || '';
    const authHeader = req.headers.get('Authorization') || '';

    if (!supabaseUrl || !publishableKey || !secretKey || !vapidPublic || !vapidPrivate) {
      return Response.json({ error: 'Push service is not configured' }, { status: 500, headers: corsHeaders });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    let body: { request_id?: string } = {};
    try { body = await req.json(); } catch { /* handled below */ }
    if (!body.request_id) return Response.json({ error: 'request_id is required' }, { status: 400, headers: corsHeaders });

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: requestRow, error: requestError } = await admin
      .from('song_requests')
      .select('id,event_id,request_type,artist,song,requester_name,status,guest_token')
      .eq('id', body.request_id)
      .maybeSingle();

    if (requestError || !requestRow) {
      return Response.json({ error: 'Request not found' }, { status: 404, headers: corsHeaders });
    }
    if (requestRow.request_type !== 'karaoke' || requestRow.status !== 'playing') {
      return Response.json({ error: 'Karaoke request is not ready' }, { status: 409, headers: corsHeaders });
    }

    const { data: eventRow } = await admin
      .from('events')
      .select('owner_id')
      .eq('id', requestRow.event_id)
      .maybeSingle();
    if (!eventRow || eventRow.owner_id !== userData.user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth,language,page_url,created_at')
      .eq('request_id', requestRow.id)
      .order('created_at', { ascending: true });

    if (subscriptionsError) {
      return Response.json({ error: subscriptionsError.message }, { status: 500, headers: corsHeaders });
    }

    webpush.setVapidDetails('mailto:admin@dropmysong.app', vapidPublic, vapidPrivate);

    // Keep only the newest record for each browser push endpoint.
    const unique = new Map<string, any>();
    for (const subscription of subscriptions || []) unique.set(subscription.endpoint, subscription);

    let sent = 0;
    const staleIds: string[] = [];
    for (const subscription of unique.values()) {
      const french = subscription.language === 'fr';
      const singer = requestRow.requester_name ? `${requestRow.requester_name}, ` : '';
      const payload = JSON.stringify({
        title: french ? "C'EST À TOI! 🎤" : "YOU'RE UP! 🎤",
        body: french
          ? `${singer}${requestRow.artist} — ${requestRow.song} est prêt. Viens à l'aire de karaoké maintenant.`
          : `${singer}${requestRow.artist} — ${requestRow.song} is ready. Come to the karaoke area now.`,
        tag: `karaoke-${requestRow.id}`,
        url: subscription.page_url || './',
      });

      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 3600 });
        sent += 1;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) staleIds.push(subscription.id);
        else console.error('Push send failed', error);
      }
    }

    if (staleIds.length) await admin.from('push_subscriptions').delete().in('id', staleIds);

    return Response.json({ sent, subscriptions: unique.size }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  },
};
