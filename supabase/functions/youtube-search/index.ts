import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('AUTH_REQUIRED');

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new Error('SERVER_AUTH_MISSING');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error('AUTH_REQUIRED');
  return data.user;
}

async function youtube(path: string, params: Record<string, string>) {
  const key = Deno.env.get('DMS_YOUTUBE_API_KEY') || '';
  if (!key) throw new Error('YOUTUBE_KEY_MISSING');

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error('YouTube API error', response.status, data);
    const message = data?.error?.message || `YouTube API request failed (${response.status})`;
    const error: any = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function validatedVideoDetails(ids: string[]) {
  if (!ids.length) return [];
  const data = await youtube('videos', {
    part: 'snippet,status,contentDetails',
    id: ids.join(','),
  });

  return (data.items || [])
    .filter((item: any) => item?.status?.embeddable === true && item?.status?.privacyStatus === 'public')
    .map((item: any) => ({
      video_id: item.id,
      title: item.snippet?.title || 'YouTube video',
      channel: item.snippet?.channelTitle || '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.default?.url ||
        '',
      duration: item.contentDetails?.duration || '',
      embeddable: true,
      privacy_status: item.status?.privacyStatus || '',
      url: `https://www.youtube.com/watch?v=${item.id}`,
    }));
}

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    try {
      await requireUser(req);
    } catch (error: any) {
      if (error?.message === 'AUTH_REQUIRED') return json({ error: 'Sign in to the DJ Dashboard first.' }, 401);
      return json({ error: 'Could not verify DJ session.' }, 500);
    }

    let body: { action?: string; query?: string; video_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    try {
      const action = body.action === 'validate' ? 'validate' : 'search';

      if (action === 'validate') {
        const videoId = (body.video_id || '').trim();
        if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
          return json({ error: 'Invalid YouTube video ID' }, 400);
        }

        const items = await validatedVideoDetails([videoId]);
        if (!items.length) {
          return json({
            valid: false,
            embeddable: false,
            error: 'This video is not available for embedded playback.',
          });
        }

        return json({ valid: true, embeddable: true, video: items[0] });
      }

      const query = (body.query || '').trim().slice(0, 180);
      if (!query) return json({ error: 'Search query is required' }, 400);

      const search = await youtube('search', {
        part: 'snippet',
        type: 'video',
        maxResults: '8',
        q: query,
        videoEmbeddable: 'true',
        videoSyndicated: 'true',
        safeSearch: 'moderate',
        order: 'relevance',
      });

      const ids = (search.items || [])
        .map((item: any) => item?.id?.videoId)
        .filter(Boolean);

      const validated = await validatedVideoDetails(ids);
      const rank = new Map(ids.map((id: string, index: number) => [id, index]));
      validated.sort((a: any, b: any) => (rank.get(a.video_id) ?? 999) - (rank.get(b.video_id) ?? 999));

      return json({
        query,
        results: validated,
        filtered_for_embedding: true,
      });
    } catch (error: any) {
      console.error('youtube-search function error', error);
      if (error?.message === 'YOUTUBE_KEY_MISSING') {
        return json({ error: 'YouTube API key is not configured in Supabase.' }, 500);
      }
      return json({ error: error?.message || 'YouTube search failed.' }, error?.status || 500);
    }
  },
};
