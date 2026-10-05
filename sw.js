const CACHE = 'dropmysong-v5-payments';
const STATIC_ASSETS = [
  './', './index.html', './dj.html', './css/styles.css',
  './js/common.js', './js/i18n.js', './js/config.js', './js/supabaseClient.js', './js/linkPreview.js', './js/request.js', './js/dashboard.js', './js/register-sw.js',
  './assets/dj-maxo-logo.png', './assets/icon-192.png', './assets/icon-512.png'
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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});
