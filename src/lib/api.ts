import type {
  AuditDashboardSummary,
  AuditLogEntry,
  DashboardSummary,
  RepairOrder,
  StructuredROExtraction,
  TechnicianSession,
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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

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

  createRepairOrder: (data: Partial<RepairOrder> & { fromExtraction?: boolean; customerName?: string }) =>
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

  extractRO: (imagePathnames: string[]) =>
    apiFetch<StructuredROExtraction>('/api/repair-orders/extract', {
      method: 'POST',
      body: JSON.stringify({ imagePathnames }),
    }),

  generateStory: (roId: string, lineId: string) =>
    apiFetch<{ warrantyStory: string }>(`/api/repair-orders/${roId}/lines/${lineId}/generate-story`, {
      method: 'POST',
    }),

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