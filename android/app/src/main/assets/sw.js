const CACHE = 'videodesk-v3';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/style.css', '/app.js', '/icon.svg', '/icon-192.png', '/icon-512.png'])).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])));
self.addEventListener('fetch', event => { if (event.request.method === 'GET' && !event.request.url.includes('/api/')) event.respondWith(fetch(event.request).catch(() => caches.match(event.request))); });
