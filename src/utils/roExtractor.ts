import type { StructuredROExtraction, VehicleInfo } from '../types';

const HEADER_ROW_PATTERN = /LINE\s+OPCODE\s+TECH\s+TYPE\s+HOURS/i;
const COMPLAINT_SECTION_MARKERS = [
  HEADER_ROW_PATTERN,
  /Customer\s+Complaints?/i,
  /CUST(?:OMER)?\s+(?:STATES?|COMPLAINT|CONCERN)/i,
  /COMPLAINT\s+LINE/i,
];

const JUNK_COMPLAINT_PREFIX =
  /^(vin|mile|km|ro\s*#|date|tech|name|model|customer|service|advisor|authorized|total|tax|parts|shop|dealer|labor|signature|opcode|line|hours|type|passed|cdef|risi)$/i;

/** Continuation / inspection detail lines — not standalone complaints. */
const INSPECTION_DETAIL_LINE =
  /^(?:RISI\b|CDEF\b|PASSED\b|\d{3,}\s*(?:PASSED|CDEF|RISI)\b)/i;

const LETTER_LABEL_PATTERN = /^([A-Z])\s+(.+)$/;
const HASHTAG_LETTER_PART_PATTERN = /^#\s*([A-Z])\b[,\s:.\-–—]*\s*(.*)$/i;
const LETTER_LABEL_OUTPUT_PATTERN = /^#?\s*([A-Z])[\.\)\:\s\-–—–—]+\s*(.+)$/i;
/** Split only on explicit hashtag labels — never on capitals inside complaint words. */
const HASHTAG_BOUNDARY_SPLIT = /\s+(?=#\s*[A-Z]\b)/i;

export interface LabeledComplaint {
  letter: string;
  text: string;
}

function collectExplicitHashtagLabels(text: string): Set<string> {
  return new Set([...text.matchAll(/#\s*([A-Z])\b/gi)].map((m) => m[1].toUpperCase()));
}

function letterAppearsAsComplaintLabel(text: string, letter: string): boolean {
  return (
    new RegExp(`#\\s*${letter}\\b`, 'i').test(text) ||
    new RegExp(`(?:^|\\n)\\s*${letter}(?:[\\.\\)\\:\\s\\-–—]+\\S|\\s+\\S)`, 'im').test(text)
  );
}

function parseHashtagComplaintPart(part: string): LabeledComplaint | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  const match = trimmed.match(HASHTAG_LETTER_PART_PATTERN);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  let text = trimComplaintContinuation(match[2].replace(/^[,;\s]+/, '').replace(/[,;]+$/, '').trim());
  if (!text || /^#\s*[A-Z]\b/i.test(text)) return null;
  if (!isComplaintLetter(letter, text)) return null;
  return { letter, text };
}

function parseComplaintLabelSegment(segment: string): LabeledComplaint | null {
  const hashtag = parseHashtagComplaintPart(segment);
  if (hashtag) return hashtag;

  const trimmed = segment.trim();
  if (!trimmed) return null;

  const letterMatch = trimmed.match(LETTER_LABEL_PATTERN);
  if (letterMatch) {
    return { letter: letterMatch[1].toUpperCase(), text: letterMatch[2] };
  }

  const outputMatch = trimmed.match(LETTER_LABEL_OUTPUT_PATTERN);
  if (outputMatch) {
    return { letter: outputMatch[1].toUpperCase(), text: outputMatch[2] };
  }

  return null;
}

/** Row that lists only labels, e.g. "# A, # B, # C, # D, # E, # F" with text on following lines. */
function extractLabelOnlyRowLetters(line: string): string[] | null {
  const matches = [...line.matchAll(/#\s*([A-Z])\b/gi)];
  if (matches.length < 2) return null;

  const remainder = line
    .replace(/#\s*[A-Z]\b/gi, '')
    .replace(/[,;.\s]/g, '')
    .trim();
  if (remainder.length > 0) return null;

  return matches.map((m) => m[1].toUpperCase());
}

function collectFollowingComplaintLines(lines: string[], startIdx: number): string[] {
  const texts: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (/^LINE\s+OPCODE/i.test(line)) break;
    if (/^#\s*[A-Z]\b/i.test(line)) {
      if (extractLabelOnlyRowLetters(line)) continue;
      if (parseHashtagComplaintPart(line.split(HASHTAG_BOUNDARY_SPLIT)[0] || line)) break;
      break;
    }
    if (/^(?:ro\s*#|vin|mileage|customer\s+name|service\s+advisor)/i.test(line)) break;
    if (isInspectionDetailLine(line)) continue;

    const c = normalizeComplaintContent(line);
    if (isValidComplaintText(c)) texts.push(c);
  }
  return texts;
}

function extractHashtagLabeledBlocks(section: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  const lines = section.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    let line = lines[lineIdx];
    if (/^LINE\s+OPCODE\s+TECH\s+TYPE\s+HOURS\s*$/i.test(line)) continue;

    if (HEADER_ROW_PATTERN.test(line)) {
      line = line.replace(HEADER_ROW_PATTERN, ' ').trim();
      if (!line) continue;
    }

    const labelOnlyLetters = extractLabelOnlyRowLetters(line);
    if (labelOnlyLetters) {
      const texts = collectFollowingComplaintLines(lines, lineIdx + 1);
      labelOnlyLetters.forEach((letter, idx) => {
        if (texts[idx]) addLetterComplaint(byLetter, letter, texts[idx]);
      });
      continue;
    }

    const parts = line.split(HASHTAG_BOUNDARY_SPLIT).filter(Boolean);
    for (const part of parts) {
      const parsed = parseHashtagComplaintPart(part);
      if (parsed) addLetterComplaint(byLetter, parsed.letter, parsed.text);
    }
  }

  return byLetter;
}

function extractPlainLineStartComplaints(section: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  const lines = section.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^#\s*[A-Z]\b/i.test(line)) continue;

    if (HEADER_ROW_PATTERN.test(line)) {
      const afterHeader = line.replace(HEADER_ROW_PATTERN, ' ').trim();
      const parsed = parseComplaintLabelSegment(afterHeader);
      if (parsed && !afterHeader.startsWith('#')) addLetterComplaint(byLetter, parsed.letter, parsed.text);
      continue;
    }

    const parsed = parseComplaintLabelSegment(line);
    if (parsed && !line.startsWith('#')) addLetterComplaint(byLetter, parsed.letter, parsed.text);
  }

  return byLetter;
}

function normalizeComplaintText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeComplaintContent(text: string): string {
  return normalizeComplaintText(text.replace(/^RISI\s+/i, ''));
}

function isInspectionDetailLine(text: string): boolean {
  const trimmed = normalizeComplaintText(text);
  return INSPECTION_DETAIL_LINE.test(trimmed);
}

function filterComplaintList(complaints: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of complaints) {
    const c = normalizeComplaintContent(raw);
    if (!isValidComplaintText(c)) continue;
    if (isInspectionDetailLine(c)) continue;
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out.slice(0, 15);
}

/** Strip inspection detail continuations (RISI, CDEF, PASSED) merged onto one OCR line. */
function trimComplaintContinuation(text: string): string {
  const normalized = normalizeComplaintText(text);
  const [head] = normalized.split(/\s+(?=RISI\b|\d{3,}\s+CDEF\b|\d+\s+PASSED\b)/i);
  return normalizeComplaintText(head || normalized);
}

function isValidComplaintText(text: string): boolean {
  const trimmed = normalizeComplaintText(text);
  if (trimmed.length < 4) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (/^\d{3,}/.test(trimmed)) return false;
  if (/^complaints?:?$/i.test(trimmed)) return false;
  if (/^customer\s+complaints?:?$/i.test(trimmed)) return false;
  if (JUNK_COMPLAINT_PREFIX.test(trimmed.split(/\s+/)[0] || '')) return false;
  if (JUNK_COMPLAINT_PREFIX.test(trimmed)) return false;
  return true;
}

function isComplaintLetter(letter: string, text: string): boolean {
  if (!/^[A-Z]$/.test(letter)) return false;
  return isValidComplaintText(text);
}

function getComplaintSection(text: string): string {
  let bestIndex = -1;
  for (const marker of COMPLAINT_SECTION_MARKERS) {
    const match = text.match(marker);
    if (match && match.index !== undefined && (bestIndex < 0 || match.index < bestIndex)) {
      bestIndex = match.index;
    }
  }
  if (bestIndex >= 0) return text.slice(bestIndex);
  return text;
}

function addLetterComplaint(byLetter: Map<string, string>, letter: string, text: string) {
  const normalized = trimComplaintContinuation(text);
  if (!isComplaintLetter(letter, normalized)) return;
  const existing = byLetter.get(letter);
  if (!existing || normalized.length > existing.length) {
    byLetter.set(letter, normalized);
  }
}

/** Build letter → complaint map from OCR/RO text (supports "# A ...", "# A, # B", "A ..."). */
export function extractLetterLabeledComplaintMap(text: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  if (!text || text.trim().length < 4) return byLetter;

  const section = getComplaintSection(text.replace(/\r\n/g, '\n'));
  const explicitHashtagLabels = collectExplicitHashtagLabels(text);

  for (const [letter, value] of extractHashtagLabeledBlocks(section)) {
    addLetterComplaint(byLetter, letter, value);
  }

  // When the RO uses hashtag labels, ignore plain "E. ..." lines (often Grok/OCR fragments).
  if (explicitHashtagLabels.size === 0) {
    for (const [letter, value] of extractPlainLineStartComplaints(section)) {
      addLetterComplaint(byLetter, letter, value);
    }
  }

  return byLetter;
}

/** Primary extractor for real-world RO complaint lines: "A RHODE ISLAND STATE INSPECTION" / "# A ..." */
export function extractLetterLabeledComplaints(text: string): string[] {
  return sortedLabeledComplaints(extractLetterLabeledComplaintMap(text)).map((item) => item.text);
}

export function extractLetterLabeledComplaintsWithLabels(text: string): LabeledComplaint[] {
  return sortedLabeledComplaints(extractLetterLabeledComplaintMap(text));
}

function sortedLabeledComplaints(byLetter: Map<string, string>): LabeledComplaint[] {
  return [...byLetter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, text]) => ({ letter, text }));
}

export function labeledComplaintsToArrays(
  labeled: LabeledComplaint[]
): { complaints: string[]; labels: string[] } {
  return {
    complaints: labeled.map((item) => item.text),
    labels: labeled.map((item) => item.letter),
  };
}

export function extractComplaints(text: string): string[] {
  const letterLabeled = extractLetterLabeledComplaints(text);
  if (letterLabeled.length > 0) return letterLabeled.slice(0, 15);

  if (!text || text.trim().length < 6) return [];
  const comps: string[] = [];
  const lines = text.replace(/=== PAGE \d+ ===/g, '\n\n').split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  const TRIGGERS = [
    'customer states',
    'customer complaint',
    'customer concern',
    'customer reported',
    'customer states that',
    'technician notes',
    'tech notes',
    'technician found',
    'technician observed',
    'concern',
    'complaint',
    'issue',
    'problem',
    'needs',
    'requires',
    'state inspection',
    'found',
    'observed',
    'reported',
    'requires repair',
    'inspection result',
    'c/s',
    'c s',
  ];

  let collecting = false;
  let currentBlock = '';

  const flushBlock = () => {
    if (currentBlock.length < 8) return;
    const labeledMatches = currentBlock.match(/([A-Z])[\.\)\:\s\-–—–—]+\s*([A-Za-z][^\.]{4,220})/gi) || [];
    if (labeledMatches.length > 0) {
      labeledMatches.forEach((m) => {
        const parsed = m.match(/([A-Z])[\.\)\:\s\-–—–—]+\s*(.+)/i);
        if (!parsed) return;
        const c = normalizeComplaintText(parsed[2]);
        if (isValidComplaintText(c) && !comps.includes(c)) comps.push(c);
      });
    } else {
      const parts = currentBlock
        .split(/[\.\!\?]\s+|\n|;/)
        .map((p) => p.trim())
        .filter((p) => p.length > 4);
      parts.forEach((p) => {
        if (isValidComplaintText(p) && !comps.includes(p)) comps.push(p);
      });
    }
    currentBlock = '';
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    const hitTrigger = TRIGGERS.some((t) => lower.includes(t));
    if (hitTrigger) {
      flushBlock();
      collecting = true;
      currentBlock = line + '. ';
      continue;
    }
    if (collecting) {
      if (
        /vin|ro\s*#|mileage|odometer|parts|labor|total|authorized|signature|print name|phone/i.test(lower) &&
        !lower.match(/complaint|concern|issue|problem|inspection/)
      ) {
        flushBlock();
        collecting = false;
        continue;
      }
      currentBlock += line + ' ';
    }
    const strayLabel = parseComplaintLabelSegment(line);
    if (strayLabel && isComplaintLetter(strayLabel.letter, strayLabel.text)) {
      const c = normalizeComplaintText(strayLabel.text);
      if (!comps.includes(c)) comps.push(c);
    }
  }
  flushBlock();

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of comps) {
    const key = c.toLowerCase().slice(0, 40);
    if (!seen.has(key) && c.length > 3 && c.length < 280) {
      seen.add(key);
      unique.push(c);
    }
  }
  return unique.slice(0, 10);
}

function pickNonEmpty(primary: string, fallback: string): string {
  const p = (primary || '').trim();
  if (p) return p;
  return (fallback || '').trim();
}

function mergeVehicleFields(primary: VehicleInfo, supplement: VehicleInfo): VehicleInfo {
  return {
    vin: pickNonEmpty(primary.vin, supplement.vin),
    year: pickNonEmpty(primary.year, supplement.year),
    make: pickNonEmpty(primary.make, supplement.make),
    model: pickNonEmpty(primary.model, supplement.model),
    engine: pickNonEmpty(primary.engine || '', supplement.engine || '') || undefined,
    mileageIn: pickNonEmpty(primary.mileageIn, supplement.mileageIn),
    mileageOut: pickNonEmpty(primary.mileageOut, supplement.mileageOut),
  };
}

/** Merge Grok vision output with on-device OCR (raw OCR text wins for letter-labeled complaints). */
export function mergeROExtractions(
  primary: StructuredROExtraction,
  supplement: StructuredROExtraction,
  supplementRawText = ''
): StructuredROExtraction {
  const grokComplaints = mergeComplaintLists(primary.complaints, supplement.complaints);
  const recovered = recoverComplaintsWithLabelsFromText(supplementRawText, grokComplaints);
  const complaints = sanitizeComplaints(recovered.complaints);
  const complaintLabels =
    recovered.labels && recovered.labels.length === complaints.length ? recovered.labels : undefined;

  return {
    roNumber: pickNonEmpty(primary.roNumber, supplement.roNumber),
    customerName: pickNonEmpty(primary.customerName, supplement.customerName),
    serviceAdvisorName: pickNonEmpty(
      primary.serviceAdvisorName || '',
      supplement.serviceAdvisorName || ''
    ) || undefined,
    vehicle: mergeVehicleFields(primary.vehicle, supplement.vehicle),
    complaints,
    complaintLabels,
  };
}

function mergeComplaintLists(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const c = normalizeComplaintContent(raw);
      if (!isValidComplaintText(c)) continue;
      if (isInspectionDetailLine(c)) continue;
      const key = c.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(c);
      }
    }
  }
  return merged.slice(0, 15);
}

