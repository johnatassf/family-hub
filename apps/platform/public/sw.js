// Service worker mínimo do PWA: deixa o app instalável e mostra uma página amigável quando não há internet.
// De propósito, NÃO guarda respostas da API (dados financeiros ficam fora do aparelho) nem o código do app
// (cada publicação nova vale na hora, sem versão velha presa no cache).
const CACHE = 'familia-offline-v2';
// Sem ".html": a Cloudflare redireciona /offline.html → /offline, e resposta redirecionada não pode
// ser entregue ao abrir uma página pelo service worker.
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Só a abertura de páginas; API, scripts e estilos vão direto para a rede.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()));
});
