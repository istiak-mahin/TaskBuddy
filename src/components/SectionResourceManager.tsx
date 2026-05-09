import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Download, Edit2, FileText, Image, Loader2, Plus, RefreshCcw, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { motion } from 'motion/react';
import { db } from '../firebase';
import { Section, UserProfile } from '../types';
import { getActiveSectionId, getSectionCollection } from '../services/sectionService';

type ResourceType = 'notes' | 'previousQuestions';

type ResourceFile = {
  name: string;
  path: string;
  url: string;
  type: string;
  size: number;
  publicId?: string;
  cloudName?: string;
  cloudinaryResourceType?: 'image' | 'raw' | 'video';
  format?: string;
};

type SectionResource = {
  id?: string;
  title: string;
  description?: string;
  resourceType: ResourceType;
  sectionId: string;
  sectionName?: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedByEmail?: string;
  files: ResourceFile[];
  deleteRequested?: boolean;
  cleanupStatus?: 'pending' | 'deleted' | 'failed';
  createdAt?: any;
  updatedAt?: any;
};

interface SectionResourceManagerProps {
  profile: UserProfile;
  resourceType: ResourceType;
  isSuperAdmin?: boolean;
  sections?: Section[];
}

const labels = {
  notes: {
    title: 'Notes',
    singular: 'Note',
    description: 'Upload PDF or image notes. Everyone in the same section can view them.',
    accent: 'violet',
  },
  previousQuestions: {
    title: 'Previous Question',
    singular: 'Previous Question',
    description: 'Upload previous question papers as PDF or images for your section.',
    accent: 'cyan',
  },
} as const;

const collectionName = (type: ResourceType) => type;

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';
const rootFolder = import.meta.env.VITE_CLOUDINARY_FOLDER || 'taskbuddy';

const formatSize = (bytes: number) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const cleanFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const getCloudinaryDownloadUrl = (file: ResourceFile) => {
  if (!file.url) return '#';
  if (file.url.includes('/upload/fl_attachment/')) return file.url;
  return file.url.replace('/upload/', '/upload/fl_attachment/');
};

