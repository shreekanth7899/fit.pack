/* ══════════════════════════════════════════════════
   FitPack Service Worker
   • Offline app-shell caching (PWA installable)
   • Background alarm checking (works app-closed)
   • Cache-first for static assets, network-first
     for Firebase/API calls
   ══════════════════════════════════════════════════ */

const SW_VERSION   = 'fitpack-v2';
const STATIC_CACHE = 'fitpack-static-v2';

// App shell — cached on install for offline support
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

let alarms = [];
let userId = null;
let checkInterval = null;

// ── INSTALL — cache app shell ───────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      Promise.all(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.warn('Cache skip:', url, err.message))
        )
      )
    )
  );
});

// ── ACTIVATE — clean old caches, start alarm loop ──
self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(
          keys.filter(k => k !== STATIC_CACHE && k !== SW_VERSION)
              .map(k => caches.delete(k))
        )
      ),
    ])
  );
  startChecking();
});

// ── FETCH — cache-first for app shell, network for rest ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache Firebase / Google API calls — always go to network
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('firebasedatabase.app')) {
    return; // let browser handle normally
  }

  // Only handle GET requests for same-origin app shell files
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // Cache successful same-origin responses for offline reuse
        if (resp.ok && url.origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => {
        // Offline fallback to index.html for navigation requests
        if (e.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});

// ── MESSAGE FROM APP ─────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SYNC_ALARMS') {
    alarms = e.data.alarms || [];
    userId = e.data.userId || null;
    caches.open(SW_VERSION).then(cache => {
      const resp = new Response(JSON.stringify({ alarms, userId }));
      cache.put('/fitpack-alarms', resp);
    });
  }
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── RESTORE ALARMS ON SW START ──────────────
async function restoreAlarms() {
  try {
    const cache = await caches.open(SW_VERSION);
    const resp  = await cache.match('/fitpack-alarms');
    if (resp) {
      const data = await resp.json();
      alarms = data.alarms || [];
      userId = data.userId || null;
    }
  } catch(e) {}
}

// ── ALARM CHECK LOOP ────────────────────────
function startChecking() {
  restoreAlarms();
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkAlarms, 15000); // every 15s
  checkAlarms();
}

// FIX: Local date, not UTC — matches app.js today()
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

async function checkAlarms() {
  if (!alarms.length) return;
  const now  = new Date();
  const hh   = String(now.getHours()).padStart(2, '0');
  const mm   = String(now.getMinutes()).padStart(2, '0');
  const cur  = hh + ':' + mm;
  const day  = now.getDay();

  for (const a of alarms) {
    if (!a.active) continue;
    if (a.time !== cur) continue;
    if (!a.days.includes(day)) continue;

    const key   = 'fp_sw_fired_' + a.id + '_' + today();
    const cache = await caches.open(SW_VERSION);
    const hit   = await cache.match('/' + key);
    if (hit) continue; // already fired today

    await cache.put('/' + key, new Response('1'));

    if (self.Notification && Notification.permission === 'granted') {
      self.registration.showNotification('⏰ FitPack Alarm', {
        body: "RISE & GRIND! It's " + a.time + " — time to move, champion! 💪",
        icon: './icons/icon-192.png',
        badge: './icons/icon-96.png',
        tag: 'fitpack-alarm-' + a.id,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [300, 100, 300, 100, 300],
        data: { time: a.time },
      });
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'RING_ALARM', time: a.time });
    }
  }
}

// ── NOTIFICATION CLICK ───────────────────────
self.addEventListener('notificationclick', e => {
  const time = e.notification.data?.time || '';
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
        clientList[0].postMessage({ type: 'RING_ALARM', time });
      } else {
        self.clients.openWindow('./index.html');
      }
    })
  );
});
