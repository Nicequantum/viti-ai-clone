import type { RepairLine, RepairOrder } from '../types';

export const WARRANTY_STORY_TEMPERATURE = 0.25;

export const SYSTEM_PROMPT = `You are a senior Mercedes-Benz master technician writing warranty stories for dealership audit submission.

## ABSOLUTE RULES — AUDIT SAFETY (NEVER VIOLATE)

1. **Facts only**: Use ONLY information explicitly provided in the user message — vehicle details, RO complaints (A/B/C…), technician notes, OCR text from XENTRY/diagnostic photos, extracted codes, measurements, guided tests, and components. Never invent, infer, or assume data.

2. **No fabrication**: Do NOT invent or guess:
   - Test results, pressures, adaptation values, lambda readings, leak-off rates, voltages, or any numeric measurement
   - DTC/fault codes not listed in the provided data
   - XENTRY Quick Test results unless documented in provided OCR/notes
   - Battery charger connection unless stated in technician notes or provided data
   - Test drive details (mileage in/out, distances, speeds) unless mileage or drive notes are provided
   - Part numbers, calibration codes, recoding steps, or cylinder-specific work not in the provided data
   - Module names unless they appear in the provided OCR/notes

3. **Missing data placeholders**: When a standard warranty element is expected but no supporting data was provided, use exactly:
   - \`[NOT DOCUMENTED]\` for procedures/steps not confirmed (e.g. initial Quick Test, final Quick Test, verification drive, battery charger)
   - \`[NOT PROVIDED]\` for missing values, numbers, or specifics (e.g. test drive mileage, pressure readings, adaptation values)

4. **3 C's structure** (required, always truthful):
   - **Customer Complaint/Concern**: Quote or paraphrase the actual labeled complaint(s) (A, B, C…) tied to this repair line from the RO data.
   - **Cause**: State the root cause ONLY as supported by provided diagnostic evidence (codes, measurements, guided tests, technician findings). If cause is not established in the data, write: "Cause: [NOT DOCUMENTED] — further diagnosis required per provided notes."
   - **Correction**: Describe ONLY the repair actions documented in technician notes, line description, or provided data. Do not add steps, parts, or coding not mentioned.

5. **Tone**: Professional, first-person technician language. Concise, factual, dealership-ready. No hedging filler. No dramatic narrative padding.

6. **Prohibited**:
   - Do not use example or industry-typical spec values unless they appear verbatim in provided data
   - Do not reference smart defaults or common-issue suggestions as if they were performed tests or measured results
   - Do not embellish history examples with new facts
   - Do not state "per spec" with numbers unless those numbers are in the provided data

## OUTPUT

Write ONLY the warranty story for the specific repair line requested. Structure clearly with the 3 C's. Integrate provided XENTRY/diagnostic data naturally where available. Where data is absent, use placeholders — never fill gaps with plausible-sounding fiction.`;

export const STORY_TEMPLATES = [
  'Chronological narrative: Customer presentation and labeled complaints first, then documented diagnostic steps and provided data, then cause (only if supported), then documented correction, then any documented verification.',
  '3 C\'s explicit structure: State "Customer Complaint:", "Cause:", and "Correction:" as clear sections. Support each with only the provided OCR, codes, measurements, and technician notes.',
  'Evidence-first: Lead with provided DTCs, guided test text, and measurements from OCR. Explain cause only from that evidence. Describe correction only from technician notes and line description.',
  'Concise audit record: Brief professional summary covering the 3 C\'s with exact provided values. Use [NOT DOCUMENTED] or [NOT PROVIDED] for any standard element lacking source data.',
  'Step-by-step (documented only): Sequence through only the procedures and findings explicitly in technician notes or OCR. Do not add steps between documented items.',
  'Before/after (when data exists): Compare only pre- and post-repair values that appear in the provided OCR or notes. Do not invent post-repair improvements.',
  'Line-focused correction summary: Tie the labeled RO complaint to this line, cite provided diagnostic evidence for cause, list only documented repair actions for correction.',
];

export function buildWarrantyStoryUserMessage(
  ro: RepairOrder,
  line: RepairLine,
  historyContext: string = '',
  templateIndex?: number,
  advisorContext: string = ''
): string {
  const vehicleInfo = `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model} | VIN: ${ro.vehicle.vin} | Miles: ${ro.vehicle.mileageIn}${ro.vehicle.mileageOut ? ` → ${ro.vehicle.mileageOut}` : ''}`
    .replace(/\s+/g, ' ')
    .trim();

  const allRepairs = ro.repairLines.map((l) => `Line ${l.lineNumber}: ${l.description}`).join('\n');

  const data = line.extractedData || { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] };
  const xentryText = [
    data.codes.length ? `Codes: ${data.codes.join(', ')}` : '',
    data.guidedTests.length ? `Guided Tests: ${data.guidedTests.join(' | ')}` : '',
    data.measurements.length ? `Measurements: ${data.measurements.map((m) => `${m.label} = ${m.value}`).join('; ')}` : '',
    data.components.length ? `Components: ${data.components.join(' | ')}` : '',
    data.circuits.length ? `Circuits/Pins: ${data.circuits.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n') || 'No structured Xentry data extracted.';

  const rawXentryOcr =
    line.xentryOcrTexts && line.xentryOcrTexts.length > 0
      ? '\nRaw OCR from line diagnostic photos:\n' + line.xentryOcrTexts.join('\n---\n')
      : '';

  const roRawXentryOcr =
    ro.xentryOcrTexts && ro.xentryOcrTexts.length > 0
      ? '\nRO-level Xentry / Quick Test OCR (from RO page scan):\n' + ro.xentryOcrTexts.join('\n---\n')
      : '';

  const idx = templateIndex ?? Math.floor(Math.random() * STORY_TEMPLATES.length);
  const selectedTemplate = STORY_TEMPLATES[idx];

  return `Vehicle information: ${vehicleInfo}

RO Complaints (A, B, C etc from scan):
${(ro.complaints || []).join('\n') || '[NOT PROVIDED]'}

All repairs on this RO:
${allRepairs}

Current repair line: Line ${line.lineNumber} - ${line.description}

Customer concern for this line: ${line.customerConcern || line.description || '[NOT PROVIDED]'}

Technician notes: ${line.technicianNotes || '[NOT PROVIDED]'}

Xentry test data and images:
${xentryText}
${rawXentryOcr}
${roRawXentryOcr}
${historyContext}
${advisorContext ? `\n\nADVISOR INTELLIGENCE (style reference for this RO's service advisor):\n${advisorContext}\n` : ''}
AUDIT-SAFE REQUIREMENTS:
- Use ONLY the data above. Never invent numbers, codes, test results, or procedures.
- Structure the story with the 3 C's (Customer Complaint/Concern, Cause, Correction).
- Reference labeled complaints (A, B, C…) from the RO when relevant to this line.
- If Advisor Intelligence is provided above, mirror that advisor's complaint phrasing style in the Customer Complaint section only.
- If battery charger, Quick Test, test drive, verification drive, or specific measurements are NOT in the notes/OCR above, use [NOT DOCUMENTED] or [NOT PROVIDED] — do NOT fabricate them.
- Smart-default or common-issue text in technician notes (if present) is reference only — never state it as performed work unless confirmed in diagnostic OCR or explicit technician findings.
- For natural variety, follow this template style while staying strictly factual: ${selectedTemplate}

Write only the warranty story for this specific line.`;
}