import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Section, UserProfile, UserRole } from '../types';

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
      sectionIds: sectionId ? [sectionId] : [],
      activeSectionId: sectionId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function normalizeJoinCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export async function getSectionByJoinCode(codeInput: string) {
  const code = normalizeJoinCode(codeInput);

  if (!code) {
    throw new Error('Please enter a section enrollment key.');
  }

  const joinCodeSnap = await getDoc(doc(db, 'joinCodes', code));

  if (!joinCodeSnap.exists()) {
    throw new Error('Invalid section enrollment key. Please check and try again.');
  }

  const joinData = joinCodeSnap.data() as {
    sectionId?: string;
    sectionName?: string;
    active?: boolean;
  };

  if (joinData.active === false || !joinData.sectionId) {
    throw new Error('This section enrollment key is inactive. Please contact your section admin.');
  }

  const sectionSnap = await getDoc(doc(db, 'sections', joinData.sectionId));

  if (!sectionSnap.exists()) {
    throw new Error('The section for this key no longer exists.');
  }

  return {
    code,
    sectionId: joinData.sectionId,
    sectionName: joinData.sectionName || (sectionSnap.data() as Section).name || 'your section',
    section: { id: sectionSnap.id, ...sectionSnap.data() } as Section,
  };
}

async function removeUserFromSections(batch: ReturnType<typeof writeBatch>, uid: string, sectionIds: string[]) {
  Array.from(new Set(sectionIds.filter(Boolean))).forEach((sectionId) => {
    batch.delete(doc(db, 'sections', sectionId, 'students', uid));
  });
}

function buildMembershipPayload(user: UserProfile, role: UserRole) {
  return {
    uid: user.uid,
    name: user.name || 'Student',
    email: user.email || '',
    photoURL: user.photoURL || '',
    role,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function changeOwnSectionWithJoinCode(profile: UserProfile, codeInput: string) {
  const { code, sectionId, sectionName } = await getSectionByJoinCode(codeInput);
  const oldSectionIds = profile.sectionIds || [];
  const nextRole: UserRole = isSuperAdminEmail(profile.email) ? 'superAdmin' : 'student';
  const batch = writeBatch(db);

  await removeUserFromSections(batch, profile.uid, oldSectionIds.filter((id) => id !== sectionId));

  batch.set(
    doc(db, 'users', profile.uid),
    {
      uid: profile.uid,
      name: profile.name || 'Student',
      email: profile.email || '',
      username: profile.username || '',
      role: nextRole,
      sectionIds: [sectionId],
      activeSectionId: sectionId,
      photoURL: profile.photoURL || '',
      disabled: profile.disabled || false,
      joinCodeUsed: code,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'sections', sectionId, 'students', profile.uid),
    buildMembershipPayload(profile, nextRole),
    { merge: true }
  );

  await batch.commit();

  return { sectionId, sectionName, joinCodeUsed: code, role: nextRole };
}

export async function changeUserSectionAsAdmin(target: UserProfile, section: Section, role: UserRole) {
  if (!section.id) {
    throw new Error('Please select a valid section.');
  }

  const nextRole: UserRole = role === 'sectionAdmin' ? 'sectionAdmin' : 'student';
  const oldSectionIds = target.sectionIds || [];
  const batch = writeBatch(db);

  await removeUserFromSections(batch, target.uid, oldSectionIds.filter((id) => id !== section.id));

  for (const sectionId of oldSectionIds.filter((id) => id && id !== section.id)) {
    const sectionSnap = await getDoc(doc(db, 'sections', sectionId));
    if (sectionSnap.exists()) {
      const oldSection = sectionSnap.data() as Section;
      if ((oldSection.adminIds || []).includes(target.uid)) {
        batch.update(doc(db, 'sections', sectionId), {
          adminIds: (oldSection.adminIds || []).filter((uid) => uid !== target.uid),
          updatedAt: serverTimestamp(),
        });
      }
    }
  }

  const nextAdminIds = nextRole === 'sectionAdmin'
    ? Array.from(new Set([...(section.adminIds || []), target.uid]))
    : (section.adminIds || []).filter((uid) => uid !== target.uid);

  batch.set(
    doc(db, 'users', target.uid),
    {
      uid: target.uid,
      name: target.name || 'Student',
      email: target.email || '',
      username: target.username || '',
      role: nextRole,
      sectionIds: [section.id],
      activeSectionId: section.id,
      photoURL: target.photoURL || '',
      disabled: target.disabled || false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'sections', section.id, 'students', target.uid),
    buildMembershipPayload(target, nextRole),
    { merge: true }
  );

  batch.update(doc(db, 'sections', section.id), {
    adminIds: nextAdminIds,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return { nextRole, nextAdminIds };
}

export async function updateSectionEnrollmentKey(section: Section, nextCodeInput: string, actorUid: string) {
  if (!section.id) {
    throw new Error('Section ID missing.');
  }

  const oldCode = normalizeJoinCode(section.joinCode || '');
  const newCode = normalizeJoinCode(nextCodeInput);
  const batch = writeBatch(db);

  batch.update(doc(db, 'sections', section.id), {
    joinCode: newCode,
    updatedAt: serverTimestamp(),
  });

  if (oldCode && oldCode !== newCode) {
    batch.delete(doc(db, 'joinCodes', oldCode));
  }

  if (newCode) {
    batch.set(
      doc(db, 'joinCodes', newCode),
      {
        code: newCode,
        sectionId: section.id,
        sectionName: section.name,
        active: true,
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  return newCode;
}

export async function loadAllSections() {
  const snapshot = await getDocs(collection(db, 'sections'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Section));
}
