import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { UserProfile, Course, Announcement, Assignment } from '../types';
import { Plus, Trash2, Users, Megaphone, BookOpen, LayoutGrid, X, Loader2, Settings2, Edit2, Check, AlertCircle, UserCircle2, CheckCircle2, Clock, ArrowLeft, Search, History, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import StudentDashboard from './StudentDashboard';
import ProfileModal from './ProfileModal';
import React from 'react';

interface AdminDashboardProps {
  profile: UserProfile;
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

function CountdownTimer({ deadline, isDone }: { deadline: string, isDone?: boolean }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (isDone) return;
    const updateTimer = () => {
      const now = new Date().getTime();
      const target = new Date(deadline).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft('Overdue');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [deadline, isDone]);

  if (isDone) {
    return (
      <div className="text-right">
        <p className="text-xs font-semibold tracking-tight text-emerald-500">Completed</p>
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium uppercase tracking-wider">Status</p>
      </div>
    );
  }

  return (
    <div className="text-right">
      <p className={`text-xs font-semibold tracking-tight ${timeLeft === 'Overdue' ? 'text-red-500' : 'text-neutral-900 dark:text-neutral-100'}`}>
        {timeLeft}
      </p>
      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium uppercase tracking-wider">Remaining</p>
    </div>
  );
}

export default function AdminDashboard({ profile }: AdminDashboardProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'courses' | 'announcements' | 'students' | 'assignments' | 'history' | 'all_users'>('courses');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  
  const [newCourse, setNewCourse] = useState('');
  const [newAnnouncement, setNewAnnouncement] = useState({ title: '', content: '', priority: 'normal' as 'normal' | 'important' });
  const [newAssignment, setNewAssignment] = useState({
    title: '',
    course: '',
    deadline: '',
    type: 'Assignment' as 'Quiz' | 'Assignment' | 'Presentation',
    syllabus: '',
  });

  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [showConfirmUpdate, setShowConfirmUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [editingStudentProfile, setEditingStudentProfile] = useState<UserProfile | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [docToDelete, setDocToDelete] = useState<{ col: string; id: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  const toggleUserStatus = async (user: UserProfile) => {
    setIsProcessing(user.uid);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { disabled: !user.disabled });
      setUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, disabled: !user.disabled } : u));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsProcessing(null);
    }
  };

  const resetStudentProgress = async (studentId: string) => {
    setIsProcessing(studentId);
    try {
      const studentAssignments = allAssignments.filter(a => a.userId === studentId);
      const promises = studentAssignments.map(a => {
        const ref = doc(db, 'assignments', a.id!);
        return updateDoc(ref, { completed_hours: 0, urgency: 'low' });
      });
      await Promise.all(promises);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'assignments');
    } finally {
      setIsProcessing(null);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const isTaskDone = (assignment: Assignment) => {
    if (assignment.urgency === 'done') return true;
    const deadline = new Date(assignment.deadline).getTime();
    return deadline <= currentTime.getTime();
  };

  const getTaskUrgency = (assignment: Assignment) => {
    if (isTaskDone(assignment)) return 'done';
    
    const target = new Date(assignment.deadline);
    const diffMs = target.getTime() - currentTime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffHours <= 24) return 'urgent';
    if (diffHours <= 168) return 'medium';
    return 'low';
  };

  useEffect(() => {
    setLoading(true);
    const unsubCourses = onSnapshot(collection(db, 'courses'), (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Course)));
    });

    const unsubAnnouncements = onSnapshot(collection(db, 'announcements'), (snapshot) => {
      setAnnouncements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement)));
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as UserProfile)));
    });

    const unsubAssignments = onSnapshot(collection(db, 'assignments'), (snapshot) => {
      setAllAssignments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Assignment)));
    });

    setLoading(false);
    return () => {
      unsubCourses();
      unsubAnnouncements();
      unsubUsers();
      unsubAssignments();
    };
  }, []);

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourse.trim()) return;
    try {
      await addDoc(collection(db, 'courses'), {
        name: newCourse.trim(),
        createdBy: profile.uid,
      });
      setNewCourse('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'courses');
    }
  };

  const handleUpdateCourse = async () => {
    if (!editingCourse || !editingCourse.name.trim()) return;
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, 'courses', editingCourse.id!), {
        name: editingCourse.name,
      });
      setEditingCourse(null);
      setShowConfirmUpdate(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `courses/${editingCourse.id}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAddAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnouncement.title.trim() || !newAnnouncement.content.trim()) return;
    try {
      await addDoc(collection(db, 'announcements'), {
        ...newAnnouncement,
        createdAt: new Date().toISOString(),
        createdBy: profile.uid,
      });
      setNewAnnouncement({ title: '', content: '', priority: 'normal' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'announcements');
    }
  };

  const calculateUrgency = (deadline: string, completed: number, total: number) => {
    if (completed >= total && total > 0) return 'done';
    
    const now = new Date();
    const target = new Date(deadline);
    const diffMs = target.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffMs < 0) return 'done';
    if (diffHours <= 24) return 'urgent';
    if (diffHours <= 168) return 'medium'; // 7 days
    return 'low';
  };

  const handleAddAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssignment.title.trim() || !newAssignment.course || !newAssignment.deadline) return;
    
    setIsUpdating(true);
    try {
      await addDoc(collection(db, 'assignments'), {
        ...newAssignment,
        userId: profile.uid, // Default to the admin themselves if no student is selected
        total_hours: 1, // Default to 1 to avoid division by zero
        completed_hours: 0,
        urgency: calculateUrgency(newAssignment.deadline, 0, 1),
        createdBy: 'admin',
        createdAt: serverTimestamp(),
      });
      setNewAssignment({ title: '', course: '', deadline: '', type: 'Assignment', syllabus: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'assignments');
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteDocById = async (col: string, id: string) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, col, id));
      setShowConfirmDelete(false);
      setDocToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${col}/${id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

  return (
    <motion.div 
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.1
          }
        }
      }}
      className="space-y-8"
    >
      {/* Welcome Header */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-end justify-between gap-6"
      >
        <div>
          <h1 className="text-4xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight mb-1">
            Admin Console
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 font-medium text-sm">
            Managing {users.filter(u => u.role === 'student').length} Active Students
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white dark:bg-neutral-900 px-4 py-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm transition-colors">
          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 tracking-tight">Admin Mode Active</span>
        </div>
      </motion.div>

      {/* Admin Summary Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { icon: Users, label: 'Students', value: users.filter(u => u.role === 'student').length, color: 'neutral' },
          { icon: BookOpen, label: 'Courses', value: courses.length, color: 'blue' },
          { icon: Clock, label: 'Active Tasks', value: allAssignments.filter(a => !isTaskDone(a)).length, color: 'neutral' },
          { icon: AlertCircle, label: 'Urgent', value: allAssignments.filter(a => getTaskUrgency(a) === 'urgent').length, color: 'red', valueColor: 'text-red-600' },
          { icon: CheckCircle2, label: 'Done', value: allAssignments.filter(a => isTaskDone(a)).length, color: 'green', valueColor: 'text-green-600' },
          { icon: Megaphone, label: 'Updates', value: announcements.length, color: 'amber' },
        ].map((stat, idx) => (
          <motion.div 
            key={stat.label}
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 }
            }}
            className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col items-center justify-center text-center space-y-2 group"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
              stat.color === 'blue' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-500' :
              stat.color === 'red' ? 'bg-red-50 dark:bg-red-900/20 text-red-500' :
              stat.color === 'green' ? 'bg-green-50 dark:bg-green-900/20 text-green-500' :
              stat.color === 'amber' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-500' :
              'bg-neutral-50 dark:bg-neutral-800 text-neutral-400'
            }`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div>
              <p className={`text-xl font-semibold ${stat.valueColor || 'text-neutral-900 dark:text-neutral-50'}`}>{stat.value}</p>
              <p className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Admin Tabs */}
      <motion.div 
        variants={{
          hidden: { opacity: 0, y: 10 },
          visible: { opacity: 1, y: 0 }
        }}
        className="flex flex-wrap items-center justify-between gap-4 p-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 transition-colors"
      >
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'courses', label: 'Courses', icon: BookOpen },
            { id: 'announcements', label: 'Announcements', icon: Megaphone },
            { id: 'assignments', label: 'Assignments', icon: LayoutGrid },
            { id: 'history', label: 'History', icon: Clock },
            { id: 'students', label: 'Students', icon: Users },
            ...(profile.email === 'carlesirodriguez7@gmail.com' ? [{ id: 'all_users', label: 'All Users', icon: ShieldCheck }] : []),
          ].map((tab) => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                activeTab === tab.id 
                  ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-50' 
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-white/50 dark:hover:bg-neutral-700/50'
              }`}
            >
              <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-neutral-900 dark:text-neutral-50' : 'text-neutral-400 dark:text-neutral-500'}`} />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'students' || activeTab === 'all_users' ? (
          <div className="relative flex-1 md:flex-none px-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
            <input 
              type="text"
              placeholder={activeTab === 'students' ? "Search students..." : "Search all users..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-xs font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all w-full md:w-56 shadow-sm"
            />
          </div>
        ) : null}
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === 'courses' && (
          <motion.div 
            key="courses"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            <div className="lg:col-span-1 bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm h-fit">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-500">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">New Course</h3>
              </div>
              <form onSubmit={handleAddCourse} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">Course Name</label>
                  <input 
                    type="text"
                    value={newCourse}
                    onChange={e => setNewCourse(e.target.value)}
                    placeholder="e.g. Mathematics"
                    className="w-full px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-sm text-neutral-900 dark:text-neutral-50"
                  />
                </div>
                <button className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-2.5 rounded-xl font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm active:scale-[0.98] text-sm">
                  Create Course
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Manage Courses</h3>
                <span className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                  {courses.length} Total
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {courses.map(course => (
                  <motion.div 
                    layout
                    key={course.id} 
                    className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex items-center justify-between group hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
                  >
                    {editingCourse?.id === course.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input 
                          type="text"
                          value={editingCourse.name}
                          onChange={e => setEditingCourse({ ...editingCourse, name: e.target.value })}
                          className="flex-1 px-3 py-1.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-50/10 text-sm font-medium text-neutral-900 dark:text-neutral-50"
                          autoFocus
                        />
                        <button 
                          onClick={() => setShowConfirmUpdate(true)}
                          className="p-2 text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-all"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setEditingCourse(null)}
                          className="p-2 text-neutral-400 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-center text-neutral-400 dark:text-neutral-600 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 group-hover:text-blue-500 transition-colors">
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">{course.name}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => setEditingCourse(course)}
                            className="p-2 text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => {
                              setDocToDelete({ col: 'courses', id: course.id });
                              setShowConfirmDelete(true);
                            }}
                            className="p-2 text-red-400 dark:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Confirmation Modal for Course Update */}
            <AnimatePresence>
              {showConfirmUpdate && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowConfirmUpdate(false)}
                    className="absolute inset-0 bg-neutral-900/40 dark:bg-neutral-900/60 backdrop-blur-sm"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-sm bg-white dark:bg-neutral-900 rounded-[2.5rem] shadow-2xl p-8 text-center border border-transparent dark:border-neutral-800"
                  >
                    <div className="w-16 h-16 bg-neutral-100 dark:bg-neutral-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <AlertCircle className="w-8 h-8 text-neutral-900 dark:text-neutral-50" />
                    </div>
                    <h3 className="text-xl font-black text-neutral-900 dark:text-neutral-50 mb-2 tracking-tight">Confirm Changes</h3>
                    <p className="text-neutral-500 dark:text-neutral-400 mb-8 font-medium">Are you sure you want to rename this course to <span className="font-bold text-neutral-900 dark:text-neutral-50">"{editingCourse?.name}"</span>?</p>
                    
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setShowConfirmUpdate(false)}
                        className="flex-1 px-4 py-3 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-50 rounded-xl font-bold hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all text-xs uppercase tracking-widest"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleUpdateCourse}
                        disabled={isUpdating}
                        className="flex-1 px-4 py-3 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 rounded-xl font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
                      >
                        {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {activeTab === 'announcements' && (
          <motion.div 
            key="announcements"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            <div className="lg:col-span-1 bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm h-fit">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center justify-center text-amber-500">
                  <Megaphone className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Post Update</h3>
              </div>
              <form onSubmit={handleAddAnnouncement} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">Title</label>
                  <input 
                    type="text"
                    value={newAnnouncement.title}
                    onChange={e => setNewAnnouncement({...newAnnouncement, title: e.target.value})}
                    placeholder="Announcement title..."
                    className="w-full px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-sm text-neutral-900 dark:text-neutral-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">Content</label>
                  <textarea 
                    value={newAnnouncement.content}
                    onChange={e => setNewAnnouncement({...newAnnouncement, content: e.target.value})}
                    placeholder="Write your message here..."
                    rows={4}
                    className="w-full px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all resize-none text-sm text-neutral-900 dark:text-neutral-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider ml-1">Priority</label>
                  <div className="flex gap-2">
                    {['normal', 'important'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewAnnouncement({ ...newAnnouncement, priority: p as any })}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-wider border transition-all ${
                          newAnnouncement.priority === p
                            ? (p === 'important' ? 'bg-red-600 text-white border-red-600' : 'bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-50')
                            : 'bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-2.5 rounded-xl font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm active:scale-[0.98] text-sm">
                  Post Announcement
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">Recent Updates</h3>
                <span className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                  {announcements.length} Total
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {announcements.map((ann, index) => (
                  <motion.div 
                    key={ann.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`bg-white dark:bg-neutral-900 p-5 rounded-2xl border shadow-sm relative group transition-all hover:border-neutral-300 dark:hover:border-neutral-700 ${
                      ann.priority === 'important' ? 'border-red-100 dark:border-red-900/30 bg-red-50/5 dark:bg-red-900/10' : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:rotate-6 ${
                          ann.priority === 'important' ? 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-50'
                        }`}>
                          <Megaphone className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-neutral-900 dark:text-neutral-50 text-base tracking-tight">{ann.title}</h3>
                            {ann.priority === 'important' && (
                              <span className="px-2 py-0.5 bg-red-600 text-white text-[9px] font-semibold uppercase tracking-wider rounded-md">Important</span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium">
                            {new Date(ann.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteDocById('announcements', ann.id!)}
                        className="p-2 text-neutral-300 hover:text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400 text-sm whitespace-pre-wrap leading-relaxed pl-13">{ann.content}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'assignments' && (
          <motion.div 
            key="assignments"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
            <div className="lg:col-span-4 bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm h-fit sticky top-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-neutral-900 dark:bg-neutral-50 rounded-xl flex items-center justify-center text-white dark:text-neutral-900 shadow-lg shadow-neutral-200 dark:shadow-none">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Create New Task</h3>
                  <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-semibold uppercase tracking-wider">Assign work to students</p>
                </div>
              </div>
              <form onSubmit={handleAddAssignment} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest ml-1">Assignment Title</label>
                  <div className="relative">
                    <Edit2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      required
                      type="text"
                      value={newAssignment.title}
                      onChange={e => setNewAssignment({...newAssignment, title: e.target.value})}
                      placeholder="e.g. Calculus Problem Set #4"
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium text-neutral-900 dark:text-neutral-50"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest ml-1">Course</label>
                  <div className="relative">
                    <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      required
                      list="course-list"
                      type="text"
                      value={newAssignment.course}
                      onChange={e => setNewAssignment({...newAssignment, course: e.target.value})}
                      placeholder="Select or type course"
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium text-neutral-900 dark:text-neutral-50"
                    />
                    <datalist id="course-list">
                      {courses.map(s => (
                        <option key={s.id} value={s.name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest ml-1">Task Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Quiz', 'Assignment', 'Presentation'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewAssignment({ ...newAssignment, type: t as any })}
                        className={`py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${
                          newAssignment.type === t
                            ? 'bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-50 shadow-md'
                            : 'bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest ml-1">Syllabus / Details</label>
                  <div className="relative">
                    <textarea 
                      value={newAssignment.syllabus}
                      onChange={e => setNewAssignment({...newAssignment, syllabus: e.target.value})}
                      placeholder="Enter topics or instructions..."
                      rows={3}
                      className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium text-neutral-900 dark:text-neutral-50 resize-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest ml-1">Due Date & Time</label>
                  <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      required
                      type="datetime-local"
                      value={newAssignment.deadline}
                      onChange={e => setNewAssignment({...newAssignment, deadline: e.target.value})}
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium text-neutral-900 dark:text-neutral-50 [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isUpdating}
                  className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-4 rounded-2xl font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-xl shadow-neutral-200 dark:shadow-none active:scale-[0.98] flex items-center justify-center gap-3 text-xs uppercase tracking-widest mt-4"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create & Assign Task
                    </>
                  )}
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center justify-between px-2">
                <div>
                  <h3 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Active Assignments</h3>
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500 font-semibold uppercase tracking-widest mt-1">Real-time status tracking</p>
                </div>
                <div className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-800 px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-300 uppercase tracking-wider">
                    {allAssignments.filter(a => !isTaskDone(a)).length} Tasks In Progress
                  </span>
                </div>
              </div>

              <div className="bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50/50 dark:bg-neutral-800/50 border-b border-neutral-100 dark:border-neutral-800">
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Assignment Details</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Assigned Student</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Progress</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Urgency</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Deadline</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {allAssignments.filter(a => !isTaskDone(a)).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-8 py-20 text-center">
                            <div className="flex flex-col items-center gap-3 opacity-40">
                              <LayoutGrid className="w-10 h-10 text-neutral-300 dark:text-neutral-600" />
                              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">No active assignments found.</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        allAssignments
                          .filter(a => !isTaskDone(a))
                          .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
                          .map(assignment => {
                          const student = users.find(u => u.uid === assignment.userId);
                          const urgency = getTaskUrgency(assignment);
                          
                          return (
                            <tr key={assignment.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors group">
                              <td className="px-8 py-6">
                                <div className="flex flex-col gap-1">
                                  <p className="font-bold text-neutral-900 dark:text-neutral-50 text-sm tracking-tight">{assignment.title}</p>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">{assignment.course}</span>
                                    <span className="w-1 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full" />
                                    <span className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">{assignment.type}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 bg-neutral-100 dark:bg-neutral-800 rounded-xl flex items-center justify-center text-neutral-400 transition-transform group-hover:scale-110">
                                    {student?.photoURL ? (
                                      <img src={student.photoURL} alt="" className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
                                    ) : (
                                      <UserCircle2 className="w-5 h-5" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-neutral-900 dark:text-neutral-50">{student?.username || student?.name || 'Unknown'}</p>
                                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium tracking-tight">{student?.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="space-y-2 max-w-[120px]">
                                  <div className="flex items-center justify-between text-[10px] font-bold">
                                    <span className="text-neutral-400 dark:text-neutral-500">{assignment.completed_hours}/{assignment.total_hours || 0}h</span>
                                    <span className="text-neutral-900 dark:text-neutral-50">{Math.round((assignment.completed_hours / (assignment.total_hours || 1)) * 100)}%</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                    <motion.div 
                                      initial={{ width: 0 }}
                                      animate={{ width: `${(assignment.completed_hours / (assignment.total_hours || 1)) * 100}%` }}
                                      className={`h-full ${
                                        urgency === 'done' ? 'bg-emerald-500' :
                                        urgency === 'urgent' ? 'bg-red-500' : 
                                        urgency === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                                      }`}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                                  urgency === 'done' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' :
                                  urgency === 'urgent' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 
                                  urgency === 'medium' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : 
                                  'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                }`}>
                                  {urgency}
                                </span>
                              </td>
                              <td className="px-8 py-6 whitespace-nowrap">
                                <CountdownTimer deadline={assignment.deadline} isDone={assignment.urgency === 'done'} />
                              </td>
                              <td className="px-8 py-6 text-right">
                                <button 
                                  onClick={() => {
                                    setDocToDelete({ col: 'assignments', id: assignment.id! });
                                    setShowConfirmDelete(true);
                                  }}
                                  className="p-2.5 text-neutral-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        )}


        {activeTab === 'history' && (
          <motion.div 
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between px-2">
              <div>
                <h3 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Task History</h3>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 font-semibold uppercase tracking-widest mt-1">Archive of completed and expired tasks</p>
              </div>
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-xl border border-emerald-100 dark:border-emerald-800/50">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  {allAssignments.filter(a => isTaskDone(a)).length} Total Archived
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden transition-colors">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50/50 dark:bg-neutral-800/50 border-b border-neutral-100 dark:border-neutral-800">
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Task Details</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Assigned To</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Status</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {allAssignments.filter(a => isTaskDone(a)).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-8 py-20 text-center">
                          <div className="flex flex-col items-center gap-3 opacity-40">
                            <Clock className="w-10 h-10 text-neutral-300 dark:text-neutral-600" />
                            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">No task history available.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      allAssignments
                        .filter(a => isTaskDone(a))
                        .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime())
                        .map(assignment => {
                        const student = users.find(u => u.uid === assignment.userId);
                        const isExpired = new Date(assignment.deadline).getTime() <= currentTime.getTime();
                        
                        return (
                          <tr key={assignment.id} className="hover:bg-neutral-50/30 dark:hover:bg-neutral-800/30 transition-all group opacity-80 hover:opacity-100">
                            <td className="px-8 py-6">
                              <div className="flex flex-col gap-1">
                                <p className="font-bold text-neutral-500 dark:text-neutral-400 line-through text-sm tracking-tight">{assignment.title}</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">{assignment.course}</span>
                                  <span className="w-1 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full" />
                                  <span className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">{assignment.type}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-neutral-50 dark:bg-neutral-800 rounded-xl flex items-center justify-center text-neutral-300 dark:text-neutral-600 border border-neutral-100 dark:border-neutral-800">
                                  {student?.photoURL ? (
                                    <img src={student.photoURL} alt="" className="w-full h-full object-cover rounded-xl grayscale opacity-50" referrerPolicy="no-referrer" />
                                  ) : (
                                    <UserCircle2 className="w-5 h-5" />
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400">{student?.username || student?.name || 'Unknown'}</p>
                                  <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium tracking-tight">{student?.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${isExpired ? 'bg-neutral-300 dark:bg-neutral-600' : 'bg-emerald-500'}`} />
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest ${
                                  isExpired ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                                }`}>
                                  {isExpired ? 'Expired' : 'Completed'}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-6 text-right">
                              <button 
                                onClick={() => {
                                  setDocToDelete({ col: 'assignments', id: assignment.id! });
                                  setShowConfirmDelete(true);
                                }}
                                className="p-2.5 text-neutral-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'students' && (
          <motion.div 
            key="students"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {editingStudentProfile && (
              <ProfileModal 
                profile={editingStudentProfile}
                onClose={() => setEditingStudentProfile(null)}
                isAdmin={true}
                onUpdate={(updated) => {
                  setUsers(prev => prev.map(u => u.uid === editingStudentProfile.uid ? { ...u, ...updated } : u));
                  setEditingStudentProfile(null);
                }}
              />
            )}
            {selectedStudentId ? (
              <div className="space-y-6">
                <button 
                  onClick={() => setSelectedStudentId(null)}
                  className="flex items-center gap-3 px-8 py-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-50 font-black text-[10px] uppercase tracking-widest transition-all shadow-sm hover:shadow-xl active:scale-[0.98]"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Student List
                </button>
                <div className="bg-white dark:bg-neutral-900 rounded-[3rem] border border-neutral-100 dark:border-neutral-800 shadow-soft p-2 overflow-hidden">
                  <StudentDashboard 
                    profile={users.find(u => u.uid === selectedStudentId) || profile} 
                    isAdmin={true}
                    studentId={selectedStudentId}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-10">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                  <div>
                    <h3 className="text-4xl font-black text-neutral-900 dark:text-neutral-50 tracking-tighter mb-2">Student Directory</h3>
                    <p className="text-neutral-400 dark:text-neutral-500 font-bold uppercase tracking-[0.2em] text-[10px]">
                      {users.filter(u => u.role === 'student').length} Registered Students
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {users
                    .filter(u => u.role === 'student')
                    .filter(u => 
                      (u.username || u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((student, i) => {
                      const studentAssignments = allAssignments.filter(a => a.userId === student.uid);
                      const completedCount = studentAssignments.filter(a => isTaskDone(a)).length;
                      
                      return (
                        <motion.div 
                          key={student.uid}
                          layout
                          initial={{ opacity: 0, scale: 0.9, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="bg-white dark:bg-neutral-900 p-10 rounded-[3rem] border border-neutral-100 dark:border-neutral-800 shadow-soft hover:shadow-2xl dark:shadow-none transition-all duration-500 group relative overflow-hidden"
                        >
                          <div className="flex items-start justify-between mb-10">
                            <div className="flex items-center gap-5">
                              <div className="w-16 h-16 bg-neutral-100 dark:bg-neutral-800 rounded-2xl flex items-center justify-center text-neutral-400 group-hover:bg-neutral-900 dark:group-hover:bg-neutral-50 group-hover:text-white dark:group-hover:text-neutral-900 transition-all duration-700 shadow-sm border border-neutral-200 dark:border-neutral-700">
                                {student.photoURL ? (
                                  <img src={student.photoURL} alt="" className="w-full h-full object-cover rounded-2xl" referrerPolicy="no-referrer" />
                                ) : (
                                  <UserCircle2 className="w-8 h-8" />
                                )}
                              </div>
                              <div>
                                <h4 className="font-black text-neutral-900 dark:text-neutral-50 text-xl leading-tight tracking-tight">{student.username || student.name}</h4>
                                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-black uppercase tracking-widest mt-1">{student.email}</p>
                              </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                              <button 
                                onClick={() => toggleUserStatus(student)}
                                disabled={isProcessing === student.uid}
                                className={`p-3 rounded-xl transition-all ${
                                  student.role === 'admin' 
                                  ? 'bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-900' 
                                  : 'bg-neutral-50 text-neutral-400 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-50'
                                }`}
                                title={student.role === 'admin' ? "Revoke Admin" : "Make Admin"}
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => deleteDocById('users', student.uid!)}
                                className="p-3 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white rounded-xl transition-all"
                                title="Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-10">
                            <div className="bg-neutral-50 dark:bg-neutral-800/50 p-6 rounded-[2rem] border border-neutral-100 dark:border-neutral-800/50">
                              <p className="text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-2">Total Tasks</p>
                              <p className="text-3xl font-black text-neutral-900 dark:text-neutral-50 tracking-tighter">{studentAssignments.length}</p>
                            </div>
                            <div className="bg-emerald-50 dark:bg-emerald-900/10 p-6 rounded-[2rem] border border-emerald-100 dark:border-emerald-800/30">
                              <p className="text-[10px] font-black text-emerald-600/60 dark:text-emerald-400/60 uppercase tracking-widest mb-2">Completed</p>
                              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tracking-tighter">{completedCount}</p>
                            </div>
                          </div>

                          <button 
                            onClick={() => setSelectedStudentId(student.uid)}
                            className="w-full py-5 bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-neutral-200 dark:shadow-none hover:shadow-none hover:translate-y-1 active:scale-95 transition-all duration-300"
                          >
                            Explore Performance
                          </button>
                        </motion.div>
                      );
                    })}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'all_users' && profile.email === 'carlesirodriguez7@gmail.com' && (
          <motion.div 
            key="all_users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10"
          >
            <div>
              <h3 className="text-4xl font-black text-neutral-900 dark:text-neutral-50 tracking-tighter mb-2">Total User Directory</h3>
              <p className="text-neutral-400 dark:text-neutral-500 font-bold uppercase tracking-[0.2em] text-[10px]">
                {users.length} Registered Users (Admins & Students)
              </p>
            </div>

            <div className="bg-white dark:bg-neutral-900 rounded-[3rem] border border-neutral-100 dark:border-neutral-800 shadow-soft overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-neutral-50/50 dark:bg-neutral-800/50 border-b border-neutral-100 dark:border-neutral-800">
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">User</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">Email</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">Role</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">Status</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 dark:text-neutral-500 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                  {users
                    .filter(u => 
                      (u.username || u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((user) => (
                    <tr key={user.uid} className="group hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                      <td className="px-10 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 overflow-hidden flex items-center justify-center">
                            {user.photoURL ? (
                              <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <UserCircle2 className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900 dark:text-neutral-50 text-sm">{user.username || user.name}</p>
                            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium">{user.uid.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-10 py-6 text-sm text-neutral-600 dark:text-neutral-400 font-medium">{user.email}</td>
                      <td className="px-10 py-6">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          user.role === 'admin' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-10 py-6">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          user.disabled ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {user.disabled ? 'Disabled' : 'Active'}
                        </span>
                      </td>
                      <td className="px-10 py-6 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => toggleUserStatus(user)}
                            disabled={isProcessing === user.uid}
                            className={`p-2 rounded-lg transition-all ${
                              user.disabled ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                            }`}
                          >
                            {user.disabled ? <CheckCircle2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
                          </button>
                          <button 
                            onClick={() => setEditingStudentProfile(user)}
                            className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-50 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              setDocToDelete({ col: 'users', id: user.uid });
                              setShowConfirmDelete(true);
                            }}
                            className="p-2 text-neutral-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all"
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Delete Confirmation Modal */}
      <AnimatePresence>
        {showConfirmDelete && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmDelete(false)}
              className="absolute inset-0 bg-neutral-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-neutral-900 rounded-[2.5rem] shadow-2xl p-10 text-center overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-red-500" />
              <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <Trash2 className="w-10 h-10 text-red-500 dark:text-red-400" />
              </div>
              <h3 className="text-2xl font-black text-neutral-900 dark:text-neutral-50 mb-3 tracking-tight">Confirm Deletion</h3>
              <p className="text-neutral-500 dark:text-neutral-400 mb-10 font-medium leading-relaxed">
                Are you sure you want to delete this {docToDelete?.col.slice(0, -1)}? This action is permanent and cannot be undone.
              </p>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowConfirmDelete(false)}
                  className="flex-1 px-6 py-4 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-50 rounded-2xl font-bold hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all text-xs uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => docToDelete && deleteDocById(docToDelete.col, docToDelete.id)}
                  disabled={isDeleting}
                  className="flex-1 px-6 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-3 text-xs uppercase tracking-widest shadow-lg shadow-red-200 dark:shadow-none"
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete Now'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
