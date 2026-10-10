/* オフライン動作用 Service Worker（アプリ本体をキャッシュ） */
const CACHE = 'factory-inspection-v3';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/store.js',
  './js/app.js',
  './js/repair.js',
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

  // cache: 'no-cache' で毎回サーバーに最新か確認する（ブラウザに残った古いファイルを使わない）
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)
        .then(hit => hit || caches.match(e.request, { ignoreSearch: true }))
        .then(hit => hit || caches.match('./index.html')))
  );
});
