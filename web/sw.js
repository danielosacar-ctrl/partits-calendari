// Service worker mínim: la web s'obre encara que no hi hagi cobertura.
// Les dades (/api, /cal.ics) sempre van a la xarxa perquè han d'estar al dia.
const C = 'partits-v2';
const SHELL = ['./', 'manifest.webmanifest', 'icon.svg', 'config.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.includes('/api') || u.pathname.endsWith('.ics')) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('./'))));
});
