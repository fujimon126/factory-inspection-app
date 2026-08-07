/* オフライン動作用 Service Worker（アプリ本体をキャッシュ） */
const CACHE = 'factory-inspection-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/store.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ネットワーク優先：常に最新のアプリを表示し、通信できないときだけキャッシュを使う。
   （キャッシュ優先にすると、アプリを更新しても古い画面が表示され続けるため） */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // スプレッドシート通信はキャッシュ対象外
  if (e.request.method !== 'GET' || url.hostname.includes('script.google')) return;
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