/** Parse Grok-style "A. text" / "B: text" lines from the complaints section. */
function extractStructuredLetterComplaints(text: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  let inSection = false;

  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const lower = line.toLowerCase();
    if (lower.startsWith('customer complaints:')) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^ro number:|^year:|^make:|^model:|^vin:|^mileage/i.test(lower)) break;
    if (/none listed/i.test(lower)) break;

    const m = line.match(LETTER_LABEL_OUTPUT_PATTERN);
    if (!m) continue;
    const content = normalizeComplaintContent(m[2]);
    if (!isValidComplaintText(content) || isInspectionDetailLine(content)) continue;
    addLetterComplaint(byLetter, m[1], content);
  }

  return byLetter;
}

export interface RecoveredComplaints {
  complaints: string[];
  labels?: string[];
}

/**
 * Recover Line A when Grok skips it or mislabels continuation detail as B.
 * Letter-labeled OCR/raw text is authoritative over Grok structured output.
 */
export function recoverComplaintsFromText(text: string, grokComplaints: string[] = []): string[] {
  return recoverComplaintsWithLabelsFromText(text, grokComplaints).complaints;
}

export function recoverComplaintsWithLabelsFromText(
  text: string,
  grokComplaints: string[] = []
): RecoveredComplaints {
  const letterFromRawMap = extractLetterLabeledComplaintMap(text);
  const structuredLetters = extractStructuredLetterComplaints(text);
  const explicitHashtagLabels = collectExplicitHashtagLabels(text);
  const byLetter = new Map<string, string>();

  // OCR/raw hashtag and line-start labels are authoritative.
  for (const [letter, value] of letterFromRawMap) {
    addLetterComplaint(byLetter, letter, value);
  }

  // Grok structured output only fills gaps when the RO does not use hashtag labels.
  if (explicitHashtagLabels.size === 0) {
    for (const [letter, value] of structuredLetters) {
      if (byLetter.has(letter)) continue;
      if (!letterAppearsAsComplaintLabel(text, letter)) continue;
      addLetterComplaint(byLetter, letter, value);
    }
  }

  // Grok skipped A but labeled continuation detail as B (e.g. "B. RISI RHODE ISLAND...").
  if (!byLetter.has('A')) {
    const risiLineMatch = text.match(/(?:^|\n)\s*B[\.\)\:\s\-–—]+\s*(RISI\s+[^\n]+)/i);
    const risiSources = [
      byLetter.get('B'),
      ...grokComplaints,
      risiLineMatch?.[1],
    ].filter(Boolean) as string[];
    for (const raw of risiSources) {
      if (!/^RISI\s+/i.test(raw)) continue;
      const recoveredA = normalizeComplaintContent(raw);
      if (isValidComplaintText(recoveredA)) {
        byLetter.set('A', recoveredA);
        const bValue = byLetter.get('B');
        if (
          bValue &&
          (bValue === raw ||
            bValue === recoveredA ||
            normalizeComplaintContent(bValue) === recoveredA)
        ) {
          byLetter.delete('B');
        }
        break;
      }
    }
  }

  if (byLetter.size > 0) {
    const seen = new Set<string>();
    const complaints: string[] = [];
    const labels: string[] = [];
    for (const [letter, value] of [...byLetter.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        labels.push(letter);
        complaints.push(value);
      }
    }
    return { complaints, labels };
  }

  const fallback = filterComplaintList(
    mergeComplaintLists(
      [...letterFromRawMap.values()],
      grokComplaints,
      extractComplaints(text)
    )
  );
  return { complaints: fallback };
}

