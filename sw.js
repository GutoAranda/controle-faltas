const CACHE = 'faltae-v83';
const ARQUIVOS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './catalogo-puc-2026-2.json'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ─── web push: lembretes de prova chegam mesmo com o app fechado ─── */
self.addEventListener('push', ev => {
  let dados = {};
  try { dados = ev.data ? ev.data.json() : {}; } catch { /* payload não-JSON: usa padrão */ }
  const titulo = dados.titulo || 'Faltaê';
  ev.waitUntil(self.registration.showNotification(titulo, {
    body: dados.corpo || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: dados.tag || 'faltae',
    data: { url: dados.url || './' }
  }));
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const c of lista) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(ev.notification.data && ev.notification.data.url || './');
    })
  );
});

self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  // chamadas de API (Supabase etc.) vão sempre direto pra rede — cache só para os arquivos do app
  if (new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(
    caches.match(ev.request, { ignoreSearch: true }).then(res =>
      res ||
      fetch(ev.request).then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(ev.request, copia));
        return resp;
      })
    )
  );
});