function validateFiles(files: File[]) {
  if (!files.length) return 'Please choose at least one PDF or image file.';
  if (files.length > 8) return 'You can upload maximum 8 files at once.';

  const hasPdf = files.some((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (hasPdf && files.length > 1) return 'PDF upload supports one PDF file only. For multiple files, upload images.';

  for (const file of files) {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    const isPdf = type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = type.startsWith('image/') && !type.includes('heic') && !type.includes('heif') && !name.endsWith('.heic') && !name.endsWith('.heif');

    if (!isPdf && !isImage) return 'Only PDF, JPG, JPEG, PNG, and WEBP files are allowed.';
    if (isPdf && file.size > 5 * 1024 * 1024) return 'PDF file must be 5 MB or smaller for the free upload setup.';
    if (isImage && file.size > 8 * 1024 * 1024) return 'Each image must be 8 MB or smaller.';
  }

  return '';
}

function ensureCloudinaryConfig() {
  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary upload is not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.');
  }
}

async function uploadToCloudinary(file: File, sectionId: string, type: ResourceType, noteId: string): Promise<ResourceFile> {
  ensureCloudinaryConfig();

  const fileName = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
  const cloudinaryResourceType: 'image' | 'raw' = isPdf ? 'raw' : 'image';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', `${rootFolder}/sections/${sectionId}/${type}/${noteId}`);
  formData.append('context', `sectionId=${sectionId}|resourceType=${type}|noteId=${noteId}`);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${cloudinaryResourceType}/upload`, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result?.error?.message || 'Cloudinary upload failed.');
  }

  return {
    name: file.name,
    path: result.public_id || `${sectionId}/${noteId}/${cleanFileName(file.name)}`,
    url: result.secure_url,
    type: isPdf ? 'application/pdf' : file.type || result.resource_type || 'application/octet-stream',
    size: result.bytes || file.size,
    publicId: result.public_id,
    cloudName,
    cloudinaryResourceType,
    format: result.format || (isPdf ? 'pdf' : ''),
  };
}

export default function SectionResourceManager({ profile, resourceType, isSuperAdmin = false, sections = [] }: SectionResourceManagerProps) {
  const meta = labels[resourceType];
  const activeSectionId = getActiveSectionId(profile);
  const [items, setItems] = useState<SectionResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SectionResource | null>(null);
  const [queryText, setQueryText] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', description: '', sectionId: activeSectionId || '' });
  const [files, setFiles] = useState<File[]>([]);
  const [selectedResourceKeys, setSelectedResourceKeys] = useState<string[]>([]);

  const sectionMap = useMemo(() => {
    const map = new Map<string, Section>();
    sections.forEach((section) => section.id && map.set(section.id, section));
    return map;
  }, [sections]);

  const loadSuperAdminItems = async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    setError('');
    try {
      const data: SectionResource[] = [];
      for (const section of sections) {
        if (!section.id) continue;
        const snap = await getDocs(query(collection(db, 'sections', section.id, collectionName(resourceType)), orderBy('createdAt', 'desc')));
        snap.docs.forEach((item) => {
          const resource = { id: item.id, ...item.data(), sectionName: section.name } as SectionResource;
          if (!resource.deleteRequested) data.push(resource);
        });
      }
      setSelectedResourceKeys([]);
      setItems(data.sort((a, b) => {
        const av = a.createdAt?.seconds ? a.createdAt.seconds : 0;
        const bv = b.createdAt?.seconds ? b.createdAt.seconds : 0;
        return bv - av;
      }));
    } catch (err: any) {
      console.error('Load resources failed:', err);
      setError(err?.message || `Could not load ${meta.title}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      loadSuperAdminItems();
      return;
    }

    if (!activeSectionId) {
      setItems([]);
      setLoading(false);
      return;
    }

    const q = query(getSectionCollection(profile, collectionName(resourceType)), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setSelectedResourceKeys([]);
      setItems(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() } as SectionResource))
        .filter((item) => !item.deleteRequested));
      setLoading(false);
    }, (err) => {
      console.error('Resources subscription failed:', err);
      setError(err?.message || `Could not load ${meta.title}.`);
      setLoading(false);
    });

    return () => unsub();
  }, [profile.uid, activeSectionId, resourceType, isSuperAdmin, sections.length]);

  const resetForm = () => {
    setForm({ title: '', description: '', sectionId: activeSectionId || sections[0]?.id || '' });
    setFiles([]);
    setEditing(null);
    setShowForm(false);
    setError('');
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', description: '', sectionId: activeSectionId || sections[0]?.id || '' });
    setFiles([]);
    setShowForm(true);
    setError('');
  };

  const openEdit = (item: SectionResource) => {
    setEditing(item);
    setForm({ title: item.title || '', description: item.description || '', sectionId: item.sectionId || activeSectionId || '' });
    setFiles([]);
    setShowForm(true);
    setError('');
  };

  const canManage = (item: SectionResource) => isSuperAdmin || item.uploadedBy === profile.uid;
  const getResourceKey = (item: SectionResource) => `${item.sectionId}__${item.id || ''}`;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setError('');

    try {
      if (editing) {
        await updateDoc(doc(db, 'sections', editing.sectionId, collectionName(resourceType), editing.id!), {
          title: form.title.trim(),
          description: form.description.trim(),
          updatedAt: serverTimestamp(),
        });
        resetForm();
        if (isSuperAdmin) await loadSuperAdminItems();
        return;
      }

      const validationError = validateFiles(files);
      if (validationError) {
        setError(validationError);
        return;
      }

      const targetSectionId = form.sectionId || activeSectionId;
      if (!targetSectionId) throw new Error('No active section selected.');
      if (!isSuperAdmin && targetSectionId !== activeSectionId) throw new Error('You can upload only to your active section.');

      const section = sectionMap.get(targetSectionId);
      const docRef = await addDoc(collection(db, 'sections', targetSectionId, collectionName(resourceType)), {
        title: form.title.trim(),
        description: form.description.trim(),
        resourceType,
        sectionId: targetSectionId,
        sectionName: section?.name || '',
        uploadedBy: profile.uid,
        uploadedByName: profile.name || '',
        uploadedByEmail: profile.email || '',
        files: [],
        deleteRequested: false,
        cleanupStatus: 'active',
        storageProvider: 'cloudinary',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const uploadedFiles: ResourceFile[] = [];
      for (const file of files) {
        const uploaded = await uploadToCloudinary(file, targetSectionId, resourceType, docRef.id);
        uploadedFiles.push(uploaded);
      }

      await updateDoc(docRef, { files: uploadedFiles, updatedAt: serverTimestamp() });
      resetForm();
      if (isSuperAdmin) await loadSuperAdminItems();
    } catch (err: any) {
      console.error('Save resource failed:', err);
      setError(err?.message || `Could not save ${meta.singular}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: SectionResource) => {
    if (!canManage(item) || !item.id) return;
    const confirmed = window.confirm(`Delete ${item.title}? It will disappear for everyone now. Cloudinary cleanup will run from GitHub Actions.`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    try {
      const resourceRef = doc(db, 'sections', item.sectionId, collectionName(resourceType), item.id);
      const queueId = `${item.sectionId}_${resourceType}_${item.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');

      await setDoc(doc(db, 'cloudinaryDeleteQueue', queueId), {
        sectionId: item.sectionId,
        resourceType,
        resourceId: item.id,
        title: item.title || '',
        files: item.files || [],
        requestedBy: profile.uid,
        requestedByEmail: profile.email || '',
        cleanupStatus: 'pending',
        createdAt: serverTimestamp(),
      });

      await deleteDoc(resourceRef);

      setItems((prev) => prev.filter((resource) => !(resource.id === item.id && resource.sectionId === item.sectionId)));
      if (editing?.id === item.id) resetForm();
      if (isSuperAdmin) await loadSuperAdminItems();
    } catch (err: any) {
      console.error('Delete resource failed:', err);
      setError(err?.message || `Could not delete ${meta.singular}.`);
    } finally {
      setSaving(false);
    }
  };

  const filtered = items.filter((item) => {
    const q = queryText.toLowerCase().trim();
    if (!q) return true;
    return [item.title, item.description, item.uploadedByName, item.uploadedByEmail, item.sectionName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });

  const selectableItems = filtered.filter((item) => item.id && canManage(item));
  const selectableKeys = selectableItems.map(getResourceKey);
  const selectedItems = selectableItems.filter((item) => selectedResourceKeys.includes(getResourceKey(item)));
  const allSelectableSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selectedResourceKeys.includes(key));

  const toggleSelectAll = () => {
    setSelectedResourceKeys((prev) => {
      if (allSelectableSelected) {
        return prev.filter((key) => !selectableKeys.includes(key));
      }
      return Array.from(new Set([...prev, ...selectableKeys]));
    });
  };

  const toggleSelectResource = (item: SectionResource) => {
    const key = getResourceKey(item);
    setSelectedResourceKeys((prev) => prev.includes(key) ? prev.filter((itemKey) => itemKey !== key) : [...prev, key]);
  };

  const handleBulkDelete = async () => {
    if (!selectedItems.length || saving) return;
    const confirmed = window.confirm(`Delete ${selectedItems.length} selected ${meta.title.toLowerCase()} item${selectedItems.length > 1 ? 's' : ''}? Cloudinary cleanup will run from GitHub Actions.`);
    if (!confirmed) return;

    setSaving(true);
    setError('');

    try {
      for (const item of selectedItems) {
        if (!item.id || !canManage(item)) continue;
        const resourceRef = doc(db, 'sections', item.sectionId, collectionName(resourceType), item.id);
        const queueId = `${item.sectionId}_${resourceType}_${item.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        await setDoc(doc(db, 'cloudinaryDeleteQueue', queueId), {
          sectionId: item.sectionId,
          resourceType,
          resourceId: item.id,
          title: item.title || '',
          files: item.files || [],
          requestedBy: profile.uid,
          requestedByEmail: profile.email || '',
          cleanupStatus: 'pending',
          createdAt: serverTimestamp(),
        });

        await deleteDoc(resourceRef);
      }

      const deletedKeys = selectedItems.map(getResourceKey);
      setItems((prev) => prev.filter((resource) => !deletedKeys.includes(getResourceKey(resource))));
      setSelectedResourceKeys((prev) => prev.filter((key) => !deletedKeys.includes(key)));
      if (editing && deletedKeys.includes(getResourceKey(editing))) resetForm();
      if (isSuperAdmin) await loadSuperAdminItems();
    } catch (err: any) {
      console.error('Bulk delete resources failed:', err);
      setError(err?.message || `Could not delete selected ${meta.title.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-neutral-900 p-5 md:p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${resourceType === 'notes' ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-500' : 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-500'}`}>
              {resourceType === 'notes' ? <FileText className="w-5 h-5" /> : <Image className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">{meta.title}</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{meta.description}</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="Search"
                className="w-full sm:w-56 pl-9 pr-3 py-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm text-neutral-900 dark:text-neutral-50 focus:outline-none"
              />
            </div>
            {isSuperAdmin && (
              <button type="button" onClick={loadSuperAdminItems} className="px-4 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 text-sm font-semibold flex items-center gap-2 justify-center">
                <RefreshCcw className="w-4 h-4" /> Refresh
              </button>
            )}
            <button type="button" onClick={showForm ? resetForm : openCreate} className="px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 text-sm font-semibold flex items-center gap-2 justify-center">
              {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showForm ? 'Close' : `Add ${meta.singular}`}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-2xl p-4 text-sm font-medium">
          {error}
        </div>
      )}

      {selectableItems.length > 0 && (
        <div className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <button type="button" onClick={toggleSelectAll} disabled={saving} className="flex items-center gap-3 text-left text-sm font-bold text-neutral-700 dark:text-neutral-200 disabled:opacity-50">
            <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${allSelectableSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}>
              {allSelectableSelected ? '✓' : ''}
            </span>
            {allSelectableSelected ? 'Unselect all' : `Select all ${meta.title}`}
          </button>
          <button type="button" onClick={handleBulkDelete} disabled={saving || selectedItems.length === 0} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete selected{selectedItems.length ? ` (${selectedItems.length})` : ''}
          </button>
        </div>
      )}

      {showForm && (
        <motion.form onSubmit={handleSubmit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-neutral-900 p-5 md:p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-4">
          {isSuperAdmin && !editing && (
            <select value={form.sectionId} onChange={(event) => setForm((prev) => ({ ...prev, sectionId: event.target.value }))} className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none">
              {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          )}
          <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder={`${meta.singular} title`} className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none" />
          <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Description optional" rows={3} className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none resize-none" />

          {!editing && (
            <label className="block border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 text-center cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
              <UploadCloud className="w-8 h-8 mx-auto text-neutral-400 mb-2" />
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Choose PDF or images</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Cloudinary free setup. PDF max 5 MB. Images max 8 files, 8 MB each.</p>
              <input type="file" accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} className="hidden" />
              {files.length > 0 && <p className="text-xs text-blue-500 font-semibold mt-3">{files.length} file selected</p>}
            </label>
          )}

          <button disabled={saving || !form.title.trim()} className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-3 rounded-xl text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving...' : editing ? 'Save Changes' : `Upload ${meta.singular}`}
          </button>
        </motion.form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading && <div className="col-span-full text-sm text-neutral-500 dark:text-neutral-400 font-medium">Loading {meta.title}...</div>}
        {!loading && filtered.length === 0 && <div className="col-span-full bg-white dark:bg-neutral-900 p-10 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center text-sm text-neutral-500 dark:text-neutral-400">No {meta.title.toLowerCase()} uploaded yet.</div>}
        {filtered.map((item) => {
          const selected = selectedResourceKeys.includes(getResourceKey(item));
          const itemCanManage = canManage(item);

          return (
          <div key={`${item.sectionId}-${item.id}`} className={`bg-white dark:bg-neutral-900 p-5 rounded-2xl border shadow-sm space-y-4 ${selected ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-500/10' : 'border-neutral-200 dark:border-neutral-800'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                {itemCanManage && (
                  <button type="button" onClick={() => toggleSelectResource(item)} disabled={saving} className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center text-xs font-black ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'border-neutral-300 dark:border-neutral-600 text-transparent'} disabled:opacity-50`} aria-label={selected ? `Unselect ${item.title}` : `Select ${item.title}`}>
                    ✓
                  </button>
                )}
                <div className="min-w-0">
                <p className="font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">{item.title}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">By {item.uploadedByName || 'Unknown'}{isSuperAdmin && item.sectionName ? ` • ${item.sectionName}` : ''}</p>
                </div>
              </div>
              {canManage(item) && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => openEdit(item)} className="w-8 h-8 rounded-xl bg-neutral-50 dark:bg-neutral-800 text-neutral-500 flex items-center justify-center hover:text-neutral-900 dark:hover:text-neutral-50"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => handleDelete(item)} className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 flex items-center justify-center hover:text-red-700"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
            {item.description && <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">{item.description}</p>}
            <div className="space-y-2">
              {(item.files || []).map((file) => (
                <div key={file.publicId || file.path || file.url} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 truncate">{file.name}</p>
                    <p className="text-[10px] uppercase tracking-widest text-neutral-400 mt-1">{formatSize(file.size)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a href={file.url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:border-blue-300 dark:hover:border-blue-700">
                      Open
                    </a>
                    <a href={getCloudinaryDownloadUrl(file)} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 text-xs font-semibold inline-flex items-center gap-1">
                      <Download className="w-3.5 h-3.5" /> Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
