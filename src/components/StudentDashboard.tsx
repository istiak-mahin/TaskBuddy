import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import { Assignment, UserProfile, Course, Announcement, AppNotification } from '../types';
import { Plus, Trash2, CheckCircle2, AlertCircle, Clock, BookOpen, BarChart3, X, Megaphone, Trophy, Target, Bell, Search, Filter, History, Star, Loader2, Send, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface StudentDashboardProps {
  profile: UserProfile;
  isAdmin: boolean;
  studentId?: string;
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

      if (diff > 24 * 60 * 60 * 1000) {
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setTimeLeft(`${d}d ${h}h ${m}m`);
      } else {
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${h}h ${m}m ${s}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [deadline, isDone]);

  if (isDone) {
    return (
      <div className="text-right">
        <p className="text-xs font-semibold tracking-tight text-emerald-500">
          Completed
        </p>
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

export default function StudentDashboard({ profile, isAdmin, studentId }: StudentDashboardProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [activeTab, setActiveTab] = useState<'assignments' | 'announcements' | 'history'>('assignments');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCourse, setFilterCourse] = useState('all');
  const [filterDeadline, setFilterDeadline] = useState<'all' | 'active' | 'completed'>('active');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [newAssignment, setNewAssignment] = useState({
    title: '',
    course: '',
    deadline: '',
    type: 'Assignment' as 'Quiz' | 'Assignment' | 'Presentation',
  });

  const [showAddNoticeModal, setShowAddNoticeModal] = useState(false);
  const [newNotice, setNewNotice] = useState({
    title: '',
    content: '',
    priority: 'normal' as 'normal' | 'important'
  });

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'assignments'), orderBy('createdAt', 'desc'));
      
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Assignment));
      setAssignments(data);
      setLoading(false);
    });

    const subQ = query(collection(db, 'courses'));
    const unsubscribeSubs = onSnapshot(subQ, (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Course)));
    });

    const annQ = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(20));
    const unsubscribeAnns = onSnapshot(annQ, (snapshot) => {
      setAnnouncements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement)));
    });

    const notifQ = query(
      collection(db, 'notifications'), 
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsubscribeNotifs = onSnapshot(notifQ, (snapshot) => {
      const newNotifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification));
      
      // Check for new unread notifications to show browser push
      newNotifs.forEach(notif => {
        const isNew = !notifications.find(n => n.id === notif.id);
        if (isNew && !notif.read && Notification.permission === "granted") {
          new Notification(notif.title, { body: notif.message });
        }
      });

      setNotifications(newNotifs);
    });

    return () => {
      unsubscribe();
      unsubscribeSubs();
      unsubscribeAnns();
      unsubscribeNotifs();
    };
  }, [profile.uid, isAdmin, studentId]);

  const calculateTimeProgress = (assignment: Assignment) => {
    if (isTaskDone(assignment)) return 100;
    
    try {
      const now = new Date().getTime();
      const deadline = new Date(assignment.deadline).getTime();
      
      // Handle Firestore Timestamp vs ISO string
      let start: number;
      if (assignment.createdAt?.seconds) {
        start = assignment.createdAt.seconds * 1000;
      } else if (assignment.createdAt) {
        start = new Date(assignment.createdAt).getTime();
      } else {
        // Fallback: If no createdAt, assume it was created 7 days before deadline 
        // or 24 hours ago if deadline is passed
        start = deadline - (7 * 24 * 60 * 60 * 1000);
      }

      if (isNaN(start) || isNaN(deadline)) return 0;
      
      const total = deadline - start;
      const elapsed = now - start;
      
      if (total <= 0) return 100;
      
      const progress = (elapsed / total) * 100;
      return Math.min(Math.max(Math.round(progress), 0), 100);
    } catch (e) {
      return 0;
    }
  };

  const isTaskDone = (assignment: Assignment) => {
    if (assignment.urgency === 'done') return true;
    const deadline = new Date(assignment.deadline).getTime();
    return deadline <= currentTime.getTime();
  };

  const handleAddAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      await addDoc(collection(db, 'assignments'), {
        ...newAssignment,
        userId: isAdmin && studentId ? studentId : profile.uid,
        total_hours: 1,
        completed_hours: 0,
        urgency: 'low',
        createdBy: 'admin',
        createdAt: serverTimestamp(),
      });
      setShowAddModal(false);
      setNewAssignment({ title: '', course: '', deadline: '', type: 'Assignment' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'assignments');
    }
  };

  const handleEditAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editingAssignment) return;
    try {
      const docRef = doc(db, 'assignments', editingAssignment.id);
      await updateDoc(docRef, {
        title: editingAssignment.title,
        course: editingAssignment.course,
        deadline: editingAssignment.deadline,
        type: editingAssignment.type,
      });
      setEditingAssignment(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `assignments/${editingAssignment.id}`);
    }
  };

  const deleteAssignment = async (id: string) => {
    if (!isAdmin) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'assignments', id));
      setShowConfirmDelete(false);
      setDocToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `assignments/${id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const sendReminder = async (assignment: Assignment) => {
    if (!isAdmin || !studentId) return;
    try {
      const title = 'Assignment Reminder';
      const message = `Reminder: Your assignment "${assignment.title}" for ${assignment.course} is due on ${new Date(assignment.deadline).toLocaleDateString()}.`;

      // 1. Send In-App Notification
      await addDoc(collection(db, 'notifications'), {
        userId: studentId,
        title,
        message,
        type: 'reminder',
        read: false,
        createdAt: new Date().toISOString(),
        assignmentId: assignment.id
      });

      // 2. Send Email Reminder via Server
      try {
        await fetch('/api/reminders/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: studentId, title, message })
        });
      } catch (e) {
        console.error('Failed to trigger email reminder:', e);
      }

      alert('Reminder sent to student (In-app and Email)!');
    } catch (error) {
      console.error('Error sending reminder:', error);
    }
  };

  const markNotificationAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllNotificationsAsRead = async () => {
    try {
      const unreadNotifs = notifications.filter(n => !n.read);
      const promises = unreadNotifs.map(n => updateDoc(doc(db, 'notifications', n.id!), { read: true }));
      await Promise.all(promises);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const handleAddNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'announcements'), {
        ...newNotice,
        createdAt: new Date().toISOString(),
        createdBy: profile.uid,
      });
      setShowAddNoticeModal(false);
      setNewNotice({ title: '', content: '', priority: 'normal' });
    } catch (error) {
      console.error('Error adding notice:', error);
    }
  };

  const filteredAssignments = assignments.filter(a => {
    const matchesSearch = a.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         a.course.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCourse = filterCourse === 'all' || a.course === filterCourse;
    
    const isDone = isTaskDone(a);
    const now = new Date().getTime();
    const deadline = new Date(a.deadline).getTime();
    const isOverdue = !isDone && deadline <= now;

    let matchesDeadline = true;
    if (filterDeadline === 'active') matchesDeadline = !isDone;
    else if (filterDeadline === 'completed') matchesDeadline = isDone;

    return matchesSearch && matchesCourse && matchesDeadline;
  });

  const stats = [
    { label: 'Active Tasks', value: assignments.filter(a => !isTaskDone(a)).length, icon: Target, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
    { label: 'Completed', value: assignments.filter(a => isTaskDone(a)).length, icon: Trophy, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    { label: 'Notices', value: announcements.length, icon: Bell, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* Welcome Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-end justify-between gap-6"
      >
        <div>
          <h1 className="text-4xl font-semibold text-neutral-900 tracking-tight mb-1">
            Hello, {profile.username || profile.name.split(' ')[0]}
          </h1>
          <p className="text-neutral-500 font-medium text-sm">
            {isAdmin ? 'Reviewing Student Progress' : 'Your Academic Overview'}
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white dark:bg-neutral-900 px-4 py-2.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm relative transition-colors">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 tracking-tight">System Online</span>
          
          <div className="w-px h-3 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-lg transition-colors group"
          >
            <Bell className={`w-4 h-4 transition-colors ${notifications.some(n => !n.read) ? 'text-blue-600' : 'text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-neutral-100'}`} />
            {notifications.some(n => !n.read) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full border-2 border-white dark:border-neutral-900" />
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowNotifications(false)} 
                />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-4 w-80 bg-white rounded-3xl border border-neutral-200 shadow-2xl z-50 overflow-hidden"
                >
                  <div className="p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-neutral-900">Notifications</h4>
                    <div className="flex items-center gap-2">
                      {notifications.some(n => !n.read) && (
                        <button 
                          onClick={markAllNotificationsAsRead}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                        >
                          Mark all read
                        </button>
                      )}
                      <button 
                        onClick={() => setShowNotifications(false)} 
                        className="p-1 hover:bg-neutral-200 rounded-lg transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-neutral-500" />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto custom-scrollbar">
                    {notifications.length > 0 ? (
                      notifications.map((notif) => (
                        <div 
                          key={notif.id} 
                          className={`p-5 border-b border-neutral-50 last:border-0 transition-all hover:bg-neutral-50 cursor-pointer ${!notif.read ? 'bg-blue-50/30' : ''}`}
                          onClick={() => markNotificationAsRead(notif.id!)}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                              notif.type === 'reminder' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'
                            }`}>
                              <Bell className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-neutral-900 mb-0.5">{notif.title}</p>
                              <p className="text-xs text-neutral-500 font-medium leading-relaxed line-clamp-2">{notif.message}</p>
                              <p className="text-[10px] font-medium text-neutral-400 mt-2">
                                {new Date(notif.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-12 text-center">
                        <div className="w-12 h-12 bg-neutral-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <Bell className="w-6 h-6 text-neutral-200" />
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">All caught up</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex items-center justify-between group hover:border-neutral-300 dark:hover:border-neutral-700 transition-all duration-200 cursor-default"
          >
            <div>
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">{stat.label}</p>
              <h3 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">{stat.value}</h3>
            </div>
            <div className={`w-10 h-10 ${stat.bg} dark:bg-opacity-20 rounded-xl flex items-center justify-center transition-all duration-200`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden transition-colors">
        {/* Tab Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-neutral-100 dark:border-neutral-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-1 bg-neutral-100/50 dark:bg-neutral-800 p-1 rounded-xl w-full sm:w-fit overflow-x-auto no-scrollbar">
            {(['assignments', 'announcements', 'history'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-[11px] sm:text-[12px] font-medium transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab 
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm' 
                    : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {activeTab === 'assignments' && (
              <>
                <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-xl">
                  {(['active', 'completed'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilterDeadline(f)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                        filterDeadline === f 
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-sm' 
                          : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 xs:flex-none min-w-[140px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
                  <input 
                    type="text"
                    placeholder="Search tasks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-[12px] sm:text-sm font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all w-full md:w-48"
                  />
                </div>
                <div className="relative flex-1 xs:flex-none min-w-[140px]">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
                  <select
                    value={filterCourse}
                    onChange={(e) => setFilterCourse(e.target.value)}
                    className="pl-9 pr-8 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-[10px] sm:text-xs font-medium text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all cursor-pointer appearance-none w-full md:w-40"
                  >
                    <option value="all">All Courses</option>
                    {courses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                {isAdmin && (
                  <button 
                    onClick={() => setShowAddModal(true)}
                    className="flex-1 sm:flex-none justify-center bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 px-4 py-2 rounded-xl text-xs font-medium hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all flex items-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="xs:inline">New Task</span>
                  </button>
                )}
              </>
            )}

            {activeTab === 'announcements' && isAdmin && (
              <button 
                onClick={() => setShowAddNoticeModal(true)}
                className="bg-neutral-900 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all shadow-lg shadow-neutral-200 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Post Notice
              </button>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'assignments' && (
              <motion.div
                key="assignments"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-4"
              >
                {filteredAssignments.length > 0 ? (
                  filteredAssignments.map((assignment, i) => (
                    <motion.div
                      key={assignment.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="group bg-neutral-50/50 dark:bg-neutral-800/20 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 hover:bg-white dark:hover:bg-neutral-800 hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-all duration-200 relative overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-md text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                            {assignment.course}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium ${
                            assignment.type === 'Quiz' ? 'bg-purple-50 text-purple-600 border border-purple-100' :
                            assignment.type === 'Presentation' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                            'bg-neutral-900 text-white'
                          }`}>
                            {assignment.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-neutral-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="text-[11px] font-medium">
                            {new Date(assignment.deadline).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <h4 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 mb-4 group-hover:text-neutral-700 dark:group-hover:text-neutral-300 transition-colors">
                        {assignment.title}
                      </h4>

                      {/* Time Progress Bar */}
                      <div className="mb-6 space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
                          <span>Time Elapsed</span>
                          <span className="text-neutral-900 dark:text-neutral-200">{calculateTimeProgress(assignment)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${calculateTimeProgress(assignment)}%` }}
                            className={`h-full rounded-full ${
                              assignment.urgency === 'done' ? 'bg-emerald-500' : 
                              calculateTimeProgress(assignment) === 100 ? 'bg-red-500' :
                              calculateTimeProgress(assignment) > 80 ? 'bg-red-500' :
                              calculateTimeProgress(assignment) > 50 ? 'bg-amber-500' : 'bg-blue-600'
                            }`}
                          />
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
                        <CountdownTimer deadline={assignment.deadline} isDone={assignment.urgency === 'done'} />
                        {isAdmin && (
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => sendReminder(assignment)}
                              title="Send Reminder"
                              className="p-2 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => setEditingAssignment(assignment)}
                              className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-all"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => {
                                setDocToDelete(assignment.id!);
                                setShowConfirmDelete(true);
                              }}
                              className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-full py-20 text-center">
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="w-20 h-20 bg-neutral-50 rounded-3xl flex items-center justify-center mx-auto mb-6"
                    >
                      <BookOpen className="w-8 h-8 text-neutral-200" />
                    </motion.div>
                    <h3 className="text-xl font-bold text-neutral-900 mb-2">All tasks completed</h3>
                    <p className="text-neutral-500 text-sm font-medium max-w-xs mx-auto">
                      Great job! You've finished all your current assignments and quizzes.
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'announcements' && (
              <motion.div
                key="announcements"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-3"
              >
                {announcements.length > 0 ? (
                  announcements.map((notice, i) => (
                    <motion.div
                      key={notice.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-neutral-50/50 border border-neutral-200 rounded-xl p-5 flex flex-col md:flex-row gap-6 items-start group hover:bg-white hover:shadow-sm transition-all duration-200"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        notice.priority === 'important' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        <Bell className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-semibold text-neutral-900 tracking-tight">{notice.title}</h4>
                            {notice.priority === 'important' && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-md text-[10px] font-medium uppercase tracking-wider">Urgent</span>
                            )}
                          </div>
                          <span className="text-[11px] font-medium text-neutral-400">
                            {new Date(notice.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-600 leading-relaxed font-medium">{notice.content}</p>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="py-20 text-center">
                    <Megaphone className="w-12 h-12 text-neutral-100 mx-auto mb-4" />
                    <p className="text-sm font-medium text-neutral-400">No announcements yet</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-2"
              >
                {assignments.filter(a => isTaskDone(a)).length > 0 ? (
                  assignments
                    .filter(a => isTaskDone(a))
                    .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime())
                    .map((item, i) => {
                      const isExpired = item.urgency !== 'done';
                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="bg-white border border-neutral-200 rounded-xl p-4 flex items-center justify-between group hover:border-neutral-300 transition-all duration-200"
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-8 h-8 ${isExpired ? 'bg-neutral-50' : 'bg-emerald-50'} rounded-lg flex items-center justify-center`}>
                              {isExpired ? <Clock className="w-4 h-4 text-neutral-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                            </div>
                            <div>
                              <h4 className={`text-sm font-semibold tracking-tight ${isExpired ? 'text-neutral-400 line-through' : 'text-neutral-900'}`}>{item.title}</h4>
                              <div className="text-[11px] text-neutral-500 font-medium mt-0.5 flex items-center gap-2">
                                <span className="px-1.5 py-0.5 bg-neutral-100 rounded-md">{item.course}</span>
                                <span>•</span>
                                <span className={isExpired ? 'text-neutral-400' : 'text-neutral-500'}>
                                  {isExpired ? 'Expired' : 'Completed'} on {new Date(item.deadline).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className={`px-3 py-1 ${isExpired ? 'bg-neutral-100 text-neutral-400' : 'bg-emerald-50 text-emerald-600'} rounded-lg text-[10px] font-medium tracking-tight`}>
                            {isExpired ? 'Overdue' : 'Archived'}
                          </div>
                        </motion.div>
                      );
                    })
                ) : (
                  <div className="py-20 text-center">
                    <Trophy className="w-12 h-12 text-neutral-100 mx-auto mb-4" />
                    <p className="text-sm font-medium text-neutral-400">Your history is empty</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {(showAddModal || editingAssignment) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowAddModal(false); setEditingAssignment(null); }}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-[2.5rem] shadow-2xl dark:shadow-none p-10 border border-transparent dark:border-neutral-800 transition-colors"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">{editingAssignment ? 'Edit' : 'New'} Assignment</h2>
                <button onClick={() => { setShowAddModal(false); setEditingAssignment(null); }} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={editingAssignment ? handleEditAssignment : handleAddAssignment} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Title</label>
                  <input 
                    required
                    type="text"
                    value={editingAssignment ? editingAssignment.title : newAssignment.title}
                    onChange={e => editingAssignment 
                      ? setEditingAssignment({...editingAssignment, title: e.target.value})
                      : setNewAssignment({...newAssignment, title: e.target.value})}
                    placeholder="e.g. Math Problem Set 4"
                    className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl focus:outline-none focus:ring-4 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-neutral-900 dark:text-neutral-50 font-bold placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Course</label>
                  <select
                    required
                    value={editingAssignment ? editingAssignment.course : newAssignment.course}
                    onChange={e => editingAssignment 
                      ? setEditingAssignment({...editingAssignment, course: e.target.value})
                      : setNewAssignment({...newAssignment, course: e.target.value})}
                    className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl focus:outline-none focus:ring-4 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-neutral-900 dark:text-neutral-50 font-bold appearance-none"
                  >
                    <option value="" className="dark:bg-neutral-900">Select Course</option>
                    {courses.map(s => <option key={s.id} value={s.name} className="dark:bg-neutral-900">{s.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Type</label>
                    <select
                      value={editingAssignment ? editingAssignment.type : newAssignment.type}
                      onChange={e => editingAssignment 
                        ? setEditingAssignment({...editingAssignment, type: e.target.value as any})
                        : setNewAssignment({...newAssignment, type: e.target.value as any})}
                      className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl focus:outline-none focus:ring-4 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-neutral-900 dark:text-neutral-50 font-bold appearance-none"
                    >
                      <option value="Assignment" className="dark:bg-neutral-900">Assignment</option>
                      <option value="Quiz" className="dark:bg-neutral-900">Quiz</option>
                      <option value="Presentation" className="dark:bg-neutral-900">Presentation</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Deadline</label>
                    <input 
                      required
                      type="datetime-local"
                      value={editingAssignment ? editingAssignment.deadline : newAssignment.deadline}
                      onChange={e => editingAssignment 
                        ? setEditingAssignment({...editingAssignment, deadline: e.target.value})
                        : setNewAssignment({...newAssignment, deadline: e.target.value})}
                      className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl focus:outline-none focus:ring-4 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-neutral-900 dark:text-neutral-50 font-bold [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-5 rounded-2xl font-black uppercase tracking-widest mt-4 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-xl shadow-neutral-200 dark:shadow-none active:scale-[0.98]"
                >
                  {editingAssignment ? 'Update' : 'Create'} Assignment
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showAddNoticeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddNoticeModal(false)}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-[2.5rem] shadow-2xl dark:shadow-none p-10 border border-transparent dark:border-neutral-800 transition-colors"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">New Notice</h2>
                <button onClick={() => setShowAddNoticeModal(false)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddNotice} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Title</label>
                  <input 
                    required
                    type="text"
                    value={newNotice.title}
                    onChange={e => setNewNotice({...newNotice, title: e.target.value})}
                    placeholder="e.g. Exam Schedule Update"
                    className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl focus:outline-none focus:ring-4 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-neutral-900 dark:text-neutral-50 font-bold placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Content</label>
                  <textarea 
                    required
                    rows={4}
                    value={newNotice.content}
                    onChange={e => setNewNotice({...newNotice, content: e.target.value})}
                    placeholder="Enter notice details..."
                    className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl focus:outline-none focus:ring-4 focus:ring-neutral-900/5 dark:focus:ring-neutral-50/5 transition-all text-neutral-900 dark:text-neutral-50 font-bold resize-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Priority</label>
                  <div className="flex gap-2">
                    {['normal', 'important'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewNotice({ ...newNotice, priority: p as any })}
                        className={`flex-1 py-4 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${
                          newNotice.priority === p
                            ? 'bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-50'
                            : 'bg-white dark:bg-neutral-900 text-neutral-400 dark:text-neutral-500 border-neutral-100 dark:border-neutral-800 hover:border-neutral-200 dark:hover:border-neutral-700'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-5 rounded-2xl font-black uppercase tracking-widest mt-4 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-xl shadow-neutral-200 dark:shadow-none active:scale-[0.98]"
                >
                  Post Notice
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showConfirmDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setShowConfirmDelete(false)}
              className="absolute inset-0 bg-neutral-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-10 text-center"
            >
              <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-10 h-10 text-red-500" />
              </div>
              <h3 className="text-2xl font-black text-neutral-900 tracking-tight mb-2">Are you sure?</h3>
              <p className="text-neutral-500 font-medium text-sm mb-8">
                This action cannot be undone. This assignment will be permanently removed.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  disabled={isDeleting}
                  onClick={() => docToDelete && deleteAssignment(docToDelete)}
                  className="w-full bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-100 flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : 'Delete Task'}
                </button>
                <button
                  disabled={isDeleting}
                  onClick={() => setShowConfirmDelete(false)}
                  className="w-full bg-neutral-50 text-neutral-500 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-neutral-100 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// No custom Edit2 needed as it's now imported from lucide-react
