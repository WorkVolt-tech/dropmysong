const CACHE = 'dropmysong-v40-manual-youtube-fix';
const STATIC_ASSETS = [
  './', './index.html', './dj.html', './host.html', './karaoke.html', './css/styles.css',
  './js/common.js', './js/i18n.js', './js/config.js', './js/supabaseClient.js', './js/linkPreview.js', './js/request.js', './js/dashboard.js', './js/host.js', './js/karaoke-player.js', './js/register-sw.js',
  './assets/drop-my-song-logo.png', './assets/icon-192.png', './assets/icon-512.png'
];

async function cacheFreshAssets() {
  const cache = await caches.open(CACHE);
  await Promise.all(STATIC_ASSETS.map(async asset => {
    const request = new Request(asset, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Could not cache ${asset}: ${response.status}`);
    await cache.put(request, response.clone());
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(
    cacheFreshAssets().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('dropmysong-') && key !== CACHE)
          .map(key => caches.delete(key))
      )),
    ])
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response && response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      const cached = await caches.match(event.request)
        || await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      if (event.request.mode === 'navigate') {
        return (await caches.match('./index.html')) || Response.error();
      }

      return Response.error();
    }
  })());
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const title = payload.title || "You're up! 🎤";
  const options = {
    body: payload.body || 'Your karaoke song is ready. Please come to the DJ area now.',
    icon: './assets/icon-192.png',
    badge: './assets/icon-192.png',
    tag: payload.tag || 'drop-my-song-karaoke',
    renotify: true,
    data: { url: payload.url || './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const targetUrl = event.notification?.data?.url || './';
      const existing = clients.find(client => 'focus' in client && client.url === new URL(targetUrl, self.location.origin).href)
        || clients.find(client => 'focus' in client);
      if (existing) {
        if ('navigate' in existing) existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
