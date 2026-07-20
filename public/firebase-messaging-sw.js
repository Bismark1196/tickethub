/* firebase-messaging-sw.js
 * Must be served from the SITE ROOT (e.g. https://yourdomain.com/firebase-messaging-sw.js)
 * — Firebase Messaging requires the default scope, so don't put it in a subfolder
 *   unless you also pass {scope: '/'} when registering it (done in notifications.js).
 *
 * This file cannot use ES modules, so we load the compat SDK via importScripts.
 */

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Same config as index.html — must match exactly.
firebase.initializeApp({
  apiKey: "AIzaSyAQ-GT_LdGUfoFUw_-CCT-i2k_Ju1DKYCA",
  authDomain: "vendors-de792.firebaseapp.com",
  projectId: "vendors-de792",
  storageBucket: "vendors-de792.appspot.com",
  messagingSenderId: "1037672442570",
  appId: "1:1037672442570:web:5f8d0c8e9f7e5d0c3e8d0c"
});

const messaging = firebase.messaging();

// Fires when a push arrives while no VendHub tab has focus (app closed/backgrounded).
// Foreground messages (app open in an active tab) are handled separately in
// notifications.js via onMessage(), NOT here.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'VendHub';
  const options = {
    body: data.body || 'You have a new message.',
    icon: '/icon-192.png',       // swap for your actual icon path
    badge: '/icon-badge.png',    // small monochrome badge icon, optional
    tag: data.tag || 'vendhub-chat',   // collapses rapid duplicate notifications from the same thread
    renotify: true,
    data: {
      convType: data.convType || '',
      convId: data.convId || '',
      url: data.url || '/'
    }
  };
  self.registration.showNotification(title, options);
});

// Clicking the notification focuses/opens VendHub and deep-links into the right thread.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'VENDHUB_NOTIFICATION_CLICK',
            convType: event.notification.data.convType,
            convId: event.notification.data.convId
          });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});