// Makes the app open without internet, and shows the notifications.
// With internet it always fetches the newest version; offline it opens the saved copy.
const CACHE = "kalip-defteri-v6";
const FILES = ["./", "./index.html", "./chunks.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./icon-maskable-512.png"];
try { importScripts("chunks.js"); } catch (e) {}

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

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Leave requests to other sites (sound, dictionaries) alone.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});

/* ---------------- notifications ---------------- */
const DAY = 86400000;
const pad = n => String(n).padStart(2, "0");
const dateKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const dayNo = (t = Date.now()) => { const d = new Date(t); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };

function readSnapshot() {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open("my-notebook-meta", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => resolve(null);
      r.onsuccess = () => {
        try {
          const q = r.result.transaction("kv").objectStore("kv").get("snapshot");
          q.onsuccess = () => resolve(q.result || null);
          q.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
    } catch (e) { resolve(null); }
  });
}

function chunkTools() {
  const data = self.CHUNK_DATA || { categories: [], daily: [] };
  const byId = {};
  data.categories.forEach(c => c.items.forEach(i => { byId[i.id] = Object.assign({ cat: c.id }, i); }));
  const dailyIds = [...new Set(data.daily.flatMap(g => g.ids))].filter(id => byId[id]);
  const todays = (n, t) => {
    if (!dailyIds.length) return [];
    const start = (dayNo(t) * 7) % dailyIds.length;
    return Array.from({ length: n }, (_, k) => byId[dailyIds[(start + k * 37) % dailyIds.length]]);
  };
  return { byId, todays };
}

function buildNotification(slot, snap, now = Date.now()) {
  snap = snap || {};
  const cards = snap.cards || [], writes = snap.writes || {}, texts = (snap.texts || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const { byId, todays } = chunkTools();
  const today = dateKey(now), wrote = writes[today] || 0;
  const tc = todays(3, now);
  const learning = cards.filter(c => c.type !== "kelime" && (c.interval || 0) < 21);
  const due = cards.filter(c => (c.due || 0) <= now).length;
  let streak = 0; { let t = now - DAY; while (writes[dateKey(t)]) { streak++; t -= DAY; } }
  const prompt = (snap.prompts || {})[today] || "Write about your day.";
  const latest = texts[0];
  const reading = () => latest
    ? { title: "Reading time", body: "Read 10 minutes of “" + (latest.title || "your text") + "” and add 3 new words to Words.", url: "#read/" + latest.id }
    : { title: "Reading time", body: "Paste a short article or a page from a book and read it for 10 minutes.", url: "#readedit/new" };
  const withTr = c => c.en + (c.tr ? " (" + c.tr + ")" : "");

  switch (slot) {
    case 9: {
      const c = tc[0];
      if (!c) return { title: "Good morning", body: "Open your notebook and pick today's chunks.", url: "#daily" };
      return { title: "Today's chunk: " + c.en, body: c.tr + "\n" + (c.ex && c.ex[0] ? c.ex[0] + "\n" : "") + "Try to use it at least once today.", url: "#daily" };
    }
    case 14: {
      const pool = learning.length ? learning : tc;
      const c = pool[(dayNo(now) * 7 + 3) % pool.length];
      if (!c) return reading();
      const cat = c.chunkId && byId[c.chunkId] ? byId[c.chunkId].cat : (c.cat || null);
      return { title: "Chunk practice", body: "Make your own sentence with “" + c.en + "”" + (c.tr ? " (" + c.tr + ")" : "") + ". Say it out loud twice.", url: cat ? "#chunk/" + cat : "#chunks" };
    }
    case 16:
      return reading();
    case 21:
      if (!wrote) return { title: "Writing time", body: "Today's topic: " + prompt + (tc[0] ? "\nTry to use “" + tc[0].en + "”." : ""), url: "#writing" };
      return { title: "Nice writing today", body: "You wrote " + wrote + " words. Read it out loud once and improve one sentence.", url: "#writing" };
    case 22:
      if (due) return { title: due + (due === 1 ? " card is" : " cards are") + " waiting", body: "Review your chunks and words before bed. It takes about 5 minutes.", url: "#words" };
      return { title: "Reviews done", body: "Add 5 new chunks so you have something to review tomorrow.", url: "#chunks" };
    case 23:
      if (!wrote) return { title: "Writing: last hour", body: streak ? "Your " + streak + "-day streak ends at midnight. A short paragraph is enough." : "Write 3–4 sentences about your day before midnight.", url: "#writing" };
      return Object.assign(reading(), { title: "One more page?" });
    case 0: {
      const pool = (learning.length >= 3 ? learning.slice(0, 3) : tc);
      return { title: "Say them out loud", body: "Before you sleep, say each one in a sentence:\n" + pool.map(withTr).join("\n"), url: "#daily" };
    }
    default:
      return { title: "My Notebook", body: tc[0] ? "Today's chunk: " + withTr(tc[0]) : "Time for some English.", url: "" };
  }
}

self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let slot = new Date().getHours();
    try { const d = e.data && e.data.json(); if (d && typeof d.slot === "number") slot = d.slot; } catch (err) {}
    const snap = await readSnapshot();
    const n = buildNotification(slot, snap);
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: "my-notebook-" + slot,
      data: { url: n.url },
    });
    try {
      const due = ((snap && snap.cards) || []).filter(c => (c.due || 0) <= Date.now()).length;
      if (self.navigator.setAppBadge) due ? await self.navigator.setAppBadge(due) : await self.navigator.clearAppBadge();
    } catch (err) {}
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL("./" + ((e.notification.data && e.notification.data.url) || ""), self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        try { await c.focus(); } catch (err) {}
        try { await c.navigate(target); } catch (err) { c.postMessage({ go: (e.notification.data && e.notification.data.url) || "" }); }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// lets the app show a sample notification to check that they appear
self.addEventListener("message", e => {
  if (e.data && e.data.type === "sample") {
    e.waitUntil(readSnapshot().then(snap => {
      const n = buildNotification(e.data.slot, snap);
      return self.registration.showNotification(n.title, { body: n.body, icon: "icon-192.png", tag: "my-notebook-sample", data: { url: n.url } });
    }));
  }
});
