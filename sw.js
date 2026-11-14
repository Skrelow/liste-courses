// Mode hors ligne (la page reste consultable sans réseau) et notifications « Robin a ajouté… ».
const CACHE = 'courses-v16';
const ASSETS = ['assets/style.css?v=16', 'assets/app.js?v=16', 'assets/icon.svg', 'manifest.json'];

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

  // page : réseau d'abord, copie en cache pour le hors ligne (les données, elles, sont gardées par l'appli)
  if (path.endsWith('/') || path.endsWith('/index.php')) {
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

// Notification reçue (message vide) : on demande au site ce qui a été ajouté, puis on l'affiche.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let n = { title: '🛒 Courses', body: 'La liste de courses a changé.' };
    try {
      const r = await fetch(new URL('api.php?notif=1', self.registration.scope).href, { credentials: 'include', cache: 'no-store' });
      if (r.ok) n = await r.json();
    } catch {}
    await self.registration.showNotification(n.title, {
      body: n.body,
      tag: 'courses', // une seule notification à la fois, remplacée par la plus récente
      renotify: true,
      icon: new URL('assets/icon.svg', self.registration.scope).href,
      badge: new URL('assets/icon.svg', self.registration.scope).href,
      data: { url: self.registration.scope },
    });
  })());
});

// Toucher la notification ouvre l'appli (ou la remet au premier plan).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); win.postMessage('refresh'); return; }
    await self.clients.openWindow(e.notification.data?.url || self.registration.scope);
  })());
});
