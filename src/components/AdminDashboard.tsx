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

function CountdownTimer({ deadline }: { deadline: string }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date().getTime();
      const target = new Date(deadline).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft('Overdue');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return (
    <div className="text-right">
      <p className={`text-xs font-semibold tracking-tight ${timeLeft === 'Overdue' ? 'text-red-500' : 'text-neutral-900'}`}>
        {timeLeft}
      </p>
      <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider">Remaining</p>
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
    userId: '',
    type: 'Assignment' as 'Quiz' | 'Assignment' | 'Presentation',
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
    if (!newAssignment.title.trim() || !newAssignment.course || !newAssignment.deadline || !newAssignment.userId) return;
    
    setIsUpdating(true);
    try {
      await addDoc(collection(db, 'assignments'), {
        ...newAssignment,
        total_hours: 1, // Default to 1 to avoid division by zero
        completed_hours: 0,
        urgency: calculateUrgency(newAssignment.deadline, 0, 1),
        createdBy: 'admin',
        createdAt: serverTimestamp(),
      });
      setNewAssignment({ title: '', course: '', deadline: '', userId: '', type: 'Assignment' });
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
          <h1 className="text-4xl font-semibold text-neutral-900 tracking-tight mb-1">
            Admin Console
          </h1>
          <p className="text-neutral-500 font-medium text-sm">
            Managing {users.filter(u => u.role === 'student').length} Active Students
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl border border-neutral-200 shadow-sm">
          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-[11px] font-medium text-neutral-500 tracking-tight">Admin Mode Active</span>
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
            className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm hover:border-neutral-300 transition-all flex flex-col items-center justify-center text-center space-y-2 group"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
              stat.color === 'blue' ? 'bg-blue-50 text-blue-500' :
              stat.color === 'red' ? 'bg-red-50 text-red-500' :
              stat.color === 'green' ? 'bg-green-50 text-green-500' :
              stat.color === 'amber' ? 'bg-amber-50 text-amber-500' :
              'bg-neutral-50 text-neutral-400'
            }`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div>
              <p className={`text-xl font-semibold ${stat.valueColor || 'text-neutral-900'}`}>{stat.value}</p>
              <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wider">{stat.label}</p>
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
        className="flex flex-wrap items-center justify-between gap-4 p-1.5 bg-neutral-100 rounded-2xl border border-neutral-200"
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
                  ? 'bg-white shadow-sm text-neutral-900' 
                  : 'text-neutral-500 hover:text-neutral-700 hover:bg-white/50'
              }`}
            >
              <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-neutral-900' : 'text-neutral-400'}`} />
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
              className="pl-10 pr-4 py-2 bg-white border border-neutral-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all w-full md:w-56 shadow-sm"
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
            <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm h-fit">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-500">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 tracking-tight">New Course</h3>
              </div>
              <form onSubmit={handleAddCourse} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider ml-1">Course Name</label>
                  <input 
                    type="text"
                    value={newCourse}
                    onChange={e => setNewCourse(e.target.value)}
                    placeholder="e.g. Mathematics"
                    className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all text-sm"
                  />
                </div>
                <button className="w-full bg-neutral-900 text-white py-2.5 rounded-xl font-semibold hover:bg-neutral-800 transition-all shadow-sm active:scale-[0.98] text-sm">
                  Create Course
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-semibold text-neutral-900 tracking-tight">Manage Courses</h3>
                <span className="px-3 py-1 bg-neutral-100 rounded-lg text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                  {courses.length} Total
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {courses.map(course => (
                  <motion.div 
                    layout
                    key={course.id} 
                    className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm flex items-center justify-between group hover:border-neutral-300 transition-all"
                  >
                    {editingCourse?.id === course.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input 
                          type="text"
                          value={editingCourse.name}
                          onChange={e => setEditingCourse({ ...editingCourse, name: e.target.value })}
                          className="flex-1 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/10 text-sm font-medium"
                          autoFocus
                        />
                        <button 
                          onClick={() => setShowConfirmUpdate(true)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setEditingCourse(null)}
                          className="p-2 text-neutral-400 hover:bg-neutral-100 rounded-lg transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-neutral-50 rounded-lg flex items-center justify-center text-neutral-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-semibold text-neutral-900 tracking-tight">{course.name}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => setEditingCourse(course)}
                            className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-all"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => {
                              setDocToDelete({ col: 'courses', id: course.id });
                              setShowConfirmDelete(true);
                            }}
                            className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-all"
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
                    className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-sm bg-white rounded-3xl shadow-2xl p-8 text-center"
                  >
                    <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <AlertCircle className="w-8 h-8 text-neutral-900" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Confirm Changes</h3>
                    <p className="text-neutral-500 mb-8">Are you sure you want to rename this course to <span className="font-bold text-neutral-900">"{editingCourse?.name}"</span>?</p>
                    
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setShowConfirmUpdate(false)}
                        className="flex-1 px-4 py-3 bg-neutral-100 text-neutral-900 rounded-xl font-bold hover:bg-neutral-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleUpdateCourse}
                        disabled={isUpdating}
                        className="flex-1 px-4 py-3 bg-neutral-900 text-white rounded-xl font-bold hover:bg-neutral-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
            <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm h-fit">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center text-amber-500">
                  <Megaphone className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 tracking-tight">Post Update</h3>
              </div>
              <form onSubmit={handleAddAnnouncement} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider ml-1">Title</label>
                  <input 
                    type="text"
                    value={newAnnouncement.title}
                    onChange={e => setNewAnnouncement({...newAnnouncement, title: e.target.value})}
                    placeholder="Announcement title..."
                    className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider ml-1">Content</label>
                  <textarea 
                    value={newAnnouncement.content}
                    onChange={e => setNewAnnouncement({...newAnnouncement, content: e.target.value})}
                    placeholder="Write your message here..."
                    rows={4}
                    className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all resize-none text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider ml-1">Priority</label>
                  <div className="flex gap-2">
                    {['normal', 'important'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewAnnouncement({ ...newAnnouncement, priority: p as any })}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-wider border transition-all ${
                          newAnnouncement.priority === p
                            ? (p === 'important' ? 'bg-red-600 text-white border-red-600' : 'bg-neutral-900 text-white border-neutral-900')
                            : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="w-full bg-neutral-900 text-white py-2.5 rounded-xl font-semibold hover:bg-neutral-800 transition-all shadow-sm active:scale-[0.98] text-sm">
                  Post Announcement
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xl font-semibold text-neutral-900 tracking-tight">Recent Updates</h3>
                <span className="px-3 py-1 bg-neutral-100 rounded-lg text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
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
                    className={`bg-white p-5 rounded-2xl border shadow-sm relative group transition-all hover:border-neutral-300 ${
                      ann.priority === 'important' ? 'border-red-100 bg-red-50/5' : 'border-neutral-200'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:rotate-6 ${
                          ann.priority === 'important' ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-900'
                        }`}>
                          <Megaphone className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-neutral-900 text-base tracking-tight">{ann.title}</h3>
                            {ann.priority === 'important' && (
                              <span className="px-2 py-0.5 bg-red-600 text-white text-[9px] font-semibold uppercase tracking-wider rounded-md">Important</span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 font-medium">
                            {new Date(ann.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteDocById('announcements', ann.id!)}
                        className="p-2 text-neutral-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-neutral-600 text-sm whitespace-pre-wrap leading-relaxed pl-13">{ann.content}</p>
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
            <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm h-fit sticky top-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-neutral-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-neutral-200">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-neutral-900 tracking-tight">Create New Task</h3>
                  <p className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Assign work to students</p>
                </div>
              </div>
              <form onSubmit={handleAddAssignment} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest ml-1">Assignment Title</label>
                  <div className="relative">
                    <Edit2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      required
                      type="text"
                      value={newAssignment.title}
                      onChange={e => setNewAssignment({...newAssignment, title: e.target.value})}
                      placeholder="e.g. Calculus Problem Set #4"
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest ml-1">Assign to Student</label>
                  <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <select 
                      required
                      value={newAssignment.userId}
                      onChange={e => setNewAssignment({...newAssignment, userId: e.target.value})}
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all appearance-none text-sm font-medium"
                    >
                      <option value="">Select a student</option>
                      {users.filter(u => u.role === 'student').map(student => (
                        <option key={student.uid} value={student.uid}>{student.username || student.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest ml-1">Course</label>
                  <div className="relative">
                    <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      required
                      list="course-list"
                      type="text"
                      value={newAssignment.course}
                      onChange={e => setNewAssignment({...newAssignment, course: e.target.value})}
                      placeholder="Select or type course"
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium"
                    />
                    <datalist id="course-list">
                      {courses.map(s => (
                        <option key={s.id} value={s.name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest ml-1">Task Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Quiz', 'Assignment', 'Presentation'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewAssignment({ ...newAssignment, type: t as any })}
                        className={`py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${
                          newAssignment.type === t
                            ? 'bg-neutral-900 text-white border-neutral-900 shadow-md'
                            : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest ml-1">Due Date & Time</label>
                  <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      required
                      type="datetime-local"
                      value={newAssignment.deadline}
                      onChange={e => setNewAssignment({...newAssignment, deadline: e.target.value})}
                      className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-900/20 transition-all text-sm font-medium"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isUpdating}
                  className="w-full bg-neutral-900 text-white py-4 rounded-2xl font-bold hover:bg-neutral-800 transition-all shadow-xl shadow-neutral-200 active:scale-[0.98] flex items-center justify-center gap-3 text-xs uppercase tracking-widest mt-4"
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
                  <h3 className="text-2xl font-bold text-neutral-900 tracking-tight">Active Assignments</h3>
                  <p className="text-[11px] text-neutral-400 font-semibold uppercase tracking-widest mt-1">Real-time status tracking</p>
                </div>
                <div className="flex items-center gap-2 bg-neutral-100 px-4 py-2 rounded-xl border border-neutral-200">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-wider">
                    {allAssignments.filter(a => !isTaskDone(a)).length} Tasks In Progress
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50/50 border-bottom border-neutral-100">
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Assignment Details</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Assigned Student</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Progress</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Urgency</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Deadline</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {allAssignments.filter(a => !isTaskDone(a)).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-8 py-20 text-center">
                            <div className="flex flex-col items-center gap-3 opacity-40">
                              <LayoutGrid className="w-10 h-10 text-neutral-300" />
                              <p className="text-sm font-medium text-neutral-500">No active assignments found.</p>
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
                            <tr key={assignment.id} className="hover:bg-neutral-50/30 transition-all group">
                              <td className="px-8 py-6">
                                <div className="flex flex-col gap-1">
                                  <p className="font-bold text-neutral-900 text-sm tracking-tight group-hover:text-blue-600 transition-colors">{assignment.title}</p>
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-neutral-100 rounded text-[9px] font-bold text-neutral-500 uppercase tracking-wider">{assignment.course}</span>
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                      assignment.type === 'Quiz' ? 'bg-purple-50 text-purple-600' :
                                      assignment.type === 'Presentation' ? 'bg-amber-50 text-amber-600' :
                                      'bg-blue-50 text-blue-600'
                                    }`}>
                                      {assignment.type}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 bg-neutral-100 rounded-xl flex items-center justify-center text-neutral-400 border border-neutral-200 group-hover:bg-white transition-colors">
                                    {student?.photoURL ? (
                                      <img src={student.photoURL} alt="" className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
                                    ) : (
                                      <UserCircle2 className="w-5 h-5" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-neutral-900">{student?.username || student?.name || 'Unknown'}</p>
                                    <p className="text-[10px] text-neutral-400 font-medium tracking-tight">{student?.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="w-32 space-y-1.5">
                                  <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-neutral-400">
                                    <span>{Math.round((assignment.completed_hours / assignment.total_hours) * 100)}%</span>
                                    <div className="flex items-center gap-1">
                                      <button 
                                        onClick={() => {
                                          const newVal = Math.max(0, assignment.completed_hours - 0.5);
                                          updateDoc(doc(db, 'assignments', assignment.id!), { 
                                            completed_hours: newVal,
                                            urgency: calculateUrgency(assignment.deadline, newVal, assignment.total_hours)
                                          });
                                        }}
                                        className="hover:text-neutral-900 transition-colors"
                                      >
                                        -
                                      </button>
                                      <button 
                                        onClick={() => {
                                          const newVal = Math.min(assignment.total_hours, assignment.completed_hours + 0.5);
                                          updateDoc(doc(db, 'assignments', assignment.id!), { 
                                            completed_hours: newVal,
                                            urgency: calculateUrgency(assignment.deadline, newVal, assignment.total_hours)
                                          });
                                        }}
                                        className="hover:text-neutral-900 transition-colors"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                  <div className="h-1 w-full bg-neutral-100 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full rounded-full transition-all duration-500 ${
                                        isTaskDone(assignment) ? 'bg-emerald-500' : 'bg-blue-600'
                                      }`}
                                      style={{ width: `${(assignment.completed_hours / assignment.total_hours) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${
                                    urgency === 'urgent' ? 'bg-red-500 animate-pulse' :
                                    urgency === 'medium' ? 'bg-amber-500' :
                                    'bg-blue-500'
                                  }`} />
                                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${
                                    urgency === 'urgent' ? 'bg-red-50 text-red-600' :
                                    urgency === 'medium' ? 'bg-amber-50 text-amber-600' :
                                    'bg-blue-50 text-blue-600'
                                  }`}>
                                    {urgency}
                                  </span>
                                </div>
                              </td>
                              <td className="px-8 py-6">
                                <CountdownTimer deadline={assignment.deadline} />
                              </td>
                              <td className="px-8 py-6 text-right">
                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                  <button 
                                    onClick={() => {
                                      setDocToDelete({ col: 'assignments', id: assignment.id! });
                                      setShowConfirmDelete(true);
                                    }}
                                    className="p-2.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                    title="Delete Task"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
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
                <h3 className="text-2xl font-bold text-neutral-900 tracking-tight">Task History</h3>
                <p className="text-[11px] text-neutral-400 font-semibold uppercase tracking-widest mt-1">Archive of completed and expired tasks</p>
              </div>
              <div className="flex items-center gap-2 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                  {allAssignments.filter(a => isTaskDone(a)).length} Total Archived
                </span>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-neutral-50/50 border-bottom border-neutral-100">
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Assignment</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Student</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Status</th>
                      <th className="px-8 py-5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {allAssignments.filter(a => isTaskDone(a)).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-8 py-20 text-center">
                          <div className="flex flex-col items-center gap-3 opacity-40">
                            <Clock className="w-10 h-10 text-neutral-300" />
                            <p className="text-sm font-medium text-neutral-500">No task history available.</p>
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
                          <tr key={assignment.id} className="hover:bg-neutral-50/30 transition-all group opacity-80 hover:opacity-100">
                            <td className="px-8 py-6">
                              <div className="flex flex-col gap-1">
                                <p className="font-bold text-neutral-500 line-through text-sm tracking-tight">{assignment.title}</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider">{assignment.course}</span>
                                  <span className="w-1 h-1 bg-neutral-200 rounded-full" />
                                  <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider">{assignment.type}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-neutral-50 rounded-xl flex items-center justify-center text-neutral-300 border border-neutral-100">
                                  {student?.photoURL ? (
                                    <img src={student.photoURL} alt="" className="w-full h-full object-cover rounded-xl grayscale opacity-50" referrerPolicy="no-referrer" />
                                  ) : (
                                    <UserCircle2 className="w-5 h-5" />
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-neutral-500">{student?.username || student?.name || 'Unknown'}</p>
                                  <p className="text-[10px] text-neutral-400 font-medium tracking-tight">{student?.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${isExpired ? 'bg-neutral-300' : 'bg-emerald-500'}`} />
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest ${
                                  isExpired ? 'bg-neutral-100 text-neutral-500' : 'bg-emerald-50 text-emerald-600'
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
                                className="p-2.5 text-neutral-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
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
                  className="flex items-center gap-3 px-8 py-4 bg-white border border-neutral-200 rounded-3xl text-neutral-600 hover:text-neutral-900 font-black text-[10px] uppercase tracking-widest transition-all shadow-sm hover:shadow-xl active:scale-[0.98]"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Student List
                </button>
                <div className="bg-white rounded-[3rem] border border-neutral-100 shadow-soft p-2 overflow-hidden">
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
                    <h3 className="text-4xl font-black text-neutral-900 tracking-tighter mb-2">Student Directory</h3>
                    <p className="text-neutral-400 font-bold uppercase tracking-[0.2em] text-[10px]">
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
                      const activeCount = studentAssignments.length - completedCount;

                      return (
                        <motion.div 
                          key={student.uid}
                          layout
                          initial={{ opacity: 0, scale: 0.9, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="bg-white p-10 rounded-[3rem] border border-neutral-100 shadow-soft hover:shadow-2xl transition-all duration-500 group relative overflow-hidden"
                        >
                          <div className="flex items-start justify-between mb-10">
                            <div className="flex items-center gap-5">
                              <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center text-neutral-400 group-hover:bg-neutral-900 group-hover:text-white transition-all duration-700 shadow-sm">
                                {student.photoURL ? (
                                  <img src={student.photoURL} alt="" className="w-full h-full object-cover rounded-2xl" referrerPolicy="no-referrer" />
                                ) : (
                                  <UserCircle2 className="w-8 h-8" />
                                )}
                              </div>
                              <div>
                                <h4 className="font-black text-neutral-900 text-xl leading-tight tracking-tight">{student.username || student.name}</h4>
                                <p className="text-[10px] text-neutral-400 font-black uppercase tracking-widest mt-1">{student.email}</p>
                              </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                              <button 
                                onClick={() => toggleUserStatus(student)}
                                disabled={isProcessing === student.uid}
                                className={`p-3 rounded-xl transition-all ${
                                  student.disabled 
                                    ? 'text-emerald-600 hover:bg-emerald-50' 
                                    : 'text-amber-600 hover:bg-amber-50'
                                }`}
                                title={student.disabled ? 'Enable Account' : 'Disable Account'}
                              >
                                {isProcessing === student.uid ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  student.disabled ? <CheckCircle2 className="w-4 h-4" /> : <X className="w-4 h-4" />
                                )}
                              </button>
                              <button 
                                onClick={() => resetStudentProgress(student.uid)}
                                disabled={isProcessing === student.uid}
                                className="p-3 text-neutral-300 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                                title="Reset Progress"
                              >
                                <History className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setEditingStudentProfile(student)}
                                className="p-3 text-neutral-300 hover:text-neutral-900 hover:bg-neutral-50 rounded-xl transition-all"
                                title="Edit Profile"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => {
                                  setDocToDelete({ col: 'users', id: student.uid });
                                  setShowConfirmDelete(true);
                                }}
                                className="p-3 text-neutral-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                title="Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-10">
                            <div className="bg-neutral-50 p-6 rounded-3xl text-center border border-neutral-100 group-hover:bg-white transition-colors duration-500">
                              <p className="text-3xl font-black text-neutral-900 tracking-tighter">{activeCount}</p>
                              <p className="text-[9px] font-black text-neutral-400 uppercase tracking-widest mt-1">Active</p>
                            </div>
                            <div className="bg-emerald-50/30 p-6 rounded-3xl text-center border border-emerald-100/50 group-hover:bg-white transition-colors duration-500">
                              <p className="text-3xl font-black text-emerald-600 tracking-tighter">{completedCount}</p>
                              <p className="text-[9px] font-black text-emerald-600/60 uppercase tracking-widest mt-1">Done</p>
                            </div>
                          </div>

                          <button 
                            onClick={() => setSelectedStudentId(student.uid)}
                            className="w-full py-5 bg-neutral-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all flex items-center justify-center gap-3 shadow-xl shadow-neutral-200 active:scale-[0.98]"
                          >
                            <Settings2 className="w-4 h-4" />
                            Manage Student
                          </button>

                          <Users className="absolute -right-6 -bottom-6 w-40 h-40 text-neutral-900/5 -rotate-12 group-hover:rotate-0 group-hover:scale-110 transition-all duration-700 pointer-events-none" />
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
              <h3 className="text-4xl font-black text-neutral-900 tracking-tighter mb-2">Total User Directory</h3>
              <p className="text-neutral-400 font-bold uppercase tracking-[0.2em] text-[10px]">
                {users.length} Registered Users (Admins & Students)
              </p>
            </div>

            <div className="bg-white rounded-[3rem] border border-neutral-100 shadow-soft overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-neutral-50/50 border-b border-neutral-100">
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 uppercase tracking-widest">User</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Email</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Role</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Status</th>
                    <th className="px-10 py-6 text-[10px] font-black text-neutral-400 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {users
                    .filter(u => 
                      (u.username || u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((user) => (
                    <tr key={user.uid} className="group hover:bg-neutral-50/50 transition-colors">
                      <td className="px-10 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-neutral-100 overflow-hidden flex items-center justify-center">
                            {user.photoURL ? (
                              <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <UserCircle2 className="w-5 h-5 text-neutral-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900 text-sm">{user.username || user.name}</p>
                            <p className="text-[10px] text-neutral-400 font-medium">{user.uid.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-10 py-6 text-sm text-neutral-600 font-medium">{user.email}</td>
                      <td className="px-10 py-6">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          user.role === 'admin' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-10 py-6">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          user.disabled ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
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
                              user.disabled ? 'text-emerald-600 hover:bg-emerald-50' : 'text-amber-600 hover:bg-amber-50'
                            }`}
                          >
                            {user.disabled ? <CheckCircle2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
                          </button>
                          <button 
                            onClick={() => setEditingStudentProfile(user)}
                            className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
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
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10 text-center overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-red-500" />
              <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <Trash2 className="w-10 h-10 text-red-500" />
              </div>
              <h3 className="text-2xl font-black text-neutral-900 mb-3 tracking-tight">Confirm Deletion</h3>
              <p className="text-neutral-500 mb-10 font-medium leading-relaxed">
                Are you sure you want to delete this {docToDelete?.col.slice(0, -1)}? This action is permanent and cannot be undone.
              </p>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowConfirmDelete(false)}
                  className="flex-1 px-6 py-4 bg-neutral-100 text-neutral-900 rounded-2xl font-bold hover:bg-neutral-200 transition-all text-xs uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => docToDelete && deleteDocById(docToDelete.col, docToDelete.id)}
                  disabled={isDeleting}
                  className="flex-1 px-6 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-3 text-xs uppercase tracking-widest shadow-lg shadow-red-200"
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
