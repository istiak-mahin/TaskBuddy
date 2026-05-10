import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, app, db } from '../firebase';

// VAPID key must be set via VITE_FIREBASE_VAPID_KEY in GitHub Secrets (or .env locally).
// Never use a fallback — a wrong VAPID key causes FCM token creation to fail silently.
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const BASE_URL = import.meta.env.BASE_URL || '/TaskBuddy/';

function withBase(path: string) {
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${base}${path.replace(/^\//, '')}`;
}

function getFirebaseErrorMessage(err: any) {
  const code = err?.code || '';
  const message = err?.message || String(err);

  if (code === 'permission-denied') {
    return 'Firestore permission denied. Deploy the latest firestore.rules and make sure users/{uid}/notificationTokens write is allowed.';
  }

  if (code === 'messaging/permission-blocked') {
    return 'Notification permission is blocked. Allow notifications from browser/site settings.';
  }

  if (code === 'messaging/unsupported-browser') {
    return 'Push notifications are not supported on this browser/device.';
  }

  if (code === 'messaging/token-subscribe-failed' || code === 'messaging/token-update-failed') {
    return 'FCM token creation failed. Check VITE_FIREBASE_VAPID_KEY and Firebase Cloud Messaging settings.';
  }

  return message;
}

function waitForCurrentUser(timeoutMs = 4000): Promise<User> {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error('Login session is not ready yet. Please refresh after login and try again.'));
    }, timeoutMs);

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(user);
    });
  });
}

export async function isPushNotificationSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    (await isSupported())
  );
}

export function getNotificationPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
}

async function saveCurrentFcmToken() {
  try {
    const user = await waitForCurrentUser();

    console.info('[TaskBuddy Push] VAPID_KEY present:', Boolean(VAPID_KEY), '| length:', VAPID_KEY.length);

    if (!VAPID_KEY) {
      throw new Error(
        'VAPID key is missing. Go to Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → copy the Key pair value → add it as VITE_FIREBASE_VAPID_KEY in GitHub Secrets → redeploy.'
      );
    }

    const supported = await isPushNotificationSupported();

    if (!supported) {
      throw new Error('Push notifications are not supported on this browser/device.');
    }

    if (Notification.permission !== 'granted') {
      throw new Error('Notification permission is not granted.');
    }

    await user.getIdToken(true);

    // Do NOT hardcode scope — let the browser derive it from the SW file location.
    // A mismatched scope causes Android Chrome to silently fail FCM token creation.
    const registration = await navigator.serviceWorker.register(withBase('firebase-messaging-sw.js'), {
      updateViaCache: 'none',
    });

    await registration.update().catch(() => undefined);
    await navigator.serviceWorker.ready;

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      throw new Error('Could not create a push notification token.');
    }

    const tokenId = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
    const tokenPath = `users/${user.uid}/notificationTokens/${tokenId}`;

    await setDoc(
      doc(db, 'users', user.uid, 'notificationTokens', tokenId),
      {
        token,
        platform: /android/i.test(navigator.userAgent) ? 'android' : /iphone|ipad/i.test(navigator.userAgent) ? 'ios' : 'desktop',
        active: true,
        permission: Notification.permission,
        uid: user.uid,
        email: user.email || null,
        userAgent: navigator.userAgent,
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );

    console.info('[TaskBuddy Push] FCM token saved:', tokenPath);
    return { token, tokenPath };
  } catch (err: any) {
    const friendlyMessage = getFirebaseErrorMessage(err);
    console.error('[TaskBuddy Push] Token setup failed:', err);
    throw new Error(friendlyMessage);
  }
}

export async function enablePushNotifications() {
  if (getNotificationPermissionStatus() === 'unsupported') {
    throw new Error('Push notifications are not supported on this browser/device.');
  }

  let permission = Notification.permission;

  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  return saveCurrentFcmToken();
}

export async function syncPushTokenIfAlreadyGranted() {
  if (getNotificationPermissionStatus() !== 'granted') {
    return null;
  }

  return saveCurrentFcmToken();
}

export async function setupForegroundPushListener(onPush?: (payload: any) => void) {
  const supported = await isPushNotificationSupported();

  if (!supported) {
    return () => undefined;
  }

  const messaging = getMessaging(app);

  return onMessage(messaging, (payload) => {
    if (onPush) {
      onPush(payload);
    }

    const title = payload.notification?.title || 'TaskBuddy Notification';
    const body = payload.notification?.body || '';

    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: withBase('pwa-192x192.png'),
        badge: withBase('pwa-192x192.png'),
        data: {
          url: payload.data?.url || BASE_URL,
        },
      });
    }
  });
}
