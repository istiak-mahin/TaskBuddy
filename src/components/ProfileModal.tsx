import { useState } from 'react';
import { auth, db } from '../firebase';
import { doc, updateDoc, query, where, getDocs, collection } from 'firebase/firestore';
import { UserProfile } from '../types';
import { X, Camera, User, Save, Loader2, AtSign } from 'lucide-react';
import { motion } from 'motion/react';
import React from 'react';

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
  const normalizeUsername = (username: string) => {
    const trimmed = username.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  };

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
      const finalUsername = normalizeUsername(formData.username);
      if (finalUsername) {
        if (finalUsername.length < 4) {
          setError('Username must be at least 3 characters long (excluding @).');
          setSaving(false);
          return;
        }

      const normalizedCurrentUsername = normalizeUsername(profile.username || '');

      // Check for uniqueness for admins only if it changed
      if (isAdmin && finalUsername !== normalizedCurrentUsername) {
        const q = query(collection(db, 'users'), where('username', '==', finalUsername));
        try {
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            setError('This username is already taken. Please choose another one.');
            setSaving(false);
            return;
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'users');
        }
      }
      }

      const updates: Partial<UserProfile> = {
        name: formData.name.trim(),
        username: finalUsername || undefined,
        photoURL: formData.photoURL,
        role: formData.role as 'admin' | 'student'
      };

      const userRef = doc(db, 'users', profile.uid);
      try {
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
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
          <h2 className="text-xl font-bold tracking-tight">Profile Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-neutral-200 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {/* Avatar Upload */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="w-24 h-24 rounded-3xl bg-neutral-100 border-2 border-neutral-200 overflow-hidden flex items-center justify-center">
                {formData.photoURL ? (
                  <img src={formData.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-10 h-10 text-neutral-300" />
                )}
              </div>
              <label className="absolute -bottom-2 -right-2 p-2 bg-neutral-900 text-white rounded-xl cursor-pointer shadow-lg hover:bg-neutral-800 transition-colors">
                <Camera className="w-4 h-4" />
                <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-neutral-400">Click the camera icon to upload a photo</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs font-medium rounded-xl border border-red-100 flex items-center gap-2">
              <X className="w-4 h-4" />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 text-green-600 text-xs font-medium rounded-xl border border-green-100">
              {success}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5 text-neutral-700">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input 
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full pl-10 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/10 transition-all"
                  placeholder="Your full name"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5 text-neutral-700">Username</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input 
                  type="text"
                  value={formData.username}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                  className="w-full pl-10 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/10 transition-all font-mono"
                  placeholder="@username"
                />
              </div>
              <p className="text-[10px] text-neutral-400 mt-1.5 ml-1">Your unique handle (e.g., @john_doe)</p>
            </div>

            {isAdmin && (
              <div>
                <label className="block text-sm font-semibold mb-1.5 text-neutral-700">User Role</label>
                <div className="flex gap-2">
                  {['student', 'admin'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={profile.email === 'carlesirodriguez7@gmail.com'}
                      onClick={() => setFormData({ ...formData, role: r as any })}
                      className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest border transition-all ${
                        formData.role === r
                          ? 'bg-neutral-900 text-white border-neutral-900'
                          : 'bg-neutral-50 text-neutral-400 border-neutral-200 hover:border-neutral-300'
                      } ${profile.email === 'carlesirodriguez7@gmail.com' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {profile.email === 'carlesirodriguez7@gmail.com' && (
                  <p className="text-[10px] text-amber-600 mt-1.5 font-bold uppercase tracking-wider">Super admin role cannot be changed</p>
                )}
              </div>
            )}
          </div>

          <button 
            type="submit"
            disabled={saving}
            className="w-full bg-neutral-900 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-colors disabled:opacity-50"
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
