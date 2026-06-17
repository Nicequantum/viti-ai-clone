import type {
  AdvisorDetail,
  AdvisorListItem,
  AuditDashboardSummary,
  AuditLogEntry,
  DashboardSummary,
  KnowledgeBaseEntry,
  RepairOrder,
  SaveTemplateFromStoryPayload,
  StoryTemplate,
  StructuredROExtraction,
  TechnicianSession,
  TemplateCategory,
} from '@/types';

export interface TechnicianUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  consentAt?: string | null;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...fetchOptions } = options || {};
  const controller = new AbortController();
  const timer =
    timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let res: Response;
  try {
    res = await fetch(path, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
      credentials: 'include',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${Math.round((timeoutMs || 0) / 1000)}s`, 408);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || 'Request failed. Please try again.', res.status);
  }

  return res.json();
}

async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || 'Upload failed. Please try again.', res.status);
  }

  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch<{ session: TechnicianSession }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ session: TechnicianSession | null }>('/api/auth/me'),

  acceptConsent: () => apiFetch<{ consentAt: string }>('/api/consent', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean; requiresReauth?: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listRepairOrders: () => apiFetch<{ repairOrders: RepairOrder[] }>('/api/repair-orders'),

  getRepairOrder: (id: string) => apiFetch<{ repairOrder: RepairOrder }>(`/api/repair-orders/${id}`),

  createRepairOrder: (
    data: Partial<RepairOrder> & {
      fromExtraction?: boolean;
      customerName?: string;
      advisorExtractionSource?: 'grok' | 'ocr_fallback' | 'manual';
    }
  ) =>
    apiFetch<{ repairOrder: RepairOrder }>('/api/repair-orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateRepairOrder: (id: string, data: Partial<RepairOrder>) =>
    apiFetch<{ repairOrder: RepairOrder }>(`/api/repair-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteRepairOrder: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/repair-orders/${id}`, { method: 'DELETE' }),

  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiUpload<{ pathname: string; url: string; name: string }>('/api/upload', formData);
  },

  listAdvisors: () => apiFetch<{ advisors: AdvisorListItem[] }>('/api/advisors'),

  getAdvisor: (id: string) => apiFetch<{ advisor: AdvisorDetail }>(`/api/advisors/${id}`),

  getAdvisorIntelligenceSummary: () =>
    apiFetch<{
      advisorIntelligence: {
        advisors: number;
        observations: number;
        profiles: number;
        linkedRepairOrders: number;
        recentAdvisors: Array<{
          id: string;
          displayName: string;
          roCount: number;
          lastSeenAt: string;
          observationCount: number;
          profileUpdatedAt: string | null;
        }>;
        recentCaptures: Array<{
          id: string;
          createdAt: string;
          metadata: Record<string, unknown>;
        }>;
      };
    }>('/api/advisors/summary'),

  extractRO: (imagePathnames: string[]) =>
    apiFetch<StructuredROExtraction>('/api/repair-orders/extract', {
      method: 'POST',
      body: JSON.stringify({ imagePathnames }),
      timeoutMs: 95_000,
    }),

  generateStory: (roId: string, lineId: string) =>
    apiFetch<{ warrantyStory: string }>(`/api/repair-orders/${roId}/lines/${lineId}/generate-story`, {
      method: 'POST',
      timeoutMs: 120_000,
    }),

  listTemplates: (category?: TemplateCategory) => {
    const query = category ? `?category=${category}` : '';
    return apiFetch<{ templates: StoryTemplate[] }>(`/api/templates${query}`);
  },

  listKnowledgeBase: (category?: TemplateCategory) => {
    const query = category ? `?category=${category}` : '';
    return apiFetch<{ entries: KnowledgeBaseEntry[] }>(`/api/knowledge-base${query}`);
  },

  saveTemplateFromStory: (payload: SaveTemplateFromStoryPayload) =>
    apiFetch<{ template: StoryTemplate; knowledgeBase: KnowledgeBaseEntry; tags: string[] }>(
      '/api/templates/save-from-story',
      { method: 'POST', body: JSON.stringify(payload), timeoutMs: 30_000 }
    ),

  recordTemplateUse: (templateId: string) =>
    apiFetch<{ ok: boolean }>(`/api/templates/${templateId}/use`, { method: 'POST' }),

  decodeVin: (vin: string) =>
    apiFetch<{
      vin: string;
      year: string;
      make: string;
      model: string;
      engine: string;
      trim: string;
      valid: boolean;
    }>('/api/vin/decode', {
      method: 'POST',
      body: JSON.stringify({ vin }),
    }),

  listUsers: () => apiFetch<{ users: TechnicianUser[] }>('/api/users'),

  createUser: (data: { email: string; name: string; password: string; role: 'technician' | 'manager' }) =>
    apiFetch<{ user: TechnicianUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (id: string, data: { isActive: boolean }) =>
    apiFetch<{ user: TechnicianUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  resetUserPassword: (id: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    }),

  listAuditLogs: (params: {
    technicianId?: string;
    action?: string;
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams();
    if (params.technicianId) query.set('technicianId', params.technicianId);
    if (params.action) query.set('action', params.action);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    query.set('format', 'json');
    return apiFetch<{ logs: AuditLogEntry[]; count: number }>(`/api/audit-logs?${query.toString()}`);
  },

  getAuditSummary: () => apiFetch<AuditDashboardSummary>('/api/audit-logs/summary'),

  getDashboardSummary: () => apiFetch<DashboardSummary>('/api/dashboard/summary'),

  exportAuditLogsCsv: (params: {
    technicianId?: string;
    action?: string;
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams();
    if (params.technicianId) query.set('technicianId', params.technicianId);
    if (params.action) query.set('action', params.action);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    query.set('format', 'csv');
    return `/api/audit-logs?${query.toString()}`;
  },
};