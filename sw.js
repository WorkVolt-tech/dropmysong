const CACHE = 'dropmysong-v1';
const STATIC_ASSETS = [
  './', './index.html', './dj.html', './css/styles.css',
  './js/common.js', './js/config.js', './js/supabaseClient.js', './js/request.js', './js/dashboard.js',
  './assets/dj-maxo-logo.png', './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
