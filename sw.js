/* ══════════════════════════════════════════
   FitPack Service Worker — Background Alarms
   ══════════════════════════════════════════
   Stores alarm data and uses setInterval via
   a persistent background thread to fire
   notifications even when browser is closed.
*/
const SW_VERSION = 'fitpack-v1';
let alarms = [];
let userId = null;
let checkInterval = null;

// ── INSTALL / ACTIVATE ──────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
  startChecking();
});

// ── MESSAGE FROM APP ────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SYNC_ALARMS') {
    alarms = e.data.alarms || [];
    userId = e.data.userId || null;
    // Also persist to cache for retrieval after SW restart
    caches.open(SW_VERSION).then(cache => {
      const resp = new Response(JSON.stringify({ alarms, userId }));
      cache.put('/fitpack-alarms', resp);
    });
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
  checkAlarms(); // immediate check
}

function today() {
  return new Date().toISOString().split('T')[0];
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

    const key  = 'fp_sw_fired_' + a.id + '_' + today();
    const cache = await caches.open(SW_VERSION);
    const hit   = await cache.match('/' + key);
    if (hit) continue; // already fired today

    // Mark fired
    await cache.put('/' + key, new Response('1'));

    // Try to show notification
    if (self.Notification && Notification.permission === 'granted') {
      self.registration.showNotification('⏰ FitPack Alarm', {
        body: 'RISE & GRIND! It\'s ' + a.time + ' — time to move, champion! 💪',
        icon: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=192&q=80',
        badge: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=96&q=80',
        tag: 'fitpack-alarm',
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [300, 100, 300, 100, 300],
      });
    }

    // Also message open clients to ring in-app melody
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'RING_ALARM', time: a.time });
    }
  }
}

// ── NOTIFICATION CLICK ──────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: 'RING_ALARM', time: e.notification.body });
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
