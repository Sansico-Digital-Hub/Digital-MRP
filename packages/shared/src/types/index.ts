// User & Auth Types
export type UserRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'PRODUCTION_PLANNER'
  | 'MATERIAL_PLANNER'
  | 'USER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// Item Types
export interface Item {
  id: string;
  partNumber: string;
  description: string;
  unit: string;
  createdAt: Date;
  updatedAt: Date;
}

// Schedule Types
export interface DailySchedule {
  id: string;
  date: Date;
  shift: number;
  itemId: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeeklySchedule {
  id: string;
  year: number;
  weekNumber: number;
  weekStartDate: Date;
  weekEndDate: Date;
  itemId: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  createdAt: Date;
  updatedAt: Date;
}

// Stock Types
export interface FGStock {
  id: string;
  itemId: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  date: Date;
  shift?: number;
  notes?: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// WIP Types
export type WIPStatus = 'IN_PROGRESS' | 'ON_HOLD' | 'DELAYED' | 'COMPLETED';

export interface WIP {
  id: string;
  itemId: string;
  partNumber: string;
  description: string;
  location: string;
  quantity: number;
  unit: string;
  progressPercent: number;
  date: Date;
  shift: number;
  status: WIPStatus;
  notes?: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// Tracking & Status Types
export type ItemStatus = 'FULFILLED' | 'IN_PRODUCTION' | 'SHORTAGE';

export interface ItemTracking {
  partNumber: string;
  description: string;
  date: Date;
  shift?: number;
  demand: number;
  fgStock: number;
  inProduction: number;
  totalSupply: number;
  gap: number;
  status: ItemStatus;
  wipDetails: WIP[];
}

export interface DashboardSummary {
  date: Date;
  shift?: number;
  totalItems: number;
  fulfilledCount: number;
  inProductionCount: number;
  shortageCount: number;
  items: ItemTracking[];
}

// Audit Log Types
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  dataBefore?: any;
  dataAfter?: any;
  notes?: string;
  createdAt: Date;
}

// Notification Types
export type NotificationType = 'SHORTAGE' | 'DELAY' | 'STALE_DATA' | 'INFO';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  partNumber?: string;
  isRead: boolean;
  createdAt: Date;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
