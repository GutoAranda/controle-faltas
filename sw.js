const CACHE = 'faltae-v21';
const ARQUIVOS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

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
