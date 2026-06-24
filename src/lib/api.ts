import type {
  AdvisorDetail,
  AdvisorListItem,
  AuditDashboardSummary,
  AuditLogEntry,
  DashboardSummary,
  KnowledgeBaseEntry,
  RepairOrder,
  SaveTemplateFromStoryPayload,
  StoryQualityResult,
  StoryReviewResult,
  StoryTemplate,
  StructuredROExtraction,
  TechnicianSession,
  TemplateCategory,
  ExtractedData,
  UsageAnalytics,
} from '@/types';
import { DIAGNOSTIC_EXTRACT_CLIENT_MS, RO_EXTRACT_CLIENT_MS } from '@/lib/timeouts';

export interface TechnicianUser {
  id: string;
  d7Number: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  consentAt?: string | null;
  deletedAt?: string | null;
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
  login: (d7Number: string, password: string) =>
    apiFetch<{ session: TechnicianSession }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ d7Number, password }),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ session: TechnicianSession | null }>('/api/auth/me'),

  acceptConsent: () => apiFetch<{ consentAt: string }>('/api/consent', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean; requiresReauth?: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listRepairOrders: (params?: { limit?: number; cursor?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch<{ repairOrders: RepairOrder[]; nextCursor?: string | null; hasMore?: boolean }>(
      `/api/repair-orders${suffix}`
    );
  },

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
      timeoutMs: RO_EXTRACT_CLIENT_MS,
    }),

  extractDiagnostics: (imagePathname: string) =>
    apiFetch<ExtractedData>('/api/diagnostics/extract', {
      method: 'POST',
      body: JSON.stringify({ imagePathnames: [imagePathname] }),
      timeoutMs: DIAGNOSTIC_EXTRACT_CLIENT_MS,
    }),

  generateStory: (roId: string, lineId: string) =>
    apiFetch<{ warrantyStory: string; quality: StoryQualityResult | null }>(
      `/api/repair-orders/${roId}/lines/${lineId}/generate-story`,
      { method: 'POST', timeoutMs: 180_000 }
    ),

  reviewStory: (roId: string, lineId: string, warrantyStory: string) =>
    apiFetch<{ review: StoryReviewResult }>(
      `/api/repair-orders/${roId}/lines/${lineId}/review-story`,
      { method: 'POST', body: JSON.stringify({ warrantyStory }), timeoutMs: 120_000 }
    ),

  /** Customer Pay — instant pre-written story; bypasses Grok and quality audit. */
  applyCustomerPayTemplate: (roId: string, lineId: string, templateId: string) =>
    apiFetch<{ warrantyStory: string; templateTitle: string; isCustomerPay: true }>(
      `/api/repair-orders/${roId}/lines/${lineId}/apply-customer-pay-template`,
      { method: 'POST', body: JSON.stringify({ templateId }), timeoutMs: 15_000 }
    ),

  listTemplates: (category?: TemplateCategory) => {
    const query = category ? `?category=${category}` : '';
    return apiFetch<{ templates: StoryTemplate[] }>(`/api/templates${query}`, { timeoutMs: 30_000 });
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
    apiFetch<{ ok: boolean }>(`/api/templates/${templateId}/use`, { method: 'POST', timeoutMs: 15_000 }),

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

  createUser: (data: { d7Number: string; name: string; password: string; role: 'technician' | 'manager' }) =>
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

  deleteUser: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${id}`, {
      method: 'DELETE',
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

  getUsageAnalytics: () => apiFetch<UsageAnalytics>('/api/admin/usage'),

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