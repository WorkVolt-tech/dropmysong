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

function decodeHtml(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function metaContent(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const metaKey = attr(tag, 'property') || attr(tag, 'name');
    if (metaKey.toLowerCase() === key.toLowerCase()) return attr(tag, 'content');
  }
  return '';
}

function pageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].replace(/<[^>]+>/g, '')) : '';
}

function namesFromArtistValue(value: any): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(namesFromArtistValue);
  if (typeof value === 'object') {
    if (typeof value.name === 'string') return [value.name.trim()].filter(Boolean);
    return Object.values(value).flatMap(namesFromArtistValue);
  }
  return [];
}

function findMusicRecording(value: any): any | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMusicRecording(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some(type => String(type || '').toLowerCase() === 'musicrecording')) return value;

  for (const child of Object.values(value)) {
    const found = findMusicRecording(child);
    if (found) return found;
  }
  return null;
}

function spotifyJsonLd(html: string) {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      const recording = findMusicRecording(parsed);
      if (!recording) continue;
      const artists = namesFromArtistValue(recording.byArtist || recording.artist);
      return {
        trackTitle: typeof recording.name === 'string' ? recording.name.trim() : '',
        artistName: artists.join(', '),
        imageUrl: typeof recording.image === 'string'
          ? recording.image
          : Array.isArray(recording.image)
            ? String(recording.image[0] || '')
            : typeof recording.image?.url === 'string'
              ? recording.image.url
              : '',
      };
    } catch {}
  }
  return { trackTitle: '', artistName: '', imageUrl: '' };
}

function artistFromSpotifyTitle(title: string) {
  const patterns = [
    /\s[-–—]\s(?:song and lyrics by|music and lyrics by|lyrics by)\s(.+?)\s\|\sSpotify$/i,
    /\s[-–—]\s(?:chanson et paroles de|paroles de)\s(.+?)\s\|\sSpotify$/i,
    /\s[-–—]\s(?:canción y letra de|música y letra de)\s(.+?)\s\|\sSpotify$/i,
    /\s[-–—]\s(?:música e letra de)\s(.+?)\s\|\sSpotify$/i,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function trackFromSpotifyTitle(title: string) {
  return title
    .replace(/\s[-–—]\s(?:song and lyrics by|music and lyrics by|lyrics by|chanson et paroles de|paroles de|canción y letra de|música y letra de|música e letra de)\s.+?\s\|\sSpotify$/i, '')
    .replace(/\s\|\sSpotify$/i, '')
    .trim();
}

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body: { url?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL((body.url || '').trim());
    } catch {
      return json({ error: 'Invalid URL' }, 400);
    }

    const sourceHost = sourceUrl.hostname.replace(/^www\./, '').toLowerCase();
    if (!['open.spotify.com', 'spotify.link'].includes(sourceHost) && !sourceHost.endsWith('.spotify.com')) {
      return json({ error: 'Only Spotify links are supported' }, 400);
    }

    try {
      const response = await fetch(sourceUrl.toString(), {
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 DropMySong/1.0',
        },
      });

      if (!response.ok) {
        return json({ error: `Spotify metadata request failed (${response.status})` }, 502);
      }

      const finalUrl = new URL(response.url || sourceUrl.toString());
      const finalHost = finalUrl.hostname.replace(/^www\./, '').toLowerCase();
      if (finalHost !== 'open.spotify.com' && !finalHost.endsWith('.spotify.com')) {
        return json({ error: 'Spotify link redirected outside Spotify' }, 400);
      }

      const html = await response.text();
      const structured = spotifyJsonLd(html);
      const title = pageTitle(html);
      const ogTitle = metaContent(html, 'og:title');
      const ogImage = metaContent(html, 'og:image');

      const trackTitle = structured.trackTitle || ogTitle || trackFromSpotifyTitle(title);
      const artistName = structured.artistName || artistFromSpotifyTitle(title);

      return json({
        provider: 'spotify',
        trackTitle: trackTitle || '',
        artistName: artistName || '',
        imageUrl: structured.imageUrl || ogImage || '',
        canonicalUrl: finalUrl.toString(),
      });
    } catch (error: any) {
      console.error('Spotify metadata error', error);
      return json({ error: error?.message || 'Could not read Spotify metadata' }, 500);
    }
  },
};
