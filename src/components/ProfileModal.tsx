import React, { useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, updateDoc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import {
  X,
  Camera,
  User,
  Save,
  Loader2,
  AtSign,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { compressImage, generateThumbnail } from '../lib/imageUtils';

interface ProfileModalProps {
  profile: UserProfile;
  onClose: () => void;
  onUpdate: (updated: Partial<UserProfile>) => void;
  isAdmin?: boolean;
}

export default function ProfileModal({
  profile,
  onClose,
  onUpdate,
  isAdmin = false,
}: ProfileModalProps) {
  const [formData, setFormData] = useState({
    name: profile.name || '',
    username: profile.username ? profile.username.replace(/^@/, '') : '',
    photoURL: profile.photoURL || '',
    role: profile.role || 'student',
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewURL) {
        URL.revokeObjectURL(previewURL);
      }
    };
  }, [previewURL]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    setError(null);
    setSuccess(null);

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image is too large. Max size is 5MB.');
      return;
    }

    if (previewURL) {
      URL.revokeObjectURL(previewURL);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewURL(objectUrl);
  };

  const removePhoto = () => {
    setFormData((prev) => ({ ...prev, photoURL: '' }));
    setSelectedFile(null);
    setError(null);
    setSuccess(null);

    if (previewURL) {
      URL.revokeObjectURL(previewURL);
    }

    setPreviewURL(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const normalizeUsername = async () => {
    let inputUsername = formData.username.trim();

    if (inputUsername.startsWith('@')) {
      inputUsername = inputUsername.slice(1);
    }

    if (!inputUsername) return '';

    if (!/^[a-zA-Z0-9_]{3,15}$/.test(inputUsername)) {
      throw new Error(
        'Username must be 3-15 characters using only letters, numbers, or underscore.'
      );
    }

    const finalUsername = `@${inputUsername}`;

    if (finalUsername !== profile.username) {
      const usernameDocId = finalUsername.toLowerCase();
      const usernameDoc = await getDoc(doc(db, 'usernames', usernameDocId));

      if (usernameDoc.exists() && usernameDoc.data()?.uid !== profile.uid) {
        throw new Error('This username is already taken. Please try another.');
      }
    }

    return finalUsername;
  };

  const convertPhotoToBase64 = async (file: File): Promise<string> => {
    if (!file) {
      throw new Error('File lost. Please select the image again.');
    }

    try {
      setUploadProgress(5);

      const compressed = await compressImage(file, 512, 0.82);
      setUploadProgress(35);

      const imageForBase64 =
        compressed instanceof File
          ? compressed
          : new File([compressed], file.name.replace(/\.[^/.]+$/, '') + '.jpg', {
              type: 'image/jpeg',
            });

      const base64 = await generateThumbnail(imageForBase64, 256, 0.65);

      setUploadProgress(100);
      return base64;
    } catch (err) {
      console.error('Image convert failed:', err);
      throw new Error('Photo processing failed. Please try another image.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!auth.currentUser) {
      setError('Auth session missing. Please log in again.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    setUploadProgress(selectedFile ? 0 : null);

    try {
      const finalUsername = await normalizeUsername();
      let currentPhotoURL = formData.photoURL;

      if (selectedFile) {
        currentPhotoURL = await convertPhotoToBase64(selectedFile);
      }

      const updates: Partial<UserProfile> = {
        name: formData.name.trim() || profile.name,
        username: finalUsername,
        photoURL: currentPhotoURL,
        role: formData.role as 'student' | 'admin',
      };

      if (finalUsername !== profile.username) {
        if (profile.username) {
          await deleteDoc(doc(db, 'usernames', profile.username.toLowerCase()));
        }

        if (finalUsername) {
          await setDoc(doc(db, 'usernames', finalUsername.toLowerCase()), {
            uid: profile.uid,
          });
        }
      }

      await updateDoc(doc(db, 'users', profile.uid), updates);

      onUpdate(updates);
      setFormData((prev) => ({
        ...prev,
        photoURL: currentPhotoURL,
      }));

      setSuccess('Profile successfully updated.');
      setSelectedFile(null);

      if (previewURL) {
        URL.revokeObjectURL(previewURL);
      }
      setPreviewURL(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      window.setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error('Profile update failed:', err);
      setError(err?.message || 'The system could not save your changes. Try again.');
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const currentImage = previewURL || formData.photoURL;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="absolute right-4 top-4 rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          aria-label="Close profile modal"
        >
          <X size={18} />
        </button>

        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            Profile Settings
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Update your personal information and profile photo.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
                {currentImage ? (
                  <img
                    src={currentImage}
                    alt="Profile preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-12 w-12 text-neutral-400 dark:text-neutral-500" />
                )}
              </div>

              {saving && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}

              <label
                htmlFor="profile-photo-input"
                className="absolute bottom-0 right-0 flex cursor-pointer items-center justify-center rounded-full bg-neutral-900 p-2 text-white shadow-lg transition hover:scale-105 dark:bg-neutral-50 dark:text-neutral-900"
              >
                <Camera size={16} />
              </label>
            </div>

            <input
              id="profile-photo-input"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              disabled={saving}
              className="hidden"
            />

            {currentImage && !saving && (
              <button
                type="button"
                onClick={removePhoto}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/20"
              >
                <Trash2 size={16} />
                Remove photo
              </button>
            )}

            <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
              {saving
                ? uploadProgress !== null
                  ? `Uploading... ${Math.round(uploadProgress)}%`
                  : 'Saving profile...'
                : currentImage
                ? 'Ready to save profile changes'
                : 'Upload a profile photo'}
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Full Name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-3 pl-10 pr-4 text-neutral-900 outline-none transition-all focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:focus:ring-neutral-50/10"
                placeholder="Your full name"
                required
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Username
            </label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-3 pl-10 pr-4 font-mono text-neutral-900 outline-none transition-all focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:focus:ring-neutral-50/10"
                placeholder="username"
                disabled={saving}
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Use only letters, numbers, or underscore. Do not type @.
            </p>
          </div>

          {isAdmin && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                User Role
              </label>
              <div className="flex gap-3">
                {['student', 'admin'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, role: r as 'student' | 'admin' })
                    }
                    disabled={saving || profile.email === 'carlesirodriguez7@gmail.com'}
                    className={`flex-1 rounded-xl border py-3 text-xs font-bold uppercase tracking-widest transition-all ${
                      formData.role === r
                        ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-900'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600'
                    } ${
                      profile.email === 'carlesirodriguez7@gmail.com'
                        ? 'cursor-not-allowed opacity-50'
                        : ''
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-neutral-50 dark:text-neutral-900"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {uploadProgress !== null
                  ? `Saving... ${Math.round(uploadProgress)}%`
                  : 'Saving...'}
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Update Profile
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}