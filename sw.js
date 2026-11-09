// オフラインで動かすための Service Worker。
// アプリのファイルを端末にキャッシュし、通信できなくても表示できるようにする。
// アプリのファイルを変えたら CACHE_NAME の番号を上げること (古いキャッシュが消える)。
const CACHE_NAME = 'habit-tracker-v2';
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './habits.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// キャッシュにあればそれを返し、なければ通信する。
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        // オフラインで画面を開いたときは、トップページを返す。
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }),
  );
});
