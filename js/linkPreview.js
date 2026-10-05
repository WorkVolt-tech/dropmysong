import { escapeHtml } from './common.js';

const previewCache = new Map();

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function youtubeId(url) {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
  if (host.endsWith('youtube.com')) {
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const parts = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live'].includes(parts[0])) return parts[1] || null;
  }
  return null;
}

function providerFromUrl(url) {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return { key: 'youtube', name: 'YouTube', icon: '▶' };
  if (host === 'open.spotify.com' || host === 'spotify.link' || host.endsWith('.spotify.com')) return { key: 'spotify', name: 'Spotify', icon: '♫' };
  if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return { key: 'soundcloud', name: 'SoundCloud', icon: '☁' };
  if (host === 'music.apple.com' || host.endsWith('.music.apple.com')) return { key: 'apple', name: 'Apple Music', icon: '♪' };
  if (host === 'deezer.com' || host.endsWith('.deezer.com')) return { key: 'deezer', name: 'Deezer', icon: '♫' };
  if (host === 'tidal.com' || host.endsWith('.tidal.com')) return { key: 'tidal', name: 'TIDAL', icon: '◆' };
  if (host.endsWith('bandcamp.com')) return { key: 'bandcamp', name: 'Bandcamp', icon: '♫' };
  if (host.endsWith('audiomack.com')) return { key: 'audiomack', name: 'Audiomack', icon: '♫' };
  return { key: 'link', name: host, icon: '♫' };
}

function fallbackArtwork(provider) {
  const label = provider.name.slice(0, 18);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#00c2ff"/>
          <stop offset="0.48" stop-color="#1677ff"/>
          <stop offset="1" stop-color="#7b2cff"/>
        </linearGradient>
      </defs>
      <rect width="600" height="600" rx="70" fill="#070b12"/>
      <circle cx="300" cy="255" r="160" fill="url(#g)" opacity=".94"/>
      <text x="300" y="300" text-anchor="middle" font-family="Arial, sans-serif" font-size="150" font-weight="700" fill="white">${provider.icon}</text>
      <text x="300" y="505" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="white">${label.replace(/[&<>"']/g, '')}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Preview request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function appleTrackId(url) {
  const fromQuery = url.searchParams.get('i');
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
  const numbers = url.pathname.match(/\d{6,}/g);
  return numbers?.at(-1) || null;
}

function cleanCreator(value = '') {
  return String(value)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .trim();
}

function titleFromPath(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const last = decodeURIComponent(parts.at(-1) || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return last && !/^[a-z0-9]{10,}$/i.test(last) ? last : '';
}

function inferArtistAndTrack(title = '', creator = '') {
  let trackTitle = String(title || '').trim();
  let artistName = cleanCreator(creator);

  // A large number of YouTube/SoundCloud uploads use "Artist - Song".
  const separators = [' - ', ' – ', ' — ', ' | '];
  for (const separator of separators) {
    if (!trackTitle.includes(separator)) continue;
    const [left, ...rest] = trackTitle.split(separator);
    const right = rest.join(separator).trim();
    if (left.trim() && right) {
      artistName = left.trim();
      trackTitle = right
        .replace(/\s*\((official\s+)?(music\s+)?video\).*$/i, '')
        .replace(/\s*\[(official\s+)?(music\s+)?video\].*$/i, '')
        .trim();
      break;
    }
  }

  return { artistName, trackTitle };
}

async function resolveRemotePreview(url, provider) {
  if (provider.key === 'youtube') {
    const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`);
    const inferred = inferArtistAndTrack(data.title || '', data.author_name || '');
    return {
      title: data.title || inferred.trackTitle || '',
      subtitle: inferred.artistName || data.author_name || '',
      trackTitle: inferred.trackTitle || data.title || '',
      artistName: inferred.artistName || cleanCreator(data.author_name || ''),
      imageUrl: data.thumbnail_url || '',
      providerName: data.provider_name || provider.name,
    };
  }

  if (provider.key === 'spotify') {
    const data = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(url.href)}`);
    const inferred = inferArtistAndTrack(data.title || '', data.author_name || '');
    return {
      title: data.title || '',
      subtitle: inferred.artistName || '',
      trackTitle: inferred.trackTitle || data.title || '',
      artistName: inferred.artistName || '',
      imageUrl: data.thumbnail_url || '',
      providerName: data.provider_name || provider.name,
    };
  }

  if (provider.key === 'soundcloud') {
    const data = await fetchJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url.href)}`);
    const inferred = inferArtistAndTrack(data.title || '', data.author_name || '');
    return {
      title: data.title || '',
      subtitle: inferred.artistName || data.author_name || '',
      trackTitle: inferred.trackTitle || data.title || '',
      artistName: inferred.artistName || cleanCreator(data.author_name || ''),
      imageUrl: data.thumbnail_url || '',
      providerName: data.provider_name || provider.name,
    };
  }

  if (provider.key === 'deezer') {
    const data = await fetchJson(`https://api.deezer.com/oembed?url=${encodeURIComponent(url.href)}&format=json`);
    const inferred = inferArtistAndTrack(data.title || '', data.author_name || '');
    return {
      title: data.title || '',
      subtitle: inferred.artistName || data.author_name || '',
      trackTitle: inferred.trackTitle || data.title || '',
      artistName: inferred.artistName || cleanCreator(data.author_name || ''),
      imageUrl: data.thumbnail_url || '',
      providerName: data.provider_name || provider.name,
    };
  }

  if (provider.key === 'apple') {
    const trackId = appleTrackId(url);
    if (!trackId) return null;
    const data = await fetchJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&entity=song`);
    const result = data.results?.find(item => item.wrapperType === 'track') || data.results?.[0];
    if (!result) return null;
    const artwork = result.artworkUrl100 ? result.artworkUrl100.replace(/100x100bb/i, '600x600bb') : '';
    return {
      title: result.trackName || result.collectionName || '',
      subtitle: result.artistName || '',
      trackTitle: result.trackName || result.collectionName || '',
      artistName: result.artistName || '',
      imageUrl: artwork,
      providerName: 'Apple Music',
    };
  }

  return null;
}

export async function getLinkPreview(value, fallback = {}) {
  const url = safeUrl(value);
  if (!url) return null;

  const cacheKey = url.href;
  if (previewCache.has(cacheKey)) {
    const cached = await previewCache.get(cacheKey);
    return {
      ...cached,
      fallbackTitle: fallback.title || cached.fallbackTitle,
      fallbackSubtitle: fallback.subtitle || cached.fallbackSubtitle,
    };
  }

  const task = (async () => {
    const provider = providerFromUrl(url);
    const ytId = provider.key === 'youtube' ? youtubeId(url) : null;

    let preview = {
      url: url.href,
      provider: provider.key,
      providerName: provider.name,
      providerIcon: provider.icon,
      title: '',
      subtitle: '',
      trackTitle: '',
      artistName: '',
      imageUrl: ytId ? `https://i.ytimg.com/vi/${encodeURIComponent(ytId)}/hqdefault.jpg` : '',
      fallbackTitle: fallback.title || '',
      fallbackSubtitle: fallback.subtitle || '',
    };

    try {
      const remote = await resolveRemotePreview(url, provider);
      if (remote) preview = { ...preview, ...remote };
    } catch (error) {
      console.debug('DropMySong link preview fallback:', error?.message || error);
    }

    if (!preview.trackTitle) {
      const inferred = inferArtistAndTrack(preview.title, preview.subtitle);
      preview.trackTitle = inferred.trackTitle || titleFromPath(url) || 'Linked song';
      if (!preview.artistName) preview.artistName = inferred.artistName;
    }

    if (!preview.artistName) {
      preview.artistName = preview.fallbackSubtitle || provider.name;
    }

    if (!preview.title) preview.title = preview.trackTitle;
    if (!preview.subtitle) preview.subtitle = preview.artistName;
    if (!preview.imageUrl) preview.imageUrl = fallbackArtwork(provider);

    return preview;
  })();

  previewCache.set(cacheKey, task);
  const result = await task;
  return {
    ...result,
    fallbackTitle: fallback.title || result.fallbackTitle,
    fallbackSubtitle: fallback.subtitle || result.fallbackSubtitle,
  };
}

