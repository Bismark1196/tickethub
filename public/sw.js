/* ═══════════════════════════════════════════════
   VendHub Service Worker v3.0
   — Full offline caching
   — Push notifications with home screen badge
   — Notification click → open/focus chat
═══════════════════════════════════════════════ */

const STATIC_CACHE  = 'vendhub-static-v3';
const DYNAMIC_CACHE = 'vendhub-dynamic-v3';
const ALL_CACHES    = [STATIC_CACHE, DYNAMIC_CACHE];

const PRECACHE_URLS = [
  '/index.html', '/apply.html', '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// ── INSTALL ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(c => c.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(e => console.warn('[SW] Precache error:', e))
  );
});

// ── ACTIVATE ────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  const isFirebase =
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firestore.googleapis.com');

  if (isFirebase || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() =>
      new Response(JSON.stringify({ offline: true }), {
        status: 503, headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  if (/\.(jpe?g|png|webp|avif|gif|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) caches.open(DYNAMIC_CACHE).then(c => c.put(request, res.clone()));
          return res;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  const isHTML = request.headers.get('accept')?.includes('text/html') ||
    url.pathname.endsWith('.html') || url.pathname === '/';

  if (isHTML) {
    event.respondWith(
      fetch(request).then(res => {
        if (res.ok) caches.open(DYNAMIC_CACHE).then(c => c.put(request, res.clone()));
        return res;
      }).catch(() =>
        caches.match(request).then(cached => cached || caches.match('/index.html'))
      )
    );
    return;
  }

  event.respondWith(
    caches.open(DYNAMIC_CACHE).then(cache =>
      cache.match(request).then(cached => {
        const network = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        });
        return cached || network;
      })
    )
  );
});

// ── PUSH NOTIFICATION ───────────────────────────
self.addEventListener('push', event => {
  let data = {
    title: '💬 VendHub',
    body:  'You have a new message from your Event Coordinator.',
    url:   '/index.html',
    tag:   'vendhub-chat',
    icon:  '/images/icon-192.png',
    badge: '/images/icon-192.png',
    count: 1,
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    if (event.data) data.body = event.data.text();
  }

  // Update home screen badge number
  if ('setAppBadge' in navigator) {
    navigator.setAppBadge(data.count || 1).catch(() => {});
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon,
      badge:   data.badge,
      tag:     data.tag,
      data:    { url: data.url },
      vibrate: [100, 50, 100, 50, 100],
      requireInteraction: false,
      renotify: true,
      silent:  false,
      actions: [
        { action: 'open',    title: '💬 Open Chat' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// ── NOTIFICATION CLICK ──────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') {
    if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
    return;
  }

  const targetUrl = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        const existing = windowClients.find(c =>
          c.url.startsWith(self.location.origin) && 'focus' in c
        );
        if (existing) return existing.focus().then(c => c.navigate(targetUrl));
        return clients.openWindow(targetUrl);
      })
  );
});

// ── MESSAGES FROM PAGE ──────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  switch (event.data.type) {
    case 'CLEAR_BADGE':
      if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
      break;
    case 'SET_BADGE':
      if ('setAppBadge' in navigator && event.data.count > 0)
        navigator.setAppBadge(event.data.count).catch(() => {});
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});