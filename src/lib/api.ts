import type {
  AiMessage,
  AiMode,
  ApprovalEventItem,
  DashboardSummary,
  DocumentItem,
  ProjectItem,
  PublicUser,
} from '../types/docuzilla.ts';

// Keep auth token strictly in memory (never localStorage/sessionStorage)
let memoryAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return memoryAuthToken;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (memoryAuthToken) {
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  const rawText = await res.text();
  let data: unknown = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      throw new Error('Server returned an invalid response instead of JSON.');
    }
  }
  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return (data ?? {}) as T;
}

export const docuzillaApi = {
  async getAuthStatus(): Promise<{ hasAdminAccount: boolean; currentUser: PublicUser | null }> {
    return apiFetch('/api/auth/status');
  },

  async claimAdmin(input: { email: string; password: string; name?: string }): Promise<{ token: string; user: PublicUser }> {
    const res = await apiFetch<{ token: string; user: PublicUser }>('/api/auth/claim-admin', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAuthToken(res.token);
    return res;
  },

  async login(input: { email: string; password: string }): Promise<{ token: string; user: PublicUser }> {
    const res = await apiFetch<{ token: string; user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAuthToken(res.token);
    return res;
  },

  async register(input: {
    name: string;
    email: string;
    password: string;
    role: string;
    department: string;
    title: string;
    managerId: number | null;
  }): Promise<{ token: string; user: PublicUser }> {
    const res = await apiFetch<{ token: string; user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAuthToken(res.token);
    return res;
  },

  logout(): void {
    setAuthToken(null);
  },

  async getDashboardSummary(): Promise<DashboardSummary> {
    return apiFetch('/api/dashboard/summary');
  },

  async searchAll(q: string): Promise<{
    projects: ProjectItem[];
    documents: DocumentItem[];
    users: PublicUser[];
  }> {
    return apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
  },

  async listUsers(): Promise<{ users: PublicUser[] }> {
    return apiFetch('/api/users');
  },

  async updateUserHierarchy(
    userId: number,
    patch: {
      managerId?: number | null;
      canApprove?: boolean;
      role?: string;
      department?: string;
      title?: string;
    },
  ): Promise<{ user: PublicUser }> {
    return apiFetch(`/api/users/${userId}/hierarchy`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async listProjects(): Promise<{ projects: ProjectItem[] }> {
    return apiFetch('/api/projects');
  },

  async createProject(input: { name: string; code: string; department: string }): Promise<{ project: ProjectItem }> {
    return apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async listDocuments(params?: {
    projectId?: number;
    status?: string;
    search?: string;
  }): Promise<{ documents: DocumentItem[] }> {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', String(params.projectId));
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/documents${suffix}`);
  },

  async getDocumentEvents(docId: number): Promise<{ events: ApprovalEventItem[] }> {
    return apiFetch(`/api/documents/${docId}/events`);
  },

  async uploadDocument(formData: FormData): Promise<{ document: DocumentItem; storageMode: string }> {
    return apiFetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async submitDocument(docId: number): Promise<{ document: DocumentItem }> {
    return apiFetch(`/api/documents/${docId}/submit`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async decideDocument(
    docId: number,
    decision: 'approved' | 'rejected',
    comment?: string,
  ): Promise<{ document: DocumentItem }> {
    return apiFetch(`/api/documents/${docId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    });
  },

  async deleteDocument(docId: number): Promise<{ deleted: boolean; id: number }> {
    return apiFetch(`/api/documents/${docId}`, {
      method: 'DELETE',
    });
  },

  async downloadDocument(docId: number, fileName: string): Promise<void> {
    const headers = new Headers();
    if (memoryAuthToken) {
      headers.set('Authorization', `Bearer ${memoryAuthToken}`);
    }
    const res = await fetch(`/api/documents/${docId}/download`, { headers });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error || `Failed to download document from RustFS (${res.status}).`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  async listAiMessages(): Promise<{ messages: AiMessage[] }> {
    return apiFetch('/api/ai/messages');
  },

  async analyzeWithAi(params: {
    question: string;
    mode: AiMode;
    file?: File | null;
    documentId?: number | null;
  }): Promise<{ userMessage: AiMessage; assistantMessage: AiMessage }> {
    const fd = new FormData();
    fd.append('question', params.question);
    fd.append('mode', params.mode);
    if (params.file) {
      fd.append('file', params.file);
    }
    if (params.documentId) {
      fd.append('documentId', String(params.documentId));
    }
    return apiFetch('/api/ai/analyze', {
      method: 'POST',
      body: fd,
    });
  },
};
