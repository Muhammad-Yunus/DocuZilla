export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'analyst' | 'auditor' | string;
  department: string;
  title: string;
  managerId: number | null;
  canApprove: boolean;
  avatarInitials: string;
  createdAt: string;
}

export interface ProjectItem {
  id: number;
  name: string;
  code: string;
  department: string;
  status: string;
  ownerId: number | null;
  ownerName: string | null;
  docCount: number;
  storageUsedBytes: number;
  createdAt: string;
}

export interface DocumentItem {
  id: number;
  projectId: number;
  projectName: string;
  projectCode: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  rustfsBucket: string;
  rustfsKey: string;
  sha256: string;
  category: string;
  uploadedById: number;
  uploadedByName: string;
  uploadedByEmail: string;
  assignedApproverId: number | null;
  assignedApproverName: string | null;
  assignedApproverRole: string | null;
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected' | string;
  approvalNote: string | null;
  approvedById: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  discrepancyRate: string | null;
  aiSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalEventItem {
  id: number;
  documentId: number;
  actorId: number;
  actorName: string;
  actorRole: string;
  action: string;
  comment: string | null;
  createdAt: string;
}

export type AiMode = 'GPT-4o' | 'Document AI' | 'Financial AI' | 'Summary';

export interface AiMessage {
  id: number;
  userId: number | null;
  documentId: number | null;
  role: 'user' | 'assistant' | string;
  mode: string;
  content: string;
  attachmentName: string | null;
  createdAt: string;
}

export interface AnalyticsCardData {
  headlineValue: string;
  deltaDirection: string;
  series: {
    minLabel?: string;
    maxLabel?: string;
    bars: number[];
    redIndices?: number[];
    pins?: Array<{ index: number; type: 'up' | 'down'; label: string }>;
  };
  subMetrics: Array<{ value: string; label: string; badge: 'up' | 'alert' | 'warn' }> | null;
}

export interface DashboardSummary {
  kpis: {
    activeProjects: number;
    activeProjectsDelta: string;
    totalUsers: number;
    totalUsersDelta: string;
    totalDocuments: number;
    totalDocumentsDelta: string;
    dataRoomSizeGb: number;
    dataRoomSizeBytes: number;
    dataRoomSizeFormatted: string;
    dataRoomSizeDelta: string;
    pendingReviews: number;
  };
  analytics: Record<string, AnalyticsCardData>;
  storageBackend: 'rustfs-s3' | 'rustfs-local-vault' | '';
  storageBucket: string;
}

export type WorkspaceTab =
  | 'documents'
  | 'approvals'
  | 'hierarchy'
  | 'projects'
  | 'analytics';
