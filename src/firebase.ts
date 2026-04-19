import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Explicitly define the bucket URL for clarity
const mainBucket = firebaseConfig.storageBucket || `${firebaseConfig.projectId}.appspot.com`;
export const storage = getStorage(app, mainBucket);

// Test connection to Firestore on boot to ensure config is correct
async function verifyFirebaseSetup() {
  try {
    // Attempting to fetch a deep meta doc to verify DB connection
    await getDocFromServer(doc(db, '_internal_', 'monitoring'));
  } catch (error: any) {
    if (error.code === 'unavailable' || error.message?.includes('offline')) {
      console.warn("Firebase Warning: The app is starting in offline mode. If you are in a preview, ensure your internet and database are active.");
    }
  }
}

verifyFirebaseSetup();