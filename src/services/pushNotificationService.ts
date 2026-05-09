import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, app, db } from '../firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

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

export async function enablePushNotifications() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Please log in before enabling notifications.');
  }

  if (!VAPID_KEY) {
    throw new Error('Firebase VAPID key is missing. Add VITE_FIREBASE_VAPID_KEY to your environment.');
  }

  const supported = await isPushNotificationSupported();

  if (!supported) {
    throw new Error('Push notifications are not supported on this browser/device.');
  }

  const permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const registration = await navigator.serviceWorker.register('/TaskBuddy/firebase-messaging-sw.js');
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

  await setDoc(
    doc(db, 'users', user.uid, 'notificationTokens', tokenId),
    {
      token,
      platform: 'web',
      userAgent: navigator.userAgent,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      active: true,
    },
    { merge: true }
  );

  return token;
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
        icon: '/TaskBuddy/pwa-192x192.png',
        badge: '/TaskBuddy/pwa-192x192.png',
        data: {
          url: payload.data?.url || '/TaskBuddy/',
        },
      });
    }
  });
}
