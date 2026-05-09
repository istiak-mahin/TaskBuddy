import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  FileText,
  ClipboardList,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
  ArrowLeft,
} from 'lucide-react';
import { motion } from 'motion/react';
import { db } from '../firebase';
import { Section, UserProfile, UserRole } from '../types';
import { changeUserSectionAsAdmin, normalizeJoinCode } from '../services/sectionService';
import SectionResourceManager from './SectionResourceManager';

const emptySectionForm = { name: '', department: '', semester: '', batch: '', joinCode: '' };

type SectionForm = typeof emptySectionForm;

export default function SuperAdminPanel({ profile }: { profile: UserProfile }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sectionForm, setSectionForm] = useState<SectionForm>(emptySectionForm);
  const [editForm, setEditForm] = useState<SectionForm>(emptySectionForm);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({ email: '', sectionName: '', department: '', role: 'student' as UserRole });
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userEditForm, setUserEditForm] = useState({ sectionName: '', department: '', role: 'student' as UserRole });
  const [activeView, setActiveView] = useState<'overview' | 'sections' | 'sectionCreate' | 'sectionList' | 'users' | 'userChange' | 'userList' | 'notes' | 'previousQuestions'>('overview');
  const activeViewRef = useRef<typeof activeView>('overview');
  const superHistoryPushedRef = useRef(false);
  const [resourceCounts, setResourceCounts] = useState({ notes: 0, previousQuestions: 0 });

  const getDepartmentLabel = (section?: Pick<Section, 'department'> | null) =>
    section?.department?.trim() || 'No Department';

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

      const counts = await sectionData.reduce(async (prevPromise, section) => {
        const prev = await prevPromise;
        if (!section.id) return prev;
        const [notesSnap, previousQuestionsSnap] = await Promise.all([
          getDocs(collection(db, 'sections', section.id, 'notes')),
          getDocs(collection(db, 'sections', section.id, 'previousQuestions')),
        ]);
        return {
          notes: prev.notes + notesSnap.docs.filter((item) => !item.data().deleteRequested).length,
          previousQuestions: prev.previousQuestions + previousQuestionsSnap.docs.filter((item) => !item.data().deleteRequested).length,
        };
      }, Promise.resolve({ notes: 0, previousQuestions: 0 }));

      setResourceCounts(counts);
      setSections(sectionData);
      setUsers(userData);

      if (!assignForm.sectionName && sectionData[0]) {
        setAssignForm((prev) => ({
          ...prev,
          sectionName: sectionData[0].name || '',
          department: getDepartmentLabel(sectionData[0]),
        }));
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


  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    const handleBrowserBack = () => {
      if (activeViewRef.current !== 'overview') {
        superHistoryPushedRef.current = false;
        setActiveView('overview');
      }
    };

    window.addEventListener('popstate', handleBrowserBack);
    return () => window.removeEventListener('popstate', handleBrowserBack);
  }, []);

  const openSuperPage = (view: typeof activeView) => {
    if (view === 'overview') return;

    const wasOnOverview = activeViewRef.current === 'overview';
    setActiveView(view);

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const targetUrl = `${window.location.pathname}${window.location.search}#super-${view}`;

      if (wasOnOverview) {
        window.history.pushState({ taskbuddySuperView: view }, '', targetUrl);
        superHistoryPushedRef.current = true;
      } else {
        window.history.replaceState({ taskbuddySuperView: view }, '', targetUrl);
      }
    }
  };

  const closeSuperPage = () => {
    if (activeViewRef.current === 'overview') return;

    setActiveView('overview');
    if (typeof window !== 'undefined') {
      if (superHistoryPushedRef.current && window.history.length > 1) {
        superHistoryPushedRef.current = false;
        window.history.back();
      } else {
        window.history.replaceState({ taskbuddySuperView: 'overview' }, '', `${window.location.pathname}${window.location.search}`);
      }
    }
  };

  const filteredUsers = useMemo(() => {
    const queryText = searchQuery.toLowerCase().trim();
    if (!queryText) return users;

    return users.filter((user) =>
      [user.name, user.email, user.username, user.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(queryText))
    );
  }, [users, searchQuery]);

  const sectionNames = useMemo(() => {
    return Array.from(
      new Set(sections.map((section) => section.name).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b)));
  }, [sections]);

  const departmentsForSelectedSection = useMemo(() => {
    if (!assignForm.sectionName) return [];

    return Array.from(
      new Set(
        sections
          .filter((section) => section.name === assignForm.sectionName)
          .map((section) => getDepartmentLabel(section))
      )
    ).sort((a, b) => String(a).localeCompare(String(b)));
  }, [sections, assignForm.sectionName]);

  const departmentsForUserEditSection = useMemo(() => {
    if (!userEditForm.sectionName) return [];

    return Array.from(
      new Set(
        sections
          .filter((section) => section.name === userEditForm.sectionName)
          .map((section) => getDepartmentLabel(section))
      )
    ).sort((a, b) => String(a).localeCompare(String(b)));
  }, [sections, userEditForm.sectionName]);

  const selectedUserEditSection = useMemo(() => {
    if (!userEditForm.sectionName || !userEditForm.department) return null;

    return (
      sections.find(
        (section) =>
          section.name === userEditForm.sectionName &&
          getDepartmentLabel(section) === userEditForm.department
      ) || null
    );
  }, [sections, userEditForm.sectionName, userEditForm.department]);

  const selectedAssignSection = useMemo(() => {
    if (!assignForm.sectionName || !assignForm.department) return null;

    return (
      sections.find(
        (section) =>
          section.name === assignForm.sectionName &&
          getDepartmentLabel(section) === assignForm.department
      ) || null
    );
  }, [sections, assignForm.sectionName, assignForm.department]);

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
      setAssignForm((prev) => ({
        ...prev,
        sectionName: sectionForm.name.trim(),
        department: sectionForm.department.trim() || 'No Department',
      }));
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
      if (selectedAssignSection?.id === sectionId) {
        const nextSection = sections.find((item) => item.id !== sectionId);
        setAssignForm((prev) => ({
          ...prev,
          sectionName: nextSection?.name || '',
          department: nextSection ? getDepartmentLabel(nextSection) : '',
        }));
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
      const section = selectedAssignSection;

      if (!target) {
        setMessage('User not found. Ask the user to login once first.');
        return;
      }

      if (!section?.id) {
        setMessage('Please select both section and department.');
        return;
      }

      await changeUserSectionAsAdmin(target, section, assignForm.role);
      await loadData();

      setAssignForm((prev) => ({ ...prev, email: '' }));
      setMessage(`${target.email || email} moved to ${section.name} (${getDepartmentLabel(section)}). Previous section access removed.`);
    } catch (err: any) {
      console.error('Assign user failed:', err);
      setError(err?.message || 'Could not change user section.');
    } finally {
      setSaving(false);
    }
  };

  const getUserSectionLabel = (user: UserProfile) => {
    const activeId = user.activeSectionId || user.sectionIds?.[0] || '';
    const section = sections.find((item) => item.id === activeId);
    if (!section) return activeId ? 'Unknown Section' : 'No Section';
    return [section.name, getDepartmentLabel(section)].filter(Boolean).join(' • ');
  };

  const openUserEditor = (user: UserProfile) => {
    const activeId = user.activeSectionId || user.sectionIds?.[0] || '';
    const currentSection = sections.find((section) => section.id === activeId) || sections[0] || null;

    setSelectedUser(user);
    setUserEditForm({
      sectionName: currentSection?.name || '',
      department: currentSection ? getDepartmentLabel(currentSection) : '',
      role: user.role === 'sectionAdmin' ? 'sectionAdmin' : 'student',
    });
    setError('');
    setMessage('');
  };

  const closeUserEditor = () => {
    if (saving) return;
    setSelectedUser(null);
  };

  const handleSaveSelectedUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUser || saving) return;

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const section = selectedUserEditSection;

      if (!section?.id) {
        setError('Please select both section and department.');
        return;
      }

      await changeUserSectionAsAdmin(selectedUser, section, userEditForm.role);
      await loadData();
      setSelectedUser(null);
      setMessage(`${selectedUser.email || selectedUser.name || 'User'} updated successfully. Previous section access removed.`);
    } catch (err: any) {
      console.error('Selected user update failed:', err);
      setError(err?.message || 'Could not update user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight mb-1">Super Admin Console</h1>
          <p className="text-neutral-500 dark:text-neutral-400 font-medium text-sm">Create, edit, delete sections, manage join codes, and change user sections, manage enrollment keys, and assign section admins.</p>
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



      {activeView === 'overview' && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Sections', value: sections.length, icon: Layers, color: 'blue', view: 'sections' as const },
          { label: 'Users', value: users.length, icon: Users, color: 'emerald', view: 'users' as const },
          { label: 'Notes', value: resourceCounts.notes, icon: FileText, color: 'violet', view: 'notes' as const },
          { label: 'Previous Question', value: resourceCounts.previousQuestions, icon: ClipboardList, color: 'cyan', view: 'previousQuestions' as const },
        ].map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => openSuperPage(stat.view)}
            className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex items-center justify-between hover:border-blue-200 dark:hover:border-blue-800 cursor-pointer transition-all text-left"
            role="button"
            tabIndex={0}
          >
            <div>
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">{stat.label}</p>
              <h3 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">{stat.value}</h3>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              stat.color === 'blue' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500' :
              stat.color === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500' :
              stat.color === 'violet' ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-500' :
              'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-500'
            }`}>
              <stat.icon className="w-5 h-5" />
            </div>
          </motion.div>
        ))}
      </div>
      )}



      {activeView !== 'overview' && (
        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={closeSuperPage} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-semibold text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-50 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <p className="text-xs font-black uppercase tracking-widest text-neutral-400">Super Admin Section</p>
        </div>
      )}

      {activeView === 'notes' && <SectionResourceManager profile={profile} resourceType="notes" isSuperAdmin sections={sections} />}
      {activeView === 'previousQuestions' && <SectionResourceManager profile={profile} resourceType="previousQuestions" isSuperAdmin sections={sections} />}

      {activeView === 'sections' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button type="button" onClick={() => openSuperPage('sectionCreate')} className="text-left bg-white dark:bg-neutral-900 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm hover:border-blue-300 dark:hover:border-blue-800 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center mb-5"><Plus className="w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-neutral-900 dark:text-neutral-50 tracking-tight">Create Section</h3>
            <p className="mt-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">Add a new section and enrollment key.</p>
          </button>
          <button type="button" onClick={() => openSuperPage('sectionList')} className="text-left bg-white dark:bg-neutral-900 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm hover:border-blue-300 dark:hover:border-blue-800 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center mb-5"><Layers className="w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-neutral-900 dark:text-neutral-50 tracking-tight">Show All Sections</h3>
            <p className="mt-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">View, edit, and delete existing sections.</p>
          </button>
        </div>
      )}

      {activeView === 'sectionList' && (
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center gap-3 mb-6"><Layers className="w-5 h-5 text-neutral-400" /><h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">All Sections</h3></div>
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
                          <input value={(editForm as any)[key]} onChange={(event) => setEditForm((prev) => ({ ...prev, [key]: event.target.value }))} className="mt-1 w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none" />
                        </div>
                      ))}
                      <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => handleUpdateSection(section)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save</button>
                        <button type="button" onClick={cancelEditSection} disabled={saving} className="flex items-center justify-center gap-2 bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50"><X className="w-3.5 h-3.5" /> Cancel</button>
                      </div>
                    </div>
                  ) : (
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
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeView === 'users' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button type="button" onClick={() => openSuperPage('userChange')} className="text-left bg-white dark:bg-neutral-900 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-800 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 flex items-center justify-center mb-5"><UserPlus className="w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-neutral-900 dark:text-neutral-50 tracking-tight">Change User Section</h3>
            <p className="mt-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">Move a user to a new section and role.</p>
          </button>
          <button type="button" onClick={() => openSuperPage('userList')} className="text-left bg-white dark:bg-neutral-900 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-800 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 flex items-center justify-center mb-5"><Users className="w-6 h-6" /></div>
            <h3 className="text-2xl font-black text-neutral-900 dark:text-neutral-50 tracking-tight">Show All Users</h3>
            <p className="mt-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">View all users and edit their section directly.</p>
          </button>
        </div>
      )}

      {activeView === 'userList' && (
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3"><Users className="w-5 h-5 text-neutral-400" /><h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">All Users</h3></div>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search" className="pl-9 pr-4 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-xs font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none w-44" /></div>
          </div>
          <div className="space-y-3 max-h-[620px] overflow-y-auto custom-scrollbar">
            {filteredUsers.length === 0 && !loadingData && <p className="text-sm text-neutral-400 dark:text-neutral-500 font-medium">No users found.</p>}
            {filteredUsers.map((user) => (
              <button type="button" key={user.uid} onClick={() => openUserEditor(user)} className="w-full text-left p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-all group">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-neutral-900 dark:text-neutral-50">{user.name || 'Unnamed User'}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{user.email || 'No email'}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2"><span className="text-[10px] uppercase tracking-widest text-neutral-400">{user.role || 'student'}</span><span className="text-[10px] font-black uppercase tracking-widest text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">Click to edit</span></div>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400 max-w-[160px] text-right">{getUserSectionLabel(user)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeView === 'sectionCreate' && (
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
      )}

      {activeView === 'userChange' && (
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center text-emerald-500"><UserPlus className="w-4 h-4" /></div>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Change User Section</h3>
          </div>
          <form onSubmit={handleAssignUser} className="space-y-4">
            <input
              value={assignForm.email}
              onChange={(event) => setAssignForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="user@email.com"
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all"
            />

            <select
              value={assignForm.sectionName}
              onChange={(event) => {
                const nextSectionName = event.target.value;
                const firstMatchingSection = sections.find((section) => section.name === nextSectionName);

                setAssignForm((prev) => ({
                  ...prev,
                  sectionName: nextSectionName,
                  department: firstMatchingSection ? getDepartmentLabel(firstMatchingSection) : '',
                }));
              }}
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none"
            >
              <option value="">Select Section</option>
              {sectionNames.map((sectionName) => (
                <option key={sectionName} value={sectionName}>
                  {sectionName}
                </option>
              ))}
            </select>

            <select
              value={assignForm.department}
              onChange={(event) => setAssignForm((prev) => ({ ...prev, department: event.target.value }))}
              disabled={!assignForm.sectionName}
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none disabled:opacity-60"
            >
              <option value="">Select Department</option>
              {departmentsForSelectedSection.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>

            <select
              value={assignForm.role}
              onChange={(event) => setAssignForm((prev) => ({ ...prev, role: event.target.value as UserRole }))}
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none"
            >
              <option value="student">Student</option>
              <option value="sectionAdmin">Section Admin</option>
            </select>
            <button disabled={saving} className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-3 rounded-xl text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Change User Section'}</button>
          </form>
        </div>
      )}

      {activeView === 'overview' && (
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="text-center py-6">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Choose a card above to manage that area.</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">Create section and change user section are now inside their own management pages.</p>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeUserEditor}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-lg bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 mb-2">Edit User</p>
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">{selectedUser.name || 'Unnamed User'}</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{selectedUser.email || 'No email'}</p>
              </div>
              <button type="button" onClick={closeUserEditor} disabled={saving} className="w-9 h-9 flex items-center justify-center rounded-xl bg-neutral-50 dark:bg-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 transition-colors disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSelectedUser} className="p-6 space-y-4">
              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Current Section</p>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 mt-1">{getUserSectionLabel(selectedUser)}</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">New Section</label>
                <select
                  value={userEditForm.sectionName}
                  onChange={(event) => {
                    const nextSectionName = event.target.value;
                    const firstMatchingSection = sections.find((section) => section.name === nextSectionName);

                    setUserEditForm((prev) => ({
                      ...prev,
                      sectionName: nextSectionName,
                      department: firstMatchingSection ? getDepartmentLabel(firstMatchingSection) : '',
                    }));
                  }}
                  className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none"
                >
                  <option value="">Select Section</option>
                  {sectionNames.map((sectionName) => (
                    <option key={sectionName} value={sectionName}>
                      {sectionName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">Department</label>
                <select
                  value={userEditForm.department}
                  onChange={(event) => setUserEditForm((prev) => ({ ...prev, department: event.target.value }))}
                  disabled={!userEditForm.sectionName}
                  className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none disabled:opacity-60"
                >
                  <option value="">Select Department</option>
                  {departmentsForUserEditSection.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">Role</label>
                <select
                  value={userEditForm.role}
                  onChange={(event) => setUserEditForm((prev) => ({ ...prev, role: event.target.value as UserRole }))}
                  className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none"
                >
                  <option value="student">Student</option>
                  <option value="sectionAdmin">Section Admin</option>
                </select>
              </div>

              <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 p-4 text-xs font-semibold text-amber-700 dark:text-amber-300">
                Saving will move this user to only the selected section. Previous section access will be removed.
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeUserEditor} disabled={saving} className="flex-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 py-3 rounded-xl text-sm font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving || !selectedUserEditSection} className="flex-1 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-3 rounded-xl text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </motion.div>
  );
}
