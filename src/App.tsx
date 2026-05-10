import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from './firebase';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, getDocFromServer, collection, query, where, onSnapshot, updateDoc, orderBy, limit } from 'firebase/firestore';
import { UserProfile, OperationType, FirestoreErrorInfo, UserRole } from './types';
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
  MessageCircle,
} from 'lucide-react';
import { isSuperAdminEmail } from './services/sectionService';
import { setupForegroundPushListener, syncPushTokenIfAlreadyGranted } from './services/pushNotificationService';
import { motion, AnimatePresence } from 'motion/react';

type AppView = 'dashboard' | 'admin' | 'superadmin';

const VIEW_STORAGE_PREFIX = 'taskbuddy:lastView:';
const validViews: AppView[] = ['dashboard', 'admin', 'superadmin'];

function isAdminRole(role?: UserRole) {
  return role === 'admin' || role === 'sectionAdmin' || role === 'superAdmin';
}

function canOpenView(view: AppView, profile: UserProfile | null) {
  if (view === 'dashboard') return true;
  if (!profile) return false;

  const superAdmin = isSuperAdminEmail(profile.email) || profile.role === 'superAdmin';
  const admin = superAdmin || isAdminRole(profile.role);

  if (view === 'superadmin') return superAdmin;
  if (view === 'admin') return admin;
  return true;
}

function getStoredView(uid?: string | null): AppView {
  if (!uid || typeof window === 'undefined') return 'dashboard';

  const saved = window.localStorage.getItem(`${VIEW_STORAGE_PREFIX}${uid}`) as AppView | null;
  return saved && validViews.includes(saved) ? saved : 'dashboard';
}

