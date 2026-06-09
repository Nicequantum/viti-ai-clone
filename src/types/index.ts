export interface ExtractedData {
  codes: string[];
  guidedTests: string[];
  measurements: Array<{ label: string; value: string }>;
  components: string[];
  circuits: string[];
}

export interface ImageAttachment {
  id: string;
  pathname: string;
  url: string;
  name: string;
}

export interface PendingImage {
  id: string;
  previewUrl: string;
  name: string;
  file: File;
}

export interface RepairLine {
  id: string;
  lineNumber: number;
  description: string;
  customerConcern: string;
  technicianNotes: string;
  xentryImages: ImageAttachment[];
  xentryOcrTexts?: string[];
  extractedData?: ExtractedData;
  warrantyStory?: string;
}

export interface VehicleInfo {
  vin: string;
  year: string;
  make: string;
  model: string;
  engine?: string;
  mileageIn: string;
  mileageOut: string;
}

export interface RepairOrder {
  id: string;
  roNumber: string;
  vehicle: VehicleInfo;
  customer: {
    name: string;
  };
  complaints: string[];
  xentryImages?: ImageAttachment[];
  xentryOcrTexts?: string[];
  repairLines: RepairLine[];
  createdAt?: string;
  technicianId?: string;
  technicianName?: string;
}

export type AppView = 'home' | 'ro' | 'line' | 'settings' | 'audit';

export interface StructuredROExtraction {
  vehicle: VehicleInfo;
  complaints: string[];
  customerName: string;
  roNumber: string;
}

export interface MercedesSuggestions {
  issues: string[];
  tests: Array<{ label: string; spec: string; note?: string }>;
  bandNote: string;
}

export interface TechnicianSession {
  technicianId: string;
  email: string;
  name: string;
  role: string;
  dealershipId: string;
  dealershipName: string;
  consentAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  technicianId: string | null;
  technicianName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  entryHash?: string | null;
}

export interface AuditChainInfo {
  enabled: true;
  description: string;
  hashedEntries: number;
  legacyEntries: number;
  valid: boolean;
  brokenAt: number | null;
  headHash: string | null;
  limitations: string[];
}

export interface AuditDashboardSummary {
  totalEntries: number;
  last24Hours: number;
  last7Days: number;
  actionCounts: Array<{ action: string; count: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    technicianName: string | null;
    createdAt: string;
  }>;
  chain: AuditChainInfo;
}

export interface DashboardSummary {
  role: string;
  stats: {
    totalRepairOrders: number;
    warrantyStories: number;
    activeTechnicians: number;
    auditEventsThisWeek: number;
  };
  recentRepairOrders: Array<{
    id: string;
    roNumber: string;
    year: string;
    make: string;
    model: string;
    technicianName: string;
    lineCount: number;
    hasStories: boolean;
    updatedAt: string;
  }>;
  audit: AuditDashboardSummary | null;
}

export const CONSENT_VERSION = '2026-06-07-v1';
export const WARRANTY_STORY_MAX_CHARS = 2500;
export const WARRANTY_STORY_WARN_CHARS = 2200;

export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.password_change',
  'consent.accept',
  'ro.create',
  'ro.update',
  'ro.delete',
  'story.generate',
  'story.edit',
  'user.create',
  'user.deactivate',
  'user.reactivate',
  'user.password_reset',
  'image.upload',
] as const;