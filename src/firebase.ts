import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firestoreDatabaseId =
  import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)';

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db =
  firestoreDatabaseId && firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firestoreDatabaseId)
    : getFirestore(app);

const mainBucket =
  firebaseConfig.storageBucket || `${firebaseConfig.projectId}.appspot.com`;

export const storage = getStorage(app, mainBucket);

async function verifyFirebaseSetup() {
  try {
    await getDocFromServer(doc(db, '_internal_', 'monitoring'));
  } catch (error: any) {
    if (error.code === 'unavailable' || error.message?.includes('offline')) {
      console.warn(
        'Firebase Warning: The app is starting in offline mode. If you are in a preview, ensure your internet and database are active.'
      );
    }
  }
}

verifyFirebaseSetup();