import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  Edit3,
  Layers,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { db } from '../firebase';
import { Section, UserProfile, UserRole } from '../types';

const emptySectionForm = { name: '', department: '', semester: '', batch: '', joinCode: '' };

type SectionForm = typeof emptySectionForm;

export default function SuperAdminPanel({ profile }: { profile: UserProfile }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sectionForm, setSectionForm] = useState<SectionForm>(emptySectionForm);
  const [editForm, setEditForm] = useState<SectionForm>(emptySectionForm);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({ email: '', sectionId: '', role: 'student' as UserRole });
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);

  const normalizeJoinCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');

  const loadData = async () => {
    setLoadingData(true);
    setError('');

    try {
      const [sectionSnap, userSnap] = await Promise.all([
        getDocs(collection(db, 'sections')),
        getDocs(collection(db, 'users')),
      ]);

      const sectionData = sectionSnap.docs.map((item) => ({ id: item.id, ...item.data() } as Section));
      const userData = userSnap.docs.map((item) => ({ uid: item.id, ...item.data() } as UserProfile));

      setSections(sectionData);
      setUsers(userData);

      if (!assignForm.sectionId && sectionData[0]?.id) {
        setAssignForm((prev) => ({ ...prev, sectionId: sectionData[0].id! }));
      }
    } catch (err: any) {
      console.error('Super admin load failed:', err);
      setError(err?.message || 'Could not load Super Admin data. Check Firestore rules and database selection.');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredUsers = useMemo(() => {
    const queryText = searchQuery.toLowerCase().trim();
    if (!queryText) return users;

    return users.filter((user) =>
      [user.name, user.email, user.username, user.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(queryText))
    );
  }, [users, searchQuery]);

  const createJoinCodePayload = (code: string, sectionId: string, sectionName: string) => ({
    code,
    sectionId,
    sectionName,
    active: true,
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const handleCreateSection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sectionForm.name.trim() || saving) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const normalizedJoinCode = normalizeJoinCode(sectionForm.joinCode);
      const sectionRef = doc(collection(db, 'sections'));
      const batch = writeBatch(db);

      batch.set(sectionRef, {
        name: sectionForm.name.trim(),
        department: sectionForm.department.trim(),
        semester: sectionForm.semester.trim(),
        batch: sectionForm.batch.trim(),
        joinCode: normalizedJoinCode,
        adminIds: [],
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (normalizedJoinCode) {
        batch.set(
          doc(db, 'joinCodes', normalizedJoinCode),
          createJoinCodePayload(normalizedJoinCode, sectionRef.id, sectionForm.name.trim())
        );
      }

      await batch.commit();

      const newSection: Section = {
        id: sectionRef.id,
        name: sectionForm.name.trim(),
        department: sectionForm.department.trim(),
        semester: sectionForm.semester.trim(),
        batch: sectionForm.batch.trim(),
        joinCode: normalizedJoinCode,
        adminIds: [],
      };

      setSections((prev) => [newSection, ...prev]);
      setAssignForm((prev) => ({ ...prev, sectionId: sectionRef.id }));
      setSectionForm(emptySectionForm);
      setMessage(normalizedJoinCode ? `Section created. Join code: ${normalizedJoinCode}` : 'Section created successfully.');
    } catch (err: any) {
      console.error('Create section failed:', err);
      setError(err?.message || 'Could not create section.');
    } finally {
      setSaving(false);
    }
  };

  const startEditSection = (section: Section) => {
    setEditingSectionId(section.id || null);
    setEditForm({
      name: section.name || '',
      department: section.department || '',
      semester: section.semester || '',
      batch: section.batch || '',
      joinCode: section.joinCode || '',
    });
    setError('');
    setMessage('');
  };

  const cancelEditSection = () => {
    setEditingSectionId(null);
    setEditForm(emptySectionForm);
  };

  const handleUpdateSection = async (section: Section) => {
    if (!section.id || !editForm.name.trim() || saving) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const oldCode = normalizeJoinCode(section.joinCode || '');
      const newCode = normalizeJoinCode(editForm.joinCode);
      const batch = writeBatch(db);

      batch.update(doc(db, 'sections', section.id), {
        name: editForm.name.trim(),
        department: editForm.department.trim(),
        semester: editForm.semester.trim(),
        batch: editForm.batch.trim(),
        joinCode: newCode,
        updatedAt: serverTimestamp(),
      });

      if (oldCode && oldCode !== newCode) {
        batch.delete(doc(db, 'joinCodes', oldCode));
      }

      if (newCode) {
        batch.set(
          doc(db, 'joinCodes', newCode),
          createJoinCodePayload(newCode, section.id, editForm.name.trim()),
          { merge: true }
        );
      }

      await batch.commit();

      setSections((prev) =>
        prev.map((item) =>
          item.id === section.id
            ? {
                ...item,
                name: editForm.name.trim(),
                department: editForm.department.trim(),
                semester: editForm.semester.trim(),
                batch: editForm.batch.trim(),
                joinCode: newCode,
              }
            : item
        )
      );

      cancelEditSection();
      setMessage('Section updated successfully.');
    } catch (err: any) {
      console.error('Update section failed:', err);
      setError(err?.message || 'Could not update section.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (section: Section) => {
    if (!section.id || saving) return;

    const confirmed = window.confirm(
      `Delete ${section.name}? This removes the section, its join code, student membership docs, and removes this section from user profiles. Existing assignment subcollections may remain in Firestore as orphaned records.`
    );

    if (!confirmed) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const batch = writeBatch(db);
      const sectionId = section.id;
      const oldCode = normalizeJoinCode(section.joinCode || '');

      batch.delete(doc(db, 'sections', sectionId));
      if (oldCode) batch.delete(doc(db, 'joinCodes', oldCode));

      const studentsSnap = await getDocs(collection(db, 'sections', sectionId, 'students'));
      studentsSnap.docs.forEach((studentDoc) => {
        batch.delete(doc(db, 'sections', sectionId, 'students', studentDoc.id));
      });

      users.forEach((user) => {
        const currentSectionIds = user.sectionIds || [];
        if (!currentSectionIds.includes(sectionId)) return;

        const nextSectionIds = currentSectionIds.filter((item) => item !== sectionId);
        batch.set(
          doc(db, 'users', user.uid),
          {
            sectionIds: nextSectionIds,
            activeSectionId: user.activeSectionId === sectionId ? (nextSectionIds[0] || '') : (user.activeSectionId || ''),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });

      await batch.commit();

      setSections((prev) => prev.filter((item) => item.id !== sectionId));
      setUsers((prev) =>
        prev.map((user) => {
          const nextSectionIds = (user.sectionIds || []).filter((item) => item !== sectionId);
          return {
            ...user,
            sectionIds: nextSectionIds,
            activeSectionId: user.activeSectionId === sectionId ? (nextSectionIds[0] || '') : user.activeSectionId,
          };
        })
      );
      if (assignForm.sectionId === sectionId) {
        setAssignForm((prev) => ({ ...prev, sectionId: '' }));
      }
      setMessage('Section deleted successfully.');
    } catch (err: any) {
      console.error('Delete section failed:', err);
      setError(err?.message || 'Could not delete section.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssignUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const email = assignForm.email.trim().toLowerCase();
      const target = users.find((user) => (user.email || '').toLowerCase() === email);
      const section = sections.find((item) => item.id === assignForm.sectionId);

      if (!target || !section?.id) {
        setMessage('User or section not found. Ask the user to login once first.');
        return;
      }

      const existingSectionIds = target.sectionIds || [];
      const nextSectionIds = Array.from(new Set([...existingSectionIds, section.id])).filter(Boolean);
      const nextRole = assignForm.role === 'sectionAdmin' ? 'sectionAdmin' : 'student';
      const nextActiveSectionId = target.activeSectionId || section.id;
      const nextAdminIds = nextRole === 'sectionAdmin'
        ? Array.from(new Set([...(section.adminIds || []), target.uid]))
        : (section.adminIds || []).filter((uid) => uid !== target.uid);

      const batch = writeBatch(db);

      batch.set(
        doc(db, 'users', target.uid),
        {
          uid: target.uid,
          name: target.name || 'Student',
          email: target.email || email,
          username: target.username || '',
          role: nextRole,
          sectionIds: nextSectionIds,
          activeSectionId: nextActiveSectionId,
          photoURL: target.photoURL || '',
          disabled: target.disabled || false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      batch.set(
        doc(db, 'sections', section.id, 'students', target.uid),
        {
          uid: target.uid,
          name: target.name || '',
          email: target.email || email,
          photoURL: target.photoURL || '',
          role: nextRole,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      batch.update(doc(db, 'sections', section.id), {
        adminIds: nextAdminIds,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      setSections((prev) =>
        prev.map((item) => (item.id === section.id ? { ...item, adminIds: nextAdminIds } : item))
      );
      setUsers((prev) =>
        prev.map((item) =>
          item.uid === target.uid
            ? { ...item, role: nextRole, sectionIds: nextSectionIds, activeSectionId: nextActiveSectionId }
            : item
        )
      );

      setAssignForm((prev) => ({ ...prev, email: '' }));
      setMessage(`${target.email || email} assigned to ${section.name}.`);
    } catch (err: any) {
      console.error('Assign user failed:', err);
      setError(err?.message || 'Could not assign user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight mb-1">Super Admin Console</h1>
          <p className="text-neutral-500 dark:text-neutral-400 font-medium text-sm">Create, edit, delete sections, manage join codes, and assign section admins.</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={loadData} disabled={loadingData} className="flex items-center gap-2 bg-white dark:bg-neutral-900 px-4 py-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm text-[11px] font-bold text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors disabled:opacity-50">
            <RefreshCcw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <div className="flex items-center gap-3 bg-white dark:bg-neutral-900 px-4 py-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm transition-colors">
            <ShieldCheck className="w-4 h-4 text-blue-500" />
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 tracking-tight">Full Access</span>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300 rounded-2xl px-4 py-3 text-sm font-semibold">{error}</div>}
      {message && <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 text-blue-700 dark:text-blue-300 rounded-2xl px-4 py-3 text-sm font-semibold">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-500"><Plus className="w-4 h-4" /></div>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Create Section</h3>
          </div>
          <form onSubmit={handleCreateSection} className="space-y-4">
            {[
              ['name', 'Section Name', 'CSE-63A'],
              ['department', 'Department', 'CSE'],
              ['semester', 'Semester', '1st'],
              ['batch', 'Batch', '63'],
              ['joinCode', 'Join Code', 'CSE63A2026'],
            ].map(([key, label, placeholder]) => (
              <div key={key} className="space-y-1.5">
                <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">{label}</label>
                <input value={(sectionForm as any)[key]} onChange={(event) => setSectionForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={placeholder} className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all" />
              </div>
            ))}
            <button disabled={saving} className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-3 rounded-xl text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Create Section'}</button>
          </form>
        </div>

        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center text-emerald-500"><UserPlus className="w-4 h-4" /></div>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Assign User</h3>
          </div>
          <form onSubmit={handleAssignUser} className="space-y-4">
            <input value={assignForm.email} onChange={(event) => setAssignForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="student@email.com" className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all" />
            <select value={assignForm.sectionId} onChange={(event) => setAssignForm((prev) => ({ ...prev, sectionId: event.target.value }))} className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none">
              <option value="">Select Section</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
            <select value={assignForm.role} onChange={(event) => setAssignForm((prev) => ({ ...prev, role: event.target.value as UserRole }))} className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none">
              <option value="student">Student</option>
              <option value="sectionAdmin">Section Admin</option>
            </select>
            <button disabled={saving} className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-3 rounded-xl text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Assign User'}</button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center gap-3 mb-6"><Layers className="w-5 h-5 text-neutral-400" /><h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Sections</h3></div>
          <div className="space-y-3">
            {sections.length === 0 && !loadingData && <p className="text-sm text-neutral-400 dark:text-neutral-500 font-medium">No sections yet.</p>}
            {sections.map((section) => {
              const isEditing = editingSectionId === section.id;

              return (
                <div key={section.id} className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700">
                  {isEditing ? (
                    <div className="space-y-3">
                      {[
                        ['name', 'Section Name'],
                        ['department', 'Department'],
                        ['semester', 'Semester'],
                        ['batch', 'Batch'],
                        ['joinCode', 'Join Code'],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{label}</label>
                          <input
                            value={(editForm as any)[key]}
                            onChange={(event) => setEditForm((prev) => ({ ...prev, [key]: event.target.value }))}
                            className="mt-1 w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none"
                          />
                        </div>
                      ))}
                      <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => handleUpdateSection(section)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save</button>
                        <button type="button" onClick={cancelEditSection} disabled={saving} className="flex items-center justify-center gap-2 bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50"><X className="w-3.5 h-3.5" /> Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-neutral-900 dark:text-neutral-50">{section.name}</p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{[section.department, section.semester, section.batch].filter(Boolean).join(' • ') || 'No details'}</p>
                          <p className="text-[10px] uppercase tracking-widest text-neutral-400 mt-2">Admins: {section.adminIds?.length || 0}</p>
                          {section.joinCode && <p className="text-[10px] uppercase tracking-widest text-blue-500 dark:text-blue-400 mt-1">Join Code: {section.joinCode}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => startEditSection(section)} disabled={saving} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 transition-colors disabled:opacity-50" title="Edit section"><Edit3 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => handleDeleteSection(section)} disabled={saving} className="w-9 h-9 flex items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-500 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50" title="Delete section"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3"><Users className="w-5 h-5 text-neutral-400" /><h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Users</h3></div>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search" className="pl-9 pr-4 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-xs font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none w-44" /></div>
          </div>
          <div className="space-y-3 max-h-[520px] overflow-y-auto custom-scrollbar">
            {filteredUsers.length === 0 && !loadingData && <p className="text-sm text-neutral-400 dark:text-neutral-500 font-medium">No users found.</p>}
            {filteredUsers.map((user) => (
              <div key={user.uid} className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-neutral-900 dark:text-neutral-50">{user.name || 'Unnamed User'}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{user.email || 'No email'}</p>
                    <p className="text-[10px] uppercase tracking-widest text-neutral-400 mt-2">{user.role || 'student'}</p>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{user.sectionIds?.length || 0} sections</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
