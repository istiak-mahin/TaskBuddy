export type UserRole = 'student' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  username?: string; // Unique handle starting with @
  email: string;
  role: UserRole;
  createdAt: string;
  photoURL?: string;
  disabled?: boolean;
}

export interface Assignment {
  id?: string;
  userId: string;
  title: string;
  course: string;
  deadline: string;
  total_hours: number;
  completed_hours: number;
  urgency?: 'low' | 'medium' | 'urgent' | 'overdue' | 'done';
  createdAt?: any;
  type: 'Quiz' | 'Assignment' | 'Presentation' | 'Lab';
  syllabus?: string;
}

export interface Course {
  id?: string;
  name: string;
  createdBy: string;
}

export interface Announcement {
  id?: string;
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
  priority?: 'normal' | 'important';
}

export interface AppNotification {
  id?: string;
  userId: string;
  title: string;
  message: string;
  type: 'reminder' | 'announcement' | 'system';
  read: boolean;
  createdAt: string;
  assignmentId?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
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