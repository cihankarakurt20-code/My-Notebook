// Uygulamayı internetsiz de açılabilir yapar.
// İnternet varken her açılışta en yeni sürümü alır, yokken kayıtlı kopyayı açar.
const CACHE = "kalip-defteri-v5";
const FILES = ["./", "./index.html", "./chunks.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Önce internetten yenisini dener, olmazsa kayıtlı kopyayı açar.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Ses dosyaları ve sözlük gibi başka sitelere giden isteklere karışma.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.status === 200){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
