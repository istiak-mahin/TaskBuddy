import React, { useEffect, useRef, useState } from 'react';
import { auth, db, storage } from '../firebase';
import { doc, updateDoc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { UserProfile } from '../types';
import { X, Camera, User, Save, Loader2, AtSign, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { compressImage } from '../lib/imageUtils';

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ✅ Safe cleanup (fixes file access error)
  useEffect(() => {
    return () => {
      if (previewURL) URL.revokeObjectURL(previewURL);
    };
  }, [previewURL]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setError(null);

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Select a valid image.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Max size 5MB.');
      return;
    }

    if (previewURL) URL.revokeObjectURL(previewURL);

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewURL(objectUrl);
  };

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photoURL: '' }));
    setSelectedFile(null);

    if (previewURL) URL.revokeObjectURL(previewURL);
    setPreviewURL(null);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const normalizeUsername = async () => {
    let input = formData.username.trim();

    if (input.startsWith('@')) input = input.slice(1);
    if (!input) return '';

    if (!/^[a-zA-Z0-9_]{3,15}$/.test(input)) {
      throw new Error('Username must be 3-15 letters/numbers/_');
    }

    const finalUsername = '@' + input;

    if (finalUsername !== profile.username) {
      const docRef = doc(db, 'usernames', finalUsername.toLowerCase());
      const snap = await getDoc(docRef);

      if (snap.exists() && snap.data()?.uid !== profile.uid) {
        throw new Error('Username already taken');
      }
    }

    return finalUsername;
  };

  const uploadPhoto = async (file: File) => {
    if (!file) throw new Error('File lost');

    const fileName = `profile_${profile.uid}_${Date.now()}.jpg`;
    const storageRef = ref(storage, `profile_photos/${profile.uid}/${fileName}`);

    try {
      const compressed = await compressImage(file);

      const task = uploadBytesResumable(storageRef, compressed);

      await new Promise<void>((resolve, reject) => {
        task.on(
          'state_changed',
          (snap) => {
            const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
            setUploadProgress(pct);
          },
          reject,
          resolve
        );
      });

      return await getDownloadURL(storageRef);

    } catch (err) {
      console.warn('Retry original upload...');

      await uploadBytes(storageRef, file);
      return await getDownloadURL(storageRef);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!auth.currentUser) {
      setError('Login expired');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const username = await normalizeUsername();

      let photoURL = formData.photoURL;

      if (selectedFile) {
        photoURL = await uploadPhoto(selectedFile);
      }

      const updates = {
        name: formData.name.trim(),
        username,
        photoURL,
        role: formData.role
      };

      if (username !== profile.username) {
        if (profile.username) {
          await deleteDoc(doc(db, 'usernames', profile.username.toLowerCase()));
        }

        if (username) {
          await setDoc(doc(db, 'usernames', username.toLowerCase()), {
            uid: profile.uid
          });
        }
      }

      await updateDoc(doc(db, 'users', profile.uid), updates);

      onUpdate(updates);
      setSuccess('Profile updated');

      setSelectedFile(null);

      setTimeout(onClose, 1000);

    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />

      <div className="relative w-full max-w-md bg-white dark:bg-neutral-900 p-6 rounded-3xl">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Image */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gray-200">
              {(previewURL || formData.photoURL)
                ? <img src={previewURL || formData.photoURL} className="w-full h-full object-cover" />
                : <User />}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleImageChange}
              hidden
            />

            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Change Photo
            </button>
          </div>

          {/* Name */}
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Name"
            className="w-full p-3 border rounded"
          />

          {/* Username */}
          <input
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            placeholder="username"
            className="w-full p-3 border rounded"
          />

          {error && <p className="text-red-500">{error}</p>}
          {success && <p className="text-green-500">{success}</p>}

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Update Profile'}
          </button>

        </form>
      </div>
    </div>
  );
}