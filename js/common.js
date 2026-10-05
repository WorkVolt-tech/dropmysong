export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeSong(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function slugify(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isHttpUrl(value = '') {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function relativeTime(iso, language = 'en') {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return language === 'fr' ? "à l'instant" : 'just now';
  if (mins < 60) return language === 'fr' ? `il y a ${mins} min` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return language === 'fr' ? `il y a ${hours} h` : `${hours}h ago`;
  return new Date(iso).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA');
}

export function getOrCreateGuestToken() {
  const key = 'dropmysong_guest_token';
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

export function appBaseUrl() {
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
}

export function buildGuestUrl(slug, type = 'song') {
  const url = new URL('index.html', appBaseUrl());
  url.searchParams.set('event', slug);
  if (type === 'karaoke') url.searchParams.set('type', 'karaoke');
  return url.toString();
}
