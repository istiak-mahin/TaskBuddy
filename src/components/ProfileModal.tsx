import React, { useState, useRef } from 'react';
import { auth, db, storage } from '../firebase';
import { doc, updateDoc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { UserProfile, OperationType, FirestoreErrorInfo } from '../types';
import { X, Camera, User, Save, Loader2, AtSign, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { compressImage, generateThumbnail } from '../lib/imageUtils';

interface ProfileModalProps {
  profile: UserProfile;
  onClose: () => void;
  onUpdate: (updated: Partial<UserProfile>) => void;
  isAdmin?: boolean;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function ProfileModal({ profile, onClose, onUpdate, isAdmin = false }: ProfileModalProps) {
  const [formData, setFormData] = useState({
    name: profile.name || '',
    username: profile.username || '',
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

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setError(null);

    if (file) {
      console.log('File selected:', {
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
        type: file.type
      });
      
      // 1. Validate File Type
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file (PNG, JPG, etc).');
        return;
      }

      // 2. Validate Size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image is too large. Max size is 5MB.');
        return;
      }

      // 3. Set for upload and preview
      setSelectedFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPreviewURL(objectUrl);
      
      // Clean up previous preview URL if any
      return () => URL.revokeObjectURL(objectUrl);
    }
  };

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photoURL: '' }));
    setSelectedFile(null);
    if (previewURL) URL.revokeObjectURL(previewURL);
    setPreviewURL(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    console.log('Photo removed from form state');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[Audit] Profile sequence started.');

    if (!auth.currentUser) {
      setError('Auth session missing. Please re-login.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      // 1. Username Normalization (Rules require '@' prefix)
      let inputUsername = formData.username.trim();
      if (inputUsername.startsWith('@')) {
        inputUsername = inputUsername.substring(1);
      }

      let finalUsername = "";
      if (inputUsername) {
        // Validation: Alphanumeric + underscores, 3-15 chars
        if (!/^[a-zA-Z0-9_]{3,15}$/.test(inputUsername)) {
          throw new Error('Username must be 3-15 alphanumeric characters or underscores.');
        }
        // Prepend '@' as required by Firestore Security Rules
        finalUsername = '@' + inputUsername;

        if (finalUsername !== profile.username) {
          const usernameDocId = finalUsername.toLowerCase();
          const uDoc = await getDoc(doc(db, 'usernames', usernameDocId));
          if (uDoc.exists() && uDoc.data()?.uid !== profile.uid) {
            throw new Error('This username is already taken. Please try another.');
          }
        }
      }

      let currentPhotoURL = formData.photoURL;

      // 2. Audited Image Pipeline
      if (selectedFile) {
        try {
          setUploadProgress(10); // Compression start
          const compressed = await compressImage(selectedFile);
          const fileName = `profile_${profile.uid}_${Date.now()}.jpg`;
          const storagePath = `profile_photos/${profile.uid}/${fileName}`;
          const storageRef = ref(storage, storagePath);

          const uploadTask = uploadBytesResumable(storageRef, compressed, { 
            contentType: 'image/jpeg',
            cacheControl: 'public,max-age=31536000'
          });

          await Promise.race([
            new Promise<void>((resolve, reject) => {
              uploadTask.on('state_changed', 
                (snap) => {
                  const pct = 10 + (snap.bytesTransferred / snap.totalBytes) * 80;
                  setUploadProgress(pct);
                },
                (err) => {
                  console.warn('[Audit] Storage signal failure:', err);
                  reject(err);
                },
                async () => {
                  currentPhotoURL = await getDownloadURL(uploadTask.snapshot.ref);
                  resolve();
                }
              );
            }),
            new Promise((_, reject) => setTimeout(() => {
              uploadTask.cancel();
              reject(new Error('Network timeout (12s).'));
            }, 12000))
          ]);
        } catch (storageErr) {
          console.warn('[Audit] Applying Base64 failover strategy.');
          currentPhotoURL = await generateThumbnail(selectedFile, 200, 0.4);
        }
      }

      // 3. Database Integrity Write
      const updates = {
        name: formData.name.trim() || profile.name,
        username: finalUsername,
        photoURL: currentPhotoURL,
        role: formData.role
      };

      if (finalUsername !== profile.username) {
        if (profile.username) await deleteDoc(doc(db, 'usernames', profile.username.toLowerCase()));
        if (finalUsername) await setDoc(doc(db, 'usernames', finalUsername.toLowerCase()), { uid: profile.uid });
      }

      await updateDoc(doc(db, 'users', profile.uid), updates);
      
      onUpdate(updates);
      setSuccess('Profile successfully updated.');
      
      if (previewURL) {
        URL.revokeObjectURL(previewURL);
        setPreviewURL(null);
      }
      setSelectedFile(null);
      setUploadProgress(null);

      setTimeout(onClose, 1000);
    } catch (err: any) {
      console.error('[Audit] Transaction Failed:', err);
      setError(err.message || 'The system could not save your changes. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-md bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl overflow-hidden border border-transparent dark:border-neutral-800 transition-colors"
      >
        <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/50 dark:bg-neutral-900/50 transition-colors">
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">Profile Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="w-24 h-24 rounded-3xl bg-neutral-100 dark:bg-neutral-800 border-2 border-neutral-200 dark:border-neutral-700 overflow-hidden flex items-center justify-center transition-all group-hover:border-neutral-300 dark:group-hover:border-neutral-600">
                {(previewURL || formData.photoURL) ? (
                  <img 
                    src={previewURL || formData.photoURL} 
                    alt="Profile" 
                    className="w-full h-full object-cover" 
                    referrerPolicy="no-referrer" 
                  />
                ) : (
                  <User className="w-10 h-10 text-neutral-300 dark:text-neutral-600" />
                )}
                {saving && (
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
              </div>
              <div className="absolute -bottom-2 -right-2 flex gap-1.5">
                {(previewURL || formData.photoURL) && (
                  <button 
                    type="button"
                    onClick={removePhoto}
                    disabled={saving}
                    className="p-2 bg-red-500 text-white rounded-xl shadow-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                    title="Remove photo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <label className={`p-2 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 rounded-xl shadow-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <Camera className="w-4 h-4" />
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageChange} 
                    className="hidden" 
                    disabled={saving}
                  />
                </label>
              </div>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {saving ? 'Uploading your profile image...' : 
               (previewURL || formData.photoURL) ? 'Ready to save profile changes' : 'Upload a profile photo'}
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-xs font-semibold rounded-2xl border border-red-100 dark:border-red-900/20 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {success && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold rounded-2xl border border-emerald-100 dark:border-emerald-900/20 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 leading-relaxed">{success}</div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5 text-neutral-700 dark:text-neutral-300">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input 
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full pl-10 pr-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-50/10 transition-all"
                  placeholder="Your full name"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5 text-neutral-700 dark:text-neutral-300">Username</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input 
                  type="text"
                  value={formData.username}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                  className="w-full pl-10 pr-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-50/10 transition-all font-mono"
                  placeholder="@username"
                />
              </div>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1.5 ml-1">Your unique handle (e.g., @john_doe)</p>
            </div>

            {isAdmin && (
              <div>
                <label className="block text-sm font-semibold mb-1.5 text-neutral-700 dark:text-neutral-300">User Role</label>
                <div className="flex gap-2">
                  {['student', 'admin'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={profile.email === 'carlesirodriguez7@gmail.com'}
                      onClick={() => setFormData({ ...formData, role: r as any })}
                      className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest border transition-all ${
                        formData.role === r
                          ? 'bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-50'
                          : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                      } ${profile.email === 'carlesirodriguez7@gmail.com' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {profile.email === 'carlesirodriguez7@gmail.com' && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-1.5 font-bold uppercase tracking-wider">Super admin role cannot be changed</p>
                )}
              </div>
            )}
          </div>

          <button 
            type="submit"
            disabled={saving}
            className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {uploadProgress !== null ? `Saving... ${Math.round(uploadProgress)}%` : 'Syncing...'}
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Update Profile
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}