function previewHtml(preview, { compact = false, openLabel = '', linked = true } = {}) {
  const title = preview.trackTitle || preview.title || preview.fallbackTitle || preview.providerName;
  const subtitle = preview.artistName || preview.subtitle || preview.fallbackSubtitle || preview.providerName;
  const content = `
    <div class="music-preview-art-wrap">
      <img class="music-preview-art" src="${escapeHtml(preview.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="music-preview-provider provider-${escapeHtml(preview.provider)}">${escapeHtml(preview.providerName)}</span>
    </div>
    <div class="music-preview-info">
      <strong class="music-preview-title">${escapeHtml(title)}</strong>
      ${subtitle ? `<span class="music-preview-subtitle">${escapeHtml(subtitle)}</span>` : ''}
      ${openLabel ? `<span class="music-preview-open">${escapeHtml(openLabel)}</span>` : ''}
    </div>`;

  if (linked) {
    return `<a class="music-preview ${compact ? 'compact' : ''}" href="${escapeHtml(preview.url)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
  }
  return `<div class="music-preview ${compact ? 'compact' : ''}">${content}</div>`;
}

export async function renderLinkPreviewInto(container, value, options = {}) {
  if (!container) return null;
  const url = safeUrl(value);
  if (!url) {
    container.innerHTML = '';
    container.classList.add('hidden');
    delete container.dataset.previewUrl;
    return null;
  }

  const expectedUrl = url.href;
  container.dataset.previewUrl = expectedUrl;
  container.classList.remove('hidden');
  container.innerHTML = `<div class="music-preview preview-loading ${options.compact ? 'compact' : ''}"><div class="music-preview-art music-preview-skeleton"></div><div class="music-preview-info"><span class="preview-line"></span><span class="preview-line short"></span></div></div>`;
  const preview = await getLinkPreview(expectedUrl, { title: options.fallbackTitle, subtitle: options.fallbackSubtitle });
  if (!preview || container.dataset.previewUrl !== expectedUrl) return null;
  container.innerHTML = previewHtml(preview, options);
  return preview;
}

export async function hydrateLinkPreviews(root = document, options = {}) {
  const nodes = [...root.querySelectorAll('[data-song-preview-url]')];
  await Promise.all(nodes.map(async node => {
    const value = node.dataset.songPreviewUrl;
    const localOptions = {
      ...options,
      compact: node.dataset.previewCompact === 'true' || options.compact,
      fallbackTitle: node.dataset.previewTitle || options.fallbackTitle || '',
      fallbackSubtitle: node.dataset.previewSubtitle || options.fallbackSubtitle || '',
      openLabel: node.dataset.previewOpenLabel || options.openLabel || '',
      linked: node.dataset.previewLinked !== 'false',
    };
    await renderLinkPreviewInto(node, value, localOptions);
  }));
}
