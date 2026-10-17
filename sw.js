// ネットワーク優先・失敗したらキャッシュ。初段（violin-shodan-）のキャッシュ名と混ぜない（同じドメインに並ぶため）。
const CACHE = 'shodan-kids-v1-20261017e';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shodan-kids-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.open(CACHE).then(c => c.match(e.request))));
});
