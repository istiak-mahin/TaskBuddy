import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';

export function getSuperAdminEmails() {
  const envEmails = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '') as string;

  return envEmails
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email?: string | null) {
  return !!email && getSuperAdminEmails().includes(email.toLowerCase());
}

export function getActiveSectionId(
  profile?: Pick<UserProfile, 'activeSectionId' | 'sectionIds'> | null
) {
  return profile?.activeSectionId || profile?.sectionIds?.[0] || '';
}

export function getSectionCollection(profile: UserProfile, collectionName: string) {
  const activeSectionId = getActiveSectionId(profile);
  if (!activeSectionId) {
    throw new Error('No active section selected for this account.');
  }
  return collection(db, 'sections', activeSectionId, collectionName);
}

export function getSectionDoc(profile: UserProfile, collectionName: string, id: string) {
  const activeSectionId = getActiveSectionId(profile);
  if (!activeSectionId) {
    throw new Error('No active section selected for this account.');
  }
  return doc(db, 'sections', activeSectionId, collectionName, id);
}

export async function updateActiveSection(uid: string, sectionId: string) {
  await setDoc(
    doc(db, 'users', uid),
    {
      activeSectionId: sectionId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
