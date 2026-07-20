/* notifications.js
 * Client-side push notification wiring for VendHub.
 *
 * HOW TO WIRE THIS INTO index.html:
 *   1. Add near your other Firebase imports at the top of the <script type="module"> block:
 *
 *        import { getMessaging, getToken, onMessage, isSupported }
 *          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
 *        import { doc, setDoc, arrayUnion, arrayRemove, updateDoc }
 *          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
 *          (updateDoc/arrayUnion/arrayRemove/setDoc/doc likely already imported — dedupe)
 *
 *   2. Paste the contents of this file's function bodies in after `app`, `auth`, `db`
 *      are defined (they rely on those exact variable names).
 *
 *   3. Call initPushNotifications() once, right after onAuthStateChanged fires with a
 *      logged-in user (inside the `if (user) { ... }` branch, alongside
 *      subscribeApplications/subscribeMyListings/subscribePurchases).
 *
 *   4. Call teardownPushNotifications() in the `else` (logged-out) branch — it removes
 *      this device's token from Firestore so a shared/public computer stops getting
 *      this user's notifications after logout.
 *
 * VAPID KEY:
 *   Firebase Console → Project settings → Cloud Messaging → Web configuration →
 *   "Generate key pair". Paste the public key below.
 */

const VAPID_KEY = "BLptISn7AZzXqUGzqLKdNQYo78FiYHVuX9YqJqdeLRqQg1WllVj4S6Pq_QDWpCvu0bmFmToSuI0FrmVbqROW5Ww";

let messagingInstance = null;
let currentDeviceToken = null;

/** Call once after a user is authenticated. Safe to call multiple times (idempotent-ish). */
async function initPushNotifications() {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.log('Push notifications not supported in this browser.');
      return;
    }

    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.log('FCM not supported in this browser/context (e.g. private browsing, some iOS versions).');
      return;
    }

    // Register the service worker from the site root.
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });

    messagingInstance = getMessaging(app);

    // Foreground messages: the OS-level notification is NOT shown automatically when
    // the tab is focused, so we render our own in-app toast + optionally a Notification.
    onMessage(messagingInstance, (payload) => {
      handleForegroundMessage(payload);
    });

    // Relay notification-click messages coming from the service worker into in-app navigation.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'VENDHUB_NOTIFICATION_CLICK') {
        handleNotificationNavigation(event.data.convType, event.data.convId);
      }
    });

    await requestPermissionAndRegisterToken(registration);
  } catch (err) {
    console.error('initPushNotifications error:', err);
  }
}

/** Prompts for permission (if not already decided) and stores the FCM token. */
async function requestPermissionAndRegisterToken(registration) {
  if (Notification.permission === 'denied') {
    console.log('Notifications are blocked at the browser level; not prompting.');
    return;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    console.log('Notification permission not granted.');
    return;
  }

  try {
    const token = await getToken(messagingInstance, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });
    if (!token) {
      console.log('No FCM token available (permission may have changed).');
      return;
    }
    currentDeviceToken = token;
    await saveTokenToFirestore(token);
  } catch (err) {
    console.error('getToken error:', err);
  }
}

/** Persists the token under fcm_tokens/{uid}, keyed by array so multi-device works. */
async function saveTokenToFirestore(token) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(
      doc(db, 'fcm_tokens', user.uid),
      {
        uid: user.uid,
        email: user.email,
        tokens: arrayUnion(token),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Failed to save FCM token:', err);
  }
}

/** Call on sign-out so this browser/device stops receiving this user's notifications. */
async function teardownPushNotifications() {
  const user = auth.currentUser;
  if (user && currentDeviceToken) {
    try {
      await updateDoc(doc(db, 'fcm_tokens', user.uid), {
        tokens: arrayRemove(currentDeviceToken)
      });
    } catch (err) {
      // Non-fatal — doc may not exist yet, or user already signed out.
      console.warn('Token cleanup skipped:', err.message);
    }
  }
  currentDeviceToken = null;
}

/** Foreground (app open) message handling — no OS notification is shown by FCM automatically. */
function handleForegroundMessage(payload) {
  const data = payload.data || {};
  const isChatOpenForThisThread =
    document.getElementById('chatModal')?.classList.contains('open') &&
    typeof activeConvId !== 'undefined' &&
    activeConvId === data.convId;

  // Don't interrupt the user with a toast/notification for the thread they're already viewing.
  if (isChatOpenForThisThread) return;

  showInAppNotificationToast(data.title || 'New message', data.body || '', data.convType, data.convId);

  // Also fire a real Notification if the tab is visible but the user might not be looking —
  // browsers allow this from foreground JS (unlike the service worker background case).
  if (document.visibilityState === 'visible' && Notification.permission === 'granted') {
    const n = new Notification(data.title || 'VendHub', {
      body: data.body || 'You have a new message.',
      icon: '/icon-192.png',
      tag: data.tag || 'vendhub-chat'
    });
    n.onclick = () => {
      window.focus();
      handleNotificationNavigation(data.convType, data.convId);
      n.close();
    };
  }
}

/** Lightweight in-app toast reusing the existing #shareToast element/style pattern. */
function showInAppNotificationToast(title, body, convType, convId) {
  const toast = document.getElementById('shareToast');
  if (!toast) return;
  toast.textContent = `💬 ${title}: ${body}`.slice(0, 90);
  toast.style.cursor = 'pointer';
  toast.classList.add('show');
  const clickHandler = () => {
    handleNotificationNavigation(convType, convId);
    toast.classList.remove('show');
    toast.removeEventListener('click', clickHandler);
  };
  toast.addEventListener('click', clickHandler, { once: true });
  setTimeout(() => toast.classList.remove('show'), 5000);
}

/** Opens the chat modal directly on the relevant thread. Relies on existing app globals. */
function handleNotificationNavigation(convType, convId) {
  if (!convType || !convId) {
    if (typeof openChatModal === 'function') openChatModal();
    return;
  }
  activeConvType = convType;
  activeConvId = convId;
  // activeConvLabel gets resolved/overwritten by buildChatContextBar() + loadChatForConv()
  // once the relevant maps (userApplicationsMap / myListings / purchasedTickets) are populated.
  if (typeof openChatModal === 'function') openChatModal();
}