// Mode hors ligne : la page et la liste restent consultables sans réseau (magasin, cave…).
const CACHE = 'courses-v15';
const ASSETS = ['assets/style.css?v=15', 'assets/app.js?v=15', 'assets/icon.svg', 'manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const path = url.pathname;

  // page et données : réseau d'abord, copie en cache pour le hors ligne
  if (path.endsWith('/') || path.endsWith('/index.php') || path.endsWith('/api.php')) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return r;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match(new URL('index.php', self.registration.scope).href)).then((r) => r || caches.match(self.registration.scope)))
    );
    return;
  }
  // fichiers statiques : cache d'abord
  if (path.includes('/assets/') || path.endsWith('/manifest.json')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
