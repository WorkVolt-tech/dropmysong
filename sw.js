const CACHE = 'dropmysong-v38-remote-karaoke-tv';
const STATIC_ASSETS = [
  './', './index.html', './dj.html', './host.html', './karaoke.html', './css/styles.css',
  './js/common.js', './js/i18n.js', './js/config.js', './js/supabaseClient.js', './js/linkPreview.js', './js/request.js', './js/dashboard.js', './js/host.js', './js/karaoke-player.js', './js/register-sw.js',
  './assets/drop-my-song-logo.png', './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    ])
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
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
