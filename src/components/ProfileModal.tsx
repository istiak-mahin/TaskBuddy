import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { doc, updateDoc, query, where, getDocs, collection, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { X, Camera, User, Save, Loader2, AtSign, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ProfileModalProps {
  profile: UserProfile;
  onClose: () => void;
  onUpdate: (updated: Partial<UserProfile>) => void;
  isAdmin?: boolean;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) { // 500KB limit for base64
        setError('Image is too large. Please choose an image under 500KB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photoURL: reader.result as string }));
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Validate username
      let finalUsername = formData.username.trim();
      if (finalUsername) {
        if (!finalUsername.startsWith('@')) {
          finalUsername = '@' + finalUsername;
        }
        
        if (finalUsername.length < 4) {
          setError('Username must be at least 3 characters long (excluding @).');
          setSaving(false);
          return;
        }

        // Check for uniqueness if it changed
        if (finalUsername !== profile.username) {
          try {
            const usernameId = finalUsername.toLowerCase();
            const usernameDoc = await getDoc(doc(db, 'usernames', usernameId));
            if (usernameDoc.exists() && usernameDoc.data()?.uid !== profile.uid) {
              setError('This username is already taken. Please choose another one.');
              setSaving(false);
              return;
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.GET, `usernames/${finalUsername.toLowerCase()}`);
          }
        }
      }

      const updates: Partial<UserProfile> = {
        name: formData.name.trim(),
        username: finalUsername || "",
        photoURL: formData.photoURL,
        role: formData.role as 'admin' | 'student'
      };

      const userRef = doc(db, 'users', profile.uid);
      try {
        // Handle username mapping
        if (finalUsername !== profile.username) {
          // 1. If had an old username, delete it
          if (profile.username) {
            const oldUsernameRef = doc(db, 'usernames', profile.username.toLowerCase());
            await deleteDoc(oldUsernameRef);
          }
          
          // 2. If providing a new username, claim it
          if (finalUsername) {
            const newUsernameId = finalUsername.toLowerCase();
            const newUsernameRef = doc(db, 'usernames', newUsernameId);
            await setDoc(newUsernameRef, { uid: profile.uid });
          }
        }
        
        await updateDoc(userRef, updates);
        onUpdate(updates);
        setSuccess('Profile updated successfully!');
        setTimeout(() => onClose(), 1500);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Firestore Error')) {
        setError('Failed to update profile. Security rules violation.');
      } else {
        console.error('Error updating profile:', err);
        setError('Failed to update profile. Please try again.');
      }
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
          {/* Avatar Upload */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="w-24 h-24 rounded-3xl bg-neutral-100 dark:bg-neutral-800 border-2 border-neutral-200 dark:border-neutral-700 overflow-hidden flex items-center justify-center transition-colors">
                {formData.photoURL ? (
                  <img src={formData.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-10 h-10 text-neutral-300 dark:text-neutral-600" />
                )}
              </div>
              <div className="absolute -bottom-2 -right-2 flex gap-1">
                {formData.photoURL && (
                  <button 
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, photoURL: '' }))}
                    className="p-2 bg-red-500 text-white rounded-xl shadow-lg hover:bg-red-600 transition-colors"
                    title="Remove photo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <label className="p-2 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 rounded-xl cursor-pointer shadow-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors">
                  <Camera className="w-4 h-4" />
                  <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                </label>
              </div>
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {formData.photoURL ? 'Change or remove your profile photo' : 'Upload a profile photo'}
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-xs font-medium rounded-xl border border-red-100 dark:border-red-900/20 flex items-center gap-2">
              <X className="w-4 h-4" />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400 text-xs font-medium rounded-xl border border-green-100 dark:border-green-900/20">
              {success}
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
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Changes
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
