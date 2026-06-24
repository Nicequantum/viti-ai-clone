export interface FaultCode {
  code: string;
  description: string;
  status?: string;
}

export interface ExtractedData {
  /** @deprecated Prefer faultCodes — kept in sync for backward compatibility */
  codes: string[];
  faultCodes: FaultCode[];
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

export interface VehicleWarrantyInfo {
  factoryWarranty?: string;
  cpoWarranty?: string;
  extendedElaWarranty?: string;
  serviceHistoryNotes?: string;
}

export interface VehicleInfo {
  vin: string;
  year: string;
  make: string;
  model: string;
  engine?: string;
  mileageIn: string;
  mileageOut: string;
  /** Populated from VMI pages — never from RO complaint lines. */
  warrantyInfo?: VehicleWarrantyInfo;
}

export interface ServiceAdvisorSummary {
  id: string;
  displayName: string;
  matchConfidence?: number;
}

export interface RepairOrder {
  id: string;
  roNumber: string;
  vehicle: VehicleInfo;
  customer: {
    name: string;
  };
  complaints: string[];
  /** Original RO line letters (A, B, C, E, F…) when extracted from scan; falls back to index order. */
  complaintLabels?: string[];
  /** Stable React keys for complaint textareas — prevents remount loops during edits. */
  complaintIds?: string[];
  serviceAdvisor?: ServiceAdvisorSummary;
  serviceAdvisorName?: string;
  xentryImages?: ImageAttachment[];
  xentryOcrTexts?: string[];
  repairLines: RepairLine[];
  createdAt?: string;
  technicianId?: string;
  technicianName?: string;
}

export type AppView = 'home' | 'ro' | 'line' | 'settings' | 'audit' | 'advisors';

export type TemplateCategory = 'customer' | 'warranty';

export interface StoryTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  content: string;
  source?: string;
  dealershipId?: string;
  useCount?: number;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  category: TemplateCategory;
  generatedText?: string | null;
  fullOriginalText: string;
  cleanTemplate: string;
  tags: string[];
  source?: string;
  dealershipId?: string;
  createdAt: string;
  updatedAt?: string;
}

export type StoryQualityGrade = 'excellent' | 'strong' | 'needs-work' | 'at-risk';

export interface TechnicianDetailPrompt {
  missing: string;
  prompt: string;
  field: 'technicianNotes' | 'customerConcern' | 'diagnostic' | 'workflow';
}

export interface StoryQualityResult {
  score: number;
  grade: StoryQualityGrade;
  strengths: string[];
  improvements: string[];
  auditRisks: string[];
  technicianDetails: TechnicianDetailPrompt[];
  summary: string;
  scoredAgainstStory?: string;
}

export interface StoryReviewFeedback {
  structure: string;
  technicalDetail: string;
  clarity: string;
  workflow: string;
  fabricationRisk: string;
}

export interface StoryReviewResult extends StoryQualityResult {
  feedback: StoryReviewFeedback;
  priorityActions: string[];
}

export interface SaveTemplateFromStoryPayload {
  title: string;
  category: TemplateCategory;
  finalText: string;
  generatedText: string;
  lineDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  codes?: string[];
  repairOrderId?: string;
  lineId?: string;
}

export interface AdvisorListItem {
  id: string;
  displayName: string;
  roCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
  profileUpdatedAt: string | null;
  typicallyAllCaps: boolean;
  commonPhraseCount: number;
}

export interface AdvisorProfileData {
  formatting: {
    usesLetterLabels: boolean;
    labelStyle: string;
    typicallyAllCaps: boolean;
    avgComplaintsPerRo: number;
    avgComplaintLength: number;
  };
  abbreviations: Record<string, string>;
  commonPhrases: Array<{ text: string; count: number }>;
  vehicleAffinities: Record<string, number>;
  complaintCategories: Record<string, unknown>;
  extractionHints: string[];
}

export interface AdvisorDetail {
  id: string;
  displayName: string;
  roCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  profile: {
    observationCount: number;
    profileVersion: number;
    lastComputedAt: string | null;
    profileData: AdvisorProfileData | null;
  } | null;
  recentObservations: Array<{
    id: string;
    lineLabel: string | null;
    roNumber: string;
    vehicleFamily: string | null;
    vehicle: string;
    complaint: string;
    observedAt: string;
  }>;
}

export interface StructuredROExtraction {
  vehicle: VehicleInfo;
  complaints: string[];
  complaintLabels?: string[];
  customerName: string;
  roNumber: string;
  serviceAdvisorName?: string;
}

export interface MercedesSuggestions {
  issues: string[];
  tests: Array<{ label: string; spec: string; note?: string }>;
  bandNote: string;
}

export interface TechnicianSession {
  technicianId: string;
  d7Number: string;
  name: string;
  role: string;
  isAdmin: boolean;
  dealershipId: string;
  dealershipName: string;
  consentAt: string | null;
}

export interface TechnicianUsageSummary {
  technicianId: string;
  name: string;
  d7Number: string;
  role: string;
  dailyCount: number;
  weeklyCount: number;
}

export interface UsageAnalytics {
  dailyLimit: number;
  totalDailyUsage: number;
  technicians: TechnicianUsageSummary[];
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
  promptVersion?: string | null;
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
  'story.review',
  'story.edit',
  'story.pdf_export',
  'user.create',
  'user.deactivate',
  'user.reactivate',
  'user.delete',
  'user.password_reset',
  'image.upload',
  'advisor.resolve',
  'advisor.capture',
  'template.save',
] as const;