export function extractVehicleDetails(text: string): VehicleInfo {
  let cleaned = text
    .replace(/\bO\b/g, '0')
    .replace(/\bI\b/g, '1')
    .replace(/\bL\b/g, '1')
    .replace(/[\u2018\u2019]/g, "'");

  const topBlock = cleaned.substring(0, 500);
  const vinMatch = cleaned.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  let vin = vinMatch ? vinMatch[1] : '';
  if (vin) {
    vin = vin.toUpperCase().replace(/O/g, '0').replace(/I/g, '1').replace(/Q/g, '0').replace(/B/g, '8');
    if (!vin.match(/^[A-HJ-NPR-Z0-9]{17}$/)) vin = '';
  }

  const headerText = cleaned.substring(0, 600);
  let year = '';
  const myMatch =
    headerText.match(/\bM\.?Y\.?\s*(20\d{2}|19\d{2})\b/i) ||
    headerText.match(/\bModel\s*Year\s*(20\d{2}|19\d{2})\b/i) ||
    headerText.match(/\b(20\d{2}|19\d{2})\s*MY\b/i);
  if (myMatch) year = myMatch[1];
  if (!year) {
    const yearBefore = headerText.match(
      /\b(20\d{2}|19\d{2})\s+(?:Mercedes|Maybach|MB|GLE|GLS|GLC|GLA|S\s|E\s|C\s|EQ|AMG|GT|SL|CLS|CLA)\b/i
    );
    if (yearBefore) year = yearBefore[1];
  }
  if (!year) {
    const yearAny = headerText.match(/\b(20\d{2}|19\d{2})\b/);
    if (yearAny) year = yearAny[1];
  }

  let make = 'Mercedes-Benz';
  if (/Maybach/i.test(headerText)) make = 'Maybach';
  else if (/Mercedes[- ]?Benz/i.test(headerText) || /\bMercedes\b/i.test(headerText)) make = 'Mercedes-Benz';
  else if (/Mercedes[- ]?Benz/i.test(headerText) || /\bMB\b/i.test(headerText) || /\bMERCEDES\b/i.test(headerText))
    make = 'Mercedes-Benz';
  else if (
    vin.startsWith('W1') ||
    vin.startsWith('WDD') ||
    vin.startsWith('WDC') ||
    vin.startsWith('WDF') ||
    vin.startsWith('W1N') ||
    vin.startsWith('W1K')
  ) {
    make = 'Mercedes-Benz';
  }

  let model = '';
  const modelPatterns = [
    /\b(Maybach\s+)?(?:GLE|GLS|GLC|GLA|GLB|G)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|4M|AMG|Maybach|Coupe|SUV|Cabriolet))?\b/i,
    /\b(Maybach\s+)?S\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG|Maybach|Maybach\s+S))?\b/i,
    /\b(Maybach\s+)?E\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(Maybach\s+)?C\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(?:EQE|EQS|EQB|EQC|EQ)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\bAMG\s*(?:GT|SL|GLE|GLS|G)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(?:CLS|CLA|SL|GT|ML|GL)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(?:Sprinter|Vito|Metris)\b/i,
  ];
  for (const re of modelPatterns) {
    const m = headerText.match(re);
    if (m) {
      model = m[0].replace(/\s+/g, ' ').trim();
      break;
    }
  }
  if (!model) {
    const generic = headerText.match(/\b(?:20\d{2}|19\d{2}|Mercedes|Maybach|MB)\s+([A-Z]{1,4}[\s-]?\d{2,3}[A-Z0-9\s-]{0,10})/i);
    if (generic && generic[1]) model = generic[1].trim();
  }
  model = model.replace(/\b4\s*MATIC\b/i, '4MATIC').replace(/\s+/g, ' ').trim();

  let mileageIn = '';
  const labeled = headerText.match(
    /(?:MILEAGE\s*IN|MILEAGE IN|mileage\s*in|odometer|current\s*(?:mile|km)|miles\s*in)\s*:?\s*([\d,]{3,7})/i
  );
  if (labeled) {
    mileageIn = labeled[1].replace(/,/g, '');
  } else {
    const any = cleaned.match(/([\d,]{4,7})\s*(?:mi|mile|miles|km)\b/i);
    if (any) mileageIn = any[1].replace(/,/g, '');
  }

  return { vin, year, make, model, mileageIn, mileageOut: '' };
}

