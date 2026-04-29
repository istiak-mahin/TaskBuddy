import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';
import { UserProfile, OperationType, FirestoreErrorInfo } from './types';
import StudentDashboard from './components/StudentDashboard';
import AdminDashboard from './components/AdminDashboard';
import SuperAdminPanel from './components/SuperAdminPanel';
import JoinSection from './components/JoinSection';
import SectionSwitcher from './components/SectionSwitcher';
import ProfileModal from './components/ProfileModal';
import ThemeToggle from './components/ThemeToggle';
import {
  LogOut,
  GraduationCap,
  Loader2,
  User as UserIcon,
  X,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { isSuperAdminEmail } from './services/sectionService';
import { motion, AnimatePresence } from 'motion/react';

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const Splash = ({ onComplete }: { onComplete: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 900);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-white flex items-center justify-center"
    >
      <div className="relative">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center gap-6"
        >
          <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center shadow-2xl">
            <GraduationCap className="w-10 h-10 text-white" />
          </div>
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="text-center"
          >
            <h1 className="text-2xl font-black tracking-tighter text-neutral-900">
              TaskBuddy
            </h1>
            <div className="h-1 w-12 bg-neutral-900 mx-auto mt-2 rounded-full" />
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
          className="absolute inset-0 border-2 border-neutral-100 rounded-full -m-4"
        />
      </div>
    </motion.div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [view, setView] = useState<'dashboard' | 'admin' | 'superadmin'>('dashboard');

  useEffect(() => {
    let isMounted = true;

    const buildSafeProfile = (firebaseUser: User, existing?: Partial<UserProfile>): UserProfile => {
      const email = firebaseUser.email || existing?.email || '';
      const role = isSuperAdminEmail(email)
        ? 'superAdmin'
        : existing?.role === 'admin'
          ? 'sectionAdmin'
          : existing?.role === 'sectionAdmin'
            ? 'sectionAdmin'
            : 'student';

      const sectionIds = existing?.sectionIds || [];

      return {
        uid: firebaseUser.uid,
        name: existing?.name || firebaseUser.displayName || 'Anonymous',
        username: existing?.username,
        email,
        role: role as UserProfile['role'],
        sectionIds,
        activeSectionId: existing?.activeSectionId || sectionIds[0] || '',
        photoURL: existing?.photoURL || firebaseUser.photoURL || undefined,
        disabled: existing?.disabled,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
    };

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;

      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setUser(firebaseUser);

      const userDocRef = doc(db, 'users', firebaseUser.uid);

      try {
        let userDoc;
        try {
          userDoc = await getDocFromServer(userDocRef);
        } catch (serverReadError) {
          console.warn('Server profile read failed, using cache if available:', serverReadError);
          userDoc = await getDoc(userDocRef);
        }

        if (userDoc.exists()) {
          const userData = userDoc.data() as UserProfile;

          if (userData.disabled) {
            setError('Your account has been disabled. Please contact the administrator.');
            await signOut(auth);
            if (isMounted) {
              setUser(null);
              setProfile(null);
            }
            return;
          }

          const safeProfile = buildSafeProfile(firebaseUser, userData);

          if (userData.username) {
            const usernameId = userData.username.toLowerCase();
            const usernameRef = doc(db, 'usernames', usernameId);
            try {
              const uDoc = await getDoc(usernameRef);
              if (!uDoc.exists()) {
                await setDoc(usernameRef, { uid: firebaseUser.uid });
              }
            } catch (usernameError) {
              console.warn('Could not claim username mapping:', usernameError);
            }
          }

          try {
            const needsSync =
              safeProfile.uid !== userData.uid ||
              safeProfile.name !== userData.name ||
              safeProfile.email !== userData.email ||
              safeProfile.role !== userData.role ||
              JSON.stringify(safeProfile.sectionIds || []) !== JSON.stringify(userData.sectionIds || []) ||
              safeProfile.activeSectionId !== userData.activeSectionId;

            if (needsSync) {
              await setDoc(
                userDocRef,
                {
                  uid: safeProfile.uid,
                  name: safeProfile.name,
                  email: safeProfile.email,
                  username: safeProfile.username || '',
                  role: safeProfile.role,
                  sectionIds: safeProfile.sectionIds || [],
                  activeSectionId: safeProfile.activeSectionId || '',
                  photoURL: safeProfile.photoURL || '',
                  disabled: safeProfile.disabled || false,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          } catch (syncError) {
            console.warn('Profile sync skipped. Login will continue:', syncError);
          }

          if (isMounted) {
            setProfile(safeProfile);
          }
        } else {
          const newProfile = buildSafeProfile(firebaseUser);

          try {
            await setDoc(userDocRef, {
              ...newProfile,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (createError) {
            console.warn('User profile create failed. Continuing with local profile:', createError);
          }

          if (isMounted) {
            setProfile(newProfile);
          }
        }
      } catch (profileError) {
        console.error('Profile load failed. Continuing with safe local profile:', profileError);
        if (isMounted) {
          setProfile(buildSafeProfile(firebaseUser));
          setError(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    setIsProcessing(true);
    setError(null);

    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login failed:', error);
      setError(error.message || 'Failed to sign in with Google.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setProfile(null);
      setError(null);
    } catch (error: any) {
      console.error('Logout failed:', error);
      setError(error.message || 'Failed to sign out.');
    }
  };

  if (showSplash) {
    return <Splash onComplete={() => setShowSplash(false)} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center transition-colors duration-300">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400 dark:text-neutral-600" />
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6 font-sans transition-colors duration-300">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 dark:opacity-10 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#262626_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-40" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-[380px] w-full bg-white dark:bg-neutral-900 rounded-[2.5rem] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-none border border-neutral-100 dark:border-neutral-800 relative z-10 transition-all"
        >
          <div className="flex flex-col items-center text-center mb-8">
            <motion.div
              whileHover={{ rotate: 10, scale: 1.1 }}
              className="w-12 h-12 bg-neutral-900 dark:bg-neutral-50 rounded-2xl flex items-center justify-center mb-5 shadow-xl transition-colors"
            >
              <GraduationCap className="w-6 h-6 text-white dark:text-neutral-900" />
            </motion.div>
            <h1 className="text-2xl font-black tracking-tight text-neutral-900 dark:text-neutral-50 mb-2">
              Welcome back
            </h1>
            <p className="text-neutral-500 dark:text-neutral-400 text-[13px] font-medium leading-relaxed max-w-[240px]">
              The most professional way to track your academic progress.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { icon: Sparkles, label: 'Clean', color: 'text-amber-500' },
              { icon: ShieldCheck, label: 'Secure', color: 'text-blue-500' },
              { icon: Zap, label: 'Fast', color: 'text-purple-500' },
            ].map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex flex-col items-center gap-2 p-2.5 bg-neutral-50 dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-700 transition-colors"
              >
                <f.icon className={`w-4 h-4 ${f.color}`} />
                <span className="text-[9px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
                  {f.label}
                </span>
              </motion.div>
            ))}
          </div>

          <div className="space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-3.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-2xl border border-red-100 flex items-center gap-3"
              >
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </motion.div>
            )}

            <button
              onClick={handleGoogleLogin}
              disabled={isProcessing}
              className="w-full group relative flex items-center justify-center gap-3 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 rounded-2xl py-3.5 font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all duration-300 shadow-xl shadow-neutral-200 dark:shadow-none active:scale-[0.98] disabled:opacity-50 overflow-hidden text-sm"
            >
              {isProcessing ? (
                <Loader2 className="w-5 h-5 animate-spin text-white dark:text-neutral-900" />
              ) : (
                <>
                  <img
                    src="https://www.google.com/favicon.ico"
                    className="w-5 h-5 brightness-0 invert dark:invert-0"
                    alt="Google"
                  />
                  <span>Continue with Google</span>
                </>
              )}
            </button>

            <p className="text-center text-[11px] text-neutral-400 dark:text-neutral-500 font-medium px-6 leading-relaxed">
              By continuing, you agree to our{' '}
              <span className="underline cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300">
                Terms
              </span>{' '}
              and{' '}
              <span className="underline cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300">
                Privacy Policy
              </span>
              .
            </p>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="pt-2 text-center"
            >
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-neutral-300 dark:text-neutral-600 flex items-center justify-center gap-2 whitespace-nowrap">
                <span className="w-3 sm:w-4 h-px bg-neutral-100 dark:bg-neutral-800" />
                Developed by Team Phantom
                <span className="w-3 sm:w-4 h-px bg-neutral-100 dark:bg-neutral-800" />
              </p>
            </motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  const isSuperAdmin = isSuperAdminEmail(profile.email);
  const isAdmin =
    isSuperAdmin || profile.role === 'admin' || profile.role === 'sectionAdmin';
  const hasAssignedSection = !!(profile.activeSectionId || profile.sectionIds?.length);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 font-sans transition-colors duration-300">
      <nav className="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border-b border-neutral-200 dark:border-neutral-800 sticky top-0 z-50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-8">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-neutral-900 dark:bg-neutral-50 rounded-xl flex items-center justify-center shadow-lg transition-colors">
                <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6 text-white dark:text-neutral-900" />
              </div>
              <span className="font-black text-lg sm:text-xl tracking-tighter hidden sm:inline text-neutral-900 dark:text-neutral-50">
                TaskBuddy
              </span>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-2xl transition-colors">
                <button
                  onClick={() => setView('dashboard')}
                  className={`px-3 md:px-6 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                    view === 'dashboard'
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                  }`}
                >
                  <span className="hidden xs:inline">Dashboard</span>
                  <span className="xs:hidden">Dash</span>
                </button>
                <button
                  onClick={() => setView('admin')}
                  className={`px-3 md:px-6 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                    view === 'admin'
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                  }`}
                >
                  Admin
                </button>

                {isSuperAdmin && (
                  <button
                    onClick={() => setView('superadmin')}
                    className={`px-3 md:px-6 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                      view === 'superadmin'
                        ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                    }`}
                  >
                    Super
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <SectionSwitcher
              profile={profile}
              onSectionChange={(sectionId) =>
                setProfile((prev) => (prev ? { ...prev, activeSectionId: sectionId } : prev))
              }
            />
            <ThemeToggle />

            <button
              onClick={() => setShowProfileModal(true)}
              className="flex items-center gap-2 sm:gap-4 group"
            >
              <div className="text-right hidden md:block">
                <p className="text-sm font-black leading-none group-hover:text-neutral-600 dark:group-hover:text-neutral-300 dark:text-neutral-100 transition-colors uppercase tracking-tight">
                  {profile.username || profile.name}
                </p>
                <p className="text-[9px] text-neutral-400 dark:text-neutral-500 mt-1 uppercase font-black tracking-[0.2em] opacity-60">
                  {profile.role}
                </p>
              </div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border-2 border-transparent group-hover:border-neutral-900 dark:group-hover:border-neutral-50 transition-all overflow-hidden shadow-sm">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <UserIcon className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-400 dark:text-neutral-500" />
                  </div>
                )}
              </div>
            </button>

            <button
              onClick={handleLogout}
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {showProfileModal && profile && (
          <ProfileModal
            profile={profile}
            isAdmin={isAdmin}
            onClose={() => setShowProfileModal(false)}
            onUpdate={(updated) =>
              setProfile((prev) => (prev ? { ...prev, ...updated } : null))
            }
          />
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {!isSuperAdmin && !hasAssignedSection ? (
            <motion.div
              key="join-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <JoinSection
                profile={profile}
                onJoined={(sectionId) =>
                  setProfile((prev) =>
                    prev
                      ? {
                          ...prev,
                          role: prev.role === 'sectionAdmin' ? 'sectionAdmin' : 'student',
                          activeSectionId: sectionId,
                          sectionIds: Array.from(new Set([...(prev.sectionIds || []), sectionId])),
                        }
                      : prev
                  )
                }
              />
            </motion.div>
          ) : view === 'superadmin' && isSuperAdmin ? (
            <motion.div
              key="superadmin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <SuperAdminPanel profile={profile} />
            </motion.div>
          ) : view === 'admin' && isAdmin ? (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <AdminDashboard profile={profile} isSuperAdmin={isSuperAdmin} />
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <StudentDashboard profile={profile} isAdmin={isAdmin} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}