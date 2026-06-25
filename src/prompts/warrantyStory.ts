import type { RepairLine, RepairOrder } from '../types';
import { formatExtractedDataForPrompt } from '@/utils/diagnosticParser';
import { PROMPT_VERSION } from './version';

/** Low temperature — fast, consistent output. */
export const WARRANTY_STORY_TEMPERATURE = 0.15;

/** Tight cap — typical stories fit in ~350 tokens. */
export const WARRANTY_STORY_MAX_TOKENS = 400;

/** Aggressive field caps to keep user messages small. */
export const PROMPT_FIELD_LIMITS = {
  ocr: 350,
  notes: 600,
  concern: 300,
} as const;

function truncatePromptField(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/** Standard Mercedes-Benz warranty workflow — every story must cover these in order. */
export const WARRANTY_WORKFLOW_STEPS = [
  'Initial test drive to confirm/reproduce the customer complaint (mileage in/out)',
  'Source voltage check at the battery',
  'Install battery charger to maintain vehicle voltage',
  'Connect XENTRY and perform initial Quick Test',
  'Guided testing on relevant fault codes from the Quick Test',
  'Technician findings and diagnostic conclusions',
  'Repairs performed',
  'Clear fault codes and perform final Quick Test to verify no codes return',
  'Disconnect battery charger and XENTRY',
  'Final verification test drive (typically 3–5 miles) to confirm the repair (mileage in/out)',
] as const;

/** Compact workflow hint for the user message (full list kept for tests/audit). */
export const WARRANTY_WORKFLOW_SUMMARY =
  'test drive → source voltage → battery charger → XENTRY Quick Test → guided tests → findings → repair → clear codes/final Quick Test → disconnect charger/XENTRY → verification drive';

export const SYSTEM_PROMPT = `Merlin — Mercedes-Benz warranty story writer (${PROMPT_VERSION}).

Write 3–4 short paragraphs in first person. No headings, bullets, or lists.
Cover all 10 workflow steps in order: ${WARRANTY_WORKFLOW_SUMMARY}.
Use only facts from the user message. [NOT DOCUMENTED] for missing steps. Never invent codes, voltages, or parts.`;

/** Legacy templates — not injected into fast-generation prompts. */
export const STORY_TEMPLATES = [
  'Chronological narrative in flowing paragraphs: customer presentation, diagnostic workflow, cause conclusion, repair, and verification drive — one continuous technician story.',
  'Evidence-first prose: open with test drive and source voltage, then walk through XENTRY Quick Test, guided tests, findings, repair, and final verification without list formatting.',
  'Concise audit record: tight technician sentences, every workflow step present in paragraph form, honest placeholders for undocumented elements.',
  'Road-test bookends: initial and final drives frame the story; diagnostics and repair unfold naturally between them.',
  'XENTRY-centered paragraphs: foreground Quick Test and guided testing as the backbone of the cause narrative.',
  'Line-focused submission: tie the labeled RO complaint to this line in the opening paragraph and close with documented verification in plain technician language.',
];

export function buildWarrantyStoryUserMessage(ro: RepairOrder, line: RepairLine): string {
  const vehicle = `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model}`.replace(/\s+/g, ' ').trim();
  const miles = `${ro.vehicle.mileageIn}${ro.vehicle.mileageOut ? `→${ro.vehicle.mileageOut}` : ''}`;

  const xentryText = formatExtractedDataForPrompt(
    line.extractedData || { codes: [], faultCodes: [], guidedTests: [], measurements: [], components: [], circuits: [] }
  );

  const lineOcr =
    line.xentryOcrTexts && line.xentryOcrTexts.length > 0
      ? truncatePromptField(line.xentryOcrTexts.join(' | '), PROMPT_FIELD_LIMITS.ocr)
      : '';

  const concern = truncatePromptField(
    line.customerConcern || line.description || '[NOT PROVIDED]',
    PROMPT_FIELD_LIMITS.concern
  );
  const notes = truncatePromptField(line.technicianNotes || '[NOT PROVIDED]', PROMPT_FIELD_LIMITS.notes);

  const complaint = (ro.complaints || []).slice(0, 3).join(' | ') || '[NOT PROVIDED]';

  return `Line ${line.lineNumber}: ${line.description}
RO ${ro.roNumber} | ${vehicle} | ${miles} mi
Complaint: ${concern}
RO complaints: ${complaint}
Notes: ${notes}
Diagnostics: ${xentryText || '[NOT PROVIDED]'}${lineOcr ? ` | OCR: ${lineOcr}` : ''}

Write the warranty story for this line only. Natural paragraphs, all 10 workflow steps.`;
}