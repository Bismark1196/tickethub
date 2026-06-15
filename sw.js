/* VendHub Service Worker v1.0 */
const CACHE = 'vendhub-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/apply.html',
  '/payment.html',
  '/success.html',
  '/images/gr.jpeg',
  '/images/header.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=DM+Sans:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  /* Firebase requests — always network first */
  if (e.request.url.includes('firestore') ||
      e.request.url.includes('firebase') ||
      e.request.url.includes('googleapis.com/identitytoolkit')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  /* Static assets — cache first, fall back to network */
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(response => {
      if (response.ok && e.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return response;
    })).catch(() => caches.match('/index.html'))
  );
});

/* Push notifications */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'VendHub', body: 'You have a new message.' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'VendHub', {
      body: data.body || 'Tap to open.',
      icon: '/images/icon-192.png',
      badge: '/images/icon-192.png',
      data: { url: data.url || '/index.html' },
      actions: [{ action: 'open', title: 'Open Chat' }]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/index.html';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const existing = list.find(c => c.url.includes(self.location.origin));
    if (existing) { existing.focus(); existing.navigate(url); }
    else clients.openWindow(url);
  }));
});