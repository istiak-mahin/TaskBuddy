import 'dotenv/config';
import crypto from 'node:crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

type ResourceType = 'notes' | 'previousQuestions';

type ResourceFile = {
  name?: string;
  publicId?: string;
  path?: string;
  cloudinaryResourceType?: 'image' | 'raw' | 'video';
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function parseServiceAccount() {
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT');
  const parsed = JSON.parse(raw);
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function initFirestore() {
  const serviceAccount = parseServiceAccount();
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  }
  return getFirestore(process.env.FIREBASE_DATABASE_ID || '(default)');
}

function signCloudinaryParams(params: Record<string, string>, apiSecret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(payload + apiSecret).digest('hex');
}

async function destroyCloudinaryFile(file: ResourceFile) {
  const cloudName = requireEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey = requireEnv('CLOUDINARY_API_KEY');
  const apiSecret = requireEnv('CLOUDINARY_API_SECRET');
  const publicId = file.publicId || file.path;
  const resourceType = file.cloudinaryResourceType || 'image';

  if (!publicId) {
    console.warn('Skipping file without publicId/path:', file.name || 'unnamed');
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signCloudinaryParams({ public_id: publicId, timestamp }, apiSecret);

  const body = new URLSearchParams({
    public_id: publicId,
    timestamp,
    api_key: apiKey,
    signature,
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const result = await response.json();
  if (!response.ok || (result.result && !['ok', 'not found'].includes(result.result))) {
    throw new Error(`Cloudinary delete failed for ${publicId}: ${JSON.stringify(result)}`);
  }

  console.log(`Cloudinary cleanup: ${publicId} -> ${result.result}`);
}

async function cleanupQueue(db: FirebaseFirestore.Firestore) {
  const snapshot = await db
    .collection('cloudinaryDeleteQueue')
    .where('cleanupStatus', 'in', ['pending', 'failed'])
    .limit(50)
    .get();

  let cleaned = 0;
  let failed = 0;

  for (const requestDoc of snapshot.docs) {
    const data = requestDoc.data();
    const files = Array.isArray(data.files) ? data.files as ResourceFile[] : [];

    try {
      for (const file of files) {
        await destroyCloudinaryFile(file);
      }

      await requestDoc.ref.update({
        cleanupStatus: 'deleted',
        cleanedAt: FieldValue.serverTimestamp(),
      });
      cleaned += 1;
      console.log(`Cleanup request ${requestDoc.id} completed`);
    } catch (error: any) {
      failed += 1;
      console.error(`Cleanup failed for request ${requestDoc.id}:`, error?.message || error);
      await requestDoc.ref.update({
        cleanupStatus: 'failed',
        cleanupError: String(error?.message || error).slice(0, 500),
        cleanupAttemptedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return { checked: snapshot.size, cleaned, failed };
}

async function cleanupLegacyMarkedResources(sectionRef: FirebaseFirestore.DocumentReference, type: ResourceType) {
  const snapshot = await sectionRef
    .collection(type)
    .where('deleteRequested', '==', true)
    .where('cleanupStatus', 'in', ['pending', 'failed'])
    .limit(25)
    .get();

  let cleaned = 0;
  let failed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const files = Array.isArray(data.files) ? data.files as ResourceFile[] : [];

    try {
      for (const file of files) {
        await destroyCloudinaryFile(file);
      }
      await doc.ref.delete();
      cleaned += 1;
      console.log(`Deleted legacy Firestore doc ${sectionRef.id}/${type}/${doc.id}`);
    } catch (error: any) {
      failed += 1;
      console.error(`Legacy cleanup failed for ${sectionRef.id}/${type}/${doc.id}:`, error?.message || error);
      await doc.ref.update({
        cleanupStatus: 'failed',
        cleanupError: String(error?.message || error).slice(0, 500),
        cleanupAttemptedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return { checked: snapshot.size, cleaned, failed };
}

async function main() {
  const db = initFirestore();

  const queueResult = await cleanupQueue(db);
  let checked = queueResult.checked;
  let cleaned = queueResult.cleaned;
  let failed = queueResult.failed;

  const sectionsSnapshot = await db.collection('sections').get();
  console.log(`Checking legacy marked resources for ${sectionsSnapshot.size} sections`);

  for (const section of sectionsSnapshot.docs) {
    for (const type of ['notes', 'previousQuestions'] as ResourceType[]) {
      const result = await cleanupLegacyMarkedResources(section.ref, type);
      checked += result.checked;
      cleaned += result.cleaned;
      failed += result.failed;
    }
  }

  console.log(`Done. checked=${checked}, cleaned=${cleaned}, failed=${failed}`);
}

main().catch((error) => {
  console.error('Cloudinary cleanup job failed:', error);
  process.exit(1);
});