const ADVISOR_LABEL_PATTERN =
  /^(?:service\s+advisor(?:\s+name)?|svc\.?\s*advisor|advisor(?:\s+name)?|sa|writer)\s*:?\s*(.+)$/i;

/** Extract service advisor name from RO header / structured Grok output. */
export function extractServiceAdvisorFromText(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 40)) {
    const labeled = line.match(ADVISOR_LABEL_PATTERN);
    if (labeled?.[1]) {
      const name = labeled[1].trim();
      if (name.length >= 3 && name.length <= 48 && /[A-Za-z]/.test(name)) return name;
    }
  }

  const header = text.substring(0, 1200);
  const inlinePatterns = [
    /(?:service\s+advisor|svc\.?\s*advisor|advisor)\s*:?\s*([A-Z][A-Za-z'\-\.\s]{2,40})/i,
    /\bSA\s*:?\s*([A-Z][A-Za-z'\-\.\s]{2,35})/,
    /(?:written\s+by|prepared\s+by)\s*:?\s*([A-Z][A-Za-z'\-\.\s]{2,40})/i,
  ];
  for (const pattern of inlinePatterns) {
    const match = header.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim().replace(/\s{2,}/g, ' ');
      if (name.length >= 3 && !/vin|mileage|customer|technician|tech\b/i.test(name)) return name;
    }
  }

  return '';
}

export function extractCustomerName(text: string): string {
  const top = text.substring(0, 400);
  const patterns = [
    /customer\s*(?:name|:)?:?\s*([A-Z][A-Za-z'\-\s]{2,40})/i,
    /(?:name|owner)\s*:?\s*([A-Z][A-Za-z'\-\s]{2,40})/i,
    /^([A-Z][A-Za-z'\-\s]{2,30})\s*(?:RO|Repair|Vehicle|VIN)/im,
  ];
  for (const p of patterns) {
    const m = top.match(p) || text.match(p);
    if (m && m[1]) {
      const n = m[1].trim();
      if (n.length > 2 && n.length < 45 && !/vin|mile|ro|tech/i.test(n)) return n;
    }
  }
  return '';
}

export function parseStructuredROText(text: string): StructuredROExtraction {
  const vehicle: VehicleInfo = { vin: '', year: '', make: '', model: '', mileageIn: '', mileageOut: '' };
  let structuredComplaints: string[] = [];
  let customerName = '';
  let roNumber = '';
  let serviceAdvisorName = '';

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let inComplaints = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('ro number:')) {
      roNumber = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('service advisor name:') || lower.startsWith('service advisor:')) {
      serviceAdvisorName = (line.split(':').slice(1).join(':') || '').trim();
    } else if (lower.startsWith('year:')) {
      vehicle.year = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('make:')) {
      vehicle.make = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('model:')) {
      vehicle.model = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('mileage in:')) {
      vehicle.mileageIn = (line.split(':')[1] || '').replace(/[^0-9]/g, '');
    } else if (lower.startsWith('vin:')) {
      vehicle.vin = (line.split(':')[1] || '').replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();
    } else if (lower.startsWith('customer name:')) {
      customerName = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('customer complaints:')) {
      inComplaints = true;
      continue;
    }

    if (inComplaints) {
      if (/none listed/i.test(line)) {
        structuredComplaints = [];
        inComplaints = false;
        continue;
      }
      if (/^customer complaints?:?$/i.test(lower)) {
        continue;
      }
      if (/^ro number:|^year:|^make:|^model:|^vin:|^mileage/i.test(lower)) {
        inComplaints = false;
        continue;
      }

      const parsed = parseComplaintLabelSegment(line);
      if (parsed) {
        const c = trimComplaintContinuation(parsed.text);
        if (isValidComplaintText(c)) structuredComplaints.push(c);
      } else {
        const numbered = line.match(/^(\d{1,2})[\.\)\:\s\-–—–—]+\s*(.+)$/i);
        if (numbered && numbered[2]) {
          const c = trimComplaintContinuation(numbered[2]);
          if (isValidComplaintText(c)) structuredComplaints.push(c);
        } else if (isValidComplaintText(line)) {
          structuredComplaints.push(normalizeComplaintText(line));
        }
      }
    }
  }

  if (!roNumber) {
    const m = text.match(/(?:RO Number|RO#|Repair Order|Work Order)[:\s#]*([A-Z0-9\-]{3,12})/i);
    if (m) roNumber = m[1];
  }
  if (!vehicle.vin) {
    const m = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (m) vehicle.vin = m[1].toUpperCase();
  }
  if (!vehicle.year) {
    const m = text.match(/\b(20\d{2}|19\d{2})\b/);
    if (m) vehicle.year = m[1];
  }
  if (!vehicle.make || vehicle.make === 'Mercedes-Benz') {
    if (/Maybach/i.test(text)) vehicle.make = 'Maybach';
    else if (/Mercedes/i.test(text)) vehicle.make = 'Mercedes-Benz';
  }
  if (!vehicle.model) {
    const m = text.match(/\b(GLE|GLS|GLC|GLA|S\s*\d|E\s*\d|C\s*\d|EQ[A-Z]?\s*\d|AMG)\s*\d{0,3}[A-Z]?(?:\s*4MATIC|AMG)?\b/i);
    if (m) vehicle.model = m[0].trim();
  }
  if (!vehicle.mileageIn) {
    const m = text.match(/(?:mileage in|odometer)[:\s]*([\d,]{3,7})/i);
    if (m) vehicle.mileageIn = m[1].replace(/,/g, '');
  }
  if (!customerName) {
    const m = text.match(/customer name[:\s]*([A-Z][A-Za-z'\-\s]{2,35})/i);
    if (m) customerName = m[1].trim();
  }
  if (!serviceAdvisorName) {
    serviceAdvisorName = extractServiceAdvisorFromText(text);
  }

  const recovered = recoverComplaintsWithLabelsFromText(
    text,
    mergeComplaintLists(structuredComplaints, extractComplaints(text))
  );

  if (vehicle.vin && vehicle.vin.length !== 17) {
    vehicle.vin = vehicle.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
  }
  vehicle.mileageIn = (vehicle.mileageIn || '').replace(/[^0-9]/g, '');

  return {
    vehicle,
    complaints: recovered.complaints,
    complaintLabels: recovered.labels,
    customerName,
    roNumber,
    serviceAdvisorName: serviceAdvisorName || undefined,
  };
}

export function extractRoNumberFromText(text: string): string {
  return (
    (text.match(/(?:^|\n)\s*(?:RO\s*#?|Repair\s*Order|Work\s*Order|RO#)\s*[:#]?\s*([A-Z0-9\-]{3,12})/im) || [])[1] ||
    (text.match(/(?:RO|Repair Order|Work Order)\s*[:#]?\s*([A-Z0-9\-]{3,12})/i) || [])[1] ||
    `R-${Date.now().toString().slice(-6)}`
  );
}

export function sanitizeComplaints(complaints: string[]): string[] {
  return complaints.filter((c) => isValidComplaintText(c));
}

export function sanitizeVehicle(vehicle: VehicleInfo): VehicleInfo {
  const v = { ...vehicle };
  if (v.vin && v.vin.length !== 17) {
    v.vin = v.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
  }
  v.mileageIn = (v.mileageIn || '').replace(/[^0-9]/g, '');
  return v;
}