function saveStoredView(uid: string | undefined, view: AppView) {
  if (!uid || typeof window === 'undefined') return;
  window.localStorage.setItem(`${VIEW_STORAGE_PREFIX}${uid}`, view);
}

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
  const [view, setViewState] = useState<AppView>('dashboard');

  // Global notification bell state — works for ALL roles (student, admin, superAdmin)
  const [globalNotifs, setGlobalNotifs] = useState<any[]>([]);
  const [showGlobalNotifPanel, setShowGlobalNotifPanel] = useState(false);
  const globalNotifRef = useRef<HTMLDivElement>(null);


  const navigateView = (nextView: AppView) => {
    if (!canOpenView(nextView, profile)) {
      nextView = 'dashboard';
    }

    setViewState(nextView);
    saveStoredView(user?.uid || profile?.uid, nextView);
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    setupForegroundPushListener().then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Sync push token for ALL roles (admin, superAdmin, student) on login
  useEffect(() => {
    if (!user || !profile) return;
    syncPushTokenIfAlreadyGranted().catch(() => undefined);
  }, [user?.uid, profile?.uid]);

  // Global notification listener — for admin/superAdmin who don't have StudentDashboard bell
  useEffect(() => {
    if (!user || !profile) return;
    const role = profile.role;
    // Students are handled inside StudentDashboard — skip here to avoid duplicates
    if (role === 'student') return;

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      limit(30)
    );
    const unsub = onSnapshot(q, (snap) => {
      const notifs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const aTime = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt?.toMillis?.() || 0);
          const bTime = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : (b.createdAt?.toMillis?.() || 0);
          return bTime - aTime;
        });
      setGlobalNotifs(notifs);
    }, (err) => {
      console.warn('[TaskBuddy] Admin notification listener error:', err.message);
    });
    return () => unsub();
  }, [user?.uid, profile?.uid, profile?.role]);

  // Close global notif panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (globalNotifRef.current && !globalNotifRef.current.contains(e.target as Node)) {
        setShowGlobalNotifPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markGlobalNotifRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true }).catch(() => undefined);
    setGlobalNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllGlobalNotifsRead = async () => {
    const unread = globalNotifs.filter(n => !n.read);
    await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => undefined)));
    setGlobalNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  useEffect(() => {
    if (!profile || !user) return;

    const savedView = getStoredView(user.uid);
    const safeView = canOpenView(savedView, profile) ? savedView : 'dashboard';
    setViewState(safeView);
    saveStoredView(user.uid, safeView);
  }, [profile?.uid, profile?.role, profile?.email, user?.uid]);

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

      const existingSectionIds = existing?.sectionIds || [];
      const singleSectionId = existing?.activeSectionId || existingSectionIds[0] || '';
      const sectionIds = singleSectionId ? [singleSectionId] : [];

      return {
        uid: firebaseUser.uid,
        name: existing?.name || firebaseUser.displayName || 'Anonymous',
        username: existing?.username,
        email,
        role: role as UserProfile['role'],
        sectionIds,
        activeSectionId: singleSectionId,
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
        <div className="max-w-7xl mx-auto px-2 sm:px-6 py-2 sm:py-0 sm:h-20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center justify-between gap-2 sm:justify-start sm:gap-8">
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-neutral-900 dark:bg-neutral-50 rounded-xl flex items-center justify-center shadow-lg transition-colors">
                <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6 text-white dark:text-neutral-900" />
              </div>

              <span className="font-black text-lg sm:text-xl tracking-tighter hidden md:inline text-neutral-900 dark:text-neutral-50">
                TaskBuddy
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:hidden shrink-0">
              <SectionSwitcher
                profile={profile}
                onSectionChange={(sectionId) =>
                  setProfile((prev) => (prev ? { ...prev, activeSectionId: sectionId, sectionIds: sectionId ? [sectionId] : [] } : prev))
                }
              />

              <a
                href="https://wa.me/8801778332688"
                target="_blank"
                rel="noreferrer"
                className="w-9 h-9 flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl transition-all"
                title="Contact Us on WhatsApp"
              >
                <MessageCircle className="w-4 h-4" />
              </a>

              {/* Global Notification Bell — visible to admin/superAdmin only (students use StudentDashboard bell) */}
              {isAdmin && (
                <div className="relative" ref={globalNotifRef}>
                  <button
                    onClick={() => setShowGlobalNotifPanel(v => !v)}
                    className="w-9 h-9 flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all relative"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {globalNotifs.some(n => !n.read) && (
                      <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full" />
                    )}
                  </button>
                  {showGlobalNotifPanel && (
                    <div className="absolute right-0 top-12 w-80 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-xl z-50 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
                        <span className="text-xs font-black uppercase tracking-widest text-neutral-900 dark:text-neutral-50">Notifications</span>
                        <div className="flex items-center gap-2">
                          {globalNotifs.some(n => !n.read) && (
                            <button onClick={markAllGlobalNotifsRead} className="text-[10px] text-blue-500 font-bold hover:underline">Mark all read</button>
                          )}
                          <button onClick={() => setShowGlobalNotifPanel(false)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
                        {globalNotifs.length === 0 ? (
                          <p className="text-xs text-neutral-400 text-center py-8">No notifications yet</p>
                        ) : globalNotifs.map(n => (
                          <div
                            key={n.id}
                            className={`px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${!n.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                            onClick={() => markGlobalNotifRead(n.id)}
                          >
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.read ? 'bg-blue-500' : 'bg-transparent border border-neutral-300'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-neutral-900 dark:text-neutral-50 truncate">{n.title}</p>
                              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">{n.message}</p>
                              <p className="text-[10px] text-neutral-400 mt-1">{typeof n.createdAt === 'string' ? new Date(n.createdAt).toLocaleString() : ''}</p>
                            </div>
                            {!n.read && <Check className="w-3 h-3 text-blue-400 shrink-0 mt-1" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <ThemeToggle />

              <button
                onClick={() => setShowProfileModal(true)}
                className="flex items-center group"
              >
                <div className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 border-2 border-transparent group-hover:border-neutral-900 dark:group-hover:border-neutral-50 transition-all overflow-hidden shadow-sm">
                  {profile.photoURL ? (
                    <img
                      src={profile.photoURL}
                      alt="Profile"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <UserIcon className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
                    </div>
                  )}
                </div>
              </button>

              <button
                onClick={handleLogout}
                className="w-9 h-9 flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-2xl transition-colors overflow-x-auto scrollbar-hide w-full sm:w-auto sm:flex-none">
              <button
                onClick={() => navigateView('dashboard')}
                className={`flex-1 sm:flex-none px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ${
                  view === 'dashboard'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                }`}
              >
                <span className="hidden sm:inline">Dashboard</span>
                <span className="sm:hidden">Dash</span>
              </button>

              <button
                onClick={() => navigateView('admin')}
                className={`flex-1 sm:flex-none px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ${
                  view === 'admin'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                }`}
              >
                Admin
              </button>

              {isSuperAdmin && (
                <button
                  onClick={() => navigateView('superadmin')}
                  className={`flex-1 sm:flex-none px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ${
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

          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <SectionSwitcher
              profile={profile}
              onSectionChange={(sectionId) =>
                setProfile((prev) => (prev ? { ...prev, activeSectionId: sectionId, sectionIds: sectionId ? [sectionId] : [] } : prev))
              }
            />

            <a
              href="https://wa.me/8801778332688"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 dark:hover:border-emerald-900 transition-all shadow-sm"
              title="Contact Us on WhatsApp"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="hidden lg:inline">Contact Us</span>
            </a>

            <ThemeToggle />

            <button
              onClick={() => setShowProfileModal(true)}
              className="flex items-center gap-4 group"
            >
              <div className="text-right hidden lg:block">
                <p className="text-sm font-black leading-none group-hover:text-neutral-600 dark:group-hover:text-neutral-300 dark:text-neutral-100 transition-colors uppercase tracking-tight">
                  {profile.username || profile.name}
                </p>
                <p className="text-[9px] text-neutral-400 dark:text-neutral-500 mt-1 uppercase font-black tracking-[0.2em] opacity-60">
                  {profile.role}
                </p>
              </div>

              <div className="w-11 h-11 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border-2 border-transparent group-hover:border-neutral-900 dark:group-hover:border-neutral-50 transition-all overflow-hidden shadow-sm">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <UserIcon className="w-6 h-6 text-neutral-400 dark:text-neutral-500" />
                  </div>
                )}
              </div>
            </button>

            <button
              onClick={handleLogout}
              className="w-10 h-10 flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
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
                          role: isSuperAdminEmail(prev.email) ? 'superAdmin' : 'student',
                          activeSectionId: sectionId,
                          sectionIds: sectionId ? [sectionId] : [],
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