export type UserRole = 'student' | 'admin' | 'sectionAdmin' | 'superAdmin';

export interface UserProfile {
  uid: string;
  name: string;
  username?: string; // Unique handle starting with @
  email: string;
  role: UserRole;
  sectionIds?: string[];
  activeSectionId?: string;
  createdAt: string;
  photoURL?: string;
  disabled?: boolean;
  joinCodeUsed?: string;
}

export interface Section {
  id?: string;
  name: string;
  department?: string;
  semester?: string;
  batch?: string;
  joinCode?: string;
  adminIds: string[];
  createdAt?: any;
  updatedAt?: any;
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
  sectionId?: string;
  createdAt?: any;
  type: 'Quiz' | 'Assignment' | 'Presentation' | 'Lab';
  syllabus?: string;
}

export interface Course {
  id?: string;
  name: string;
  createdBy: string;
  sectionId?: string;
}

export interface Announcement {
  id?: string;
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
  sectionId?: string;
  priority?: 'normal' | 'important';
}

export interface SectionResourceFile {
  name: string;
  path: string;
  url: string;
  type: string;
  size: number;
  publicId?: string;
  cloudName?: string;
  cloudinaryResourceType?: 'image' | 'raw' | 'video';
  format?: string;
}

export interface SectionResource {
  id?: string;
  title: string;
  description?: string;
  resourceType: 'notes' | 'previousQuestions';
  sectionId: string;
  sectionName?: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedByEmail?: string;
  files: SectionResourceFile[];
  deleteRequested?: boolean;
  cleanupStatus?: 'active' | 'pending' | 'deleted' | 'failed';
  storageProvider?: 'cloudinary';
  createdAt?: any;
  updatedAt?: any;
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
  sectionId?: string;
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