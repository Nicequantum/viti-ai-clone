import React, { useState, useEffect } from 'react';
import { Camera, Settings, ArrowLeft, Plus, Copy, RefreshCw } from 'lucide-react';
import Tesseract from 'tesseract.js';

// Types
interface ExtractedData {
  codes: string[];
  guidedTests: string[];
  measurements: Array<{ label: string; value: string }>;
  components: string[];
  circuits: string[];
}

interface RepairLine {
  id: string;
  lineNumber: number;
  description: string;
  customerConcern: string;
  technicianNotes: string;
  xentryImages: Array<{ id: string; dataUrl: string; name: string }>;
  xentryOcrTexts?: string[];  // raw OCR from diagnostic photos for AI
  extractedData?: ExtractedData;
  warrantyStory?: string;
}

interface RepairOrder {
  id: string;
  roNumber: string;
  vehicle: {
    vin: string;
    year: string;
    model: string;
    mileageIn: string;
    mileageOut: string;
  };
  customer: {
    name: string;
  };
  complaints: string[];
  repairLines: RepairLine[];
  createdAt?: string;
}

// Full system prompt - now includes new mandatory Mercedes-Benz warranty requirements
const SYSTEM_PROMPT = `Act as a senior Mercedes-Benz master technician with 18 years experience writing warranty stories that always pass review.
Strict rules you must follow:

Always mention that a battery charger was connected during the entire repair.
Always state that an initial Quick Test was performed using XENTRY.
Include a test drive with mileage in and mileage out (use realistic numbers like 12 miles in, 15 miles out).
Clearly show the 3 C’s: Customer Complaint/Concern, Cause, and Correction.
Always perform and document a final Quick Test after repairs.
End with a final verification drive to confirm the repair.

Use the following example as the GOLD STANDARD for technical depth, specificity (exact module names like MRG1AMGV8, adaptation values like ZGSTH +1.05%, fra/fra2, ora/ora2, lambda, guided test results, pressures, injector IMA codes, recoding steps like HW3 to 32 2D, data before/after, etc.), natural first-person language, and professional detail level:

Customer presented vehicle with check engine light illuminated and reports of intermittent rough idle and hesitation during acceleration. Diagnostic scan confirmed DTCs P0171 (system too lean, bank 1) and P0174 (system too lean, bank 2). Performed initial quick test via XENTRY, revealing no additional faults in other modules. Conducted smoke test on intake system to rule out vacuum leaks; no leaks detected, confirming issue isolated to fuel delivery. Reviewed injector adaptation data in motor electronics module (MRG1AMGV8), noting cylinder-specific smoothing corrections (ZGSTH) with significant deviations: cylinder 3 at +1.05% and cylinder 7 at +1.34% (indicating under-delivery, ECU compensating by adding fuel), while cylinders 2 and 8 showed -0.55% and -1.32% respectively (indicating over-delivery, ECU reducing fuel). Global fuel rail adaptations (fra/fra2) exceeded 1.0 (1.074707 and 1.028168), supporting overall lean condition, and lambda offsets (ora/ora2) displayed split readings with bank 1 leaning positive (0.125000%) and bank 2 trending rich (-0.179688%), consistent with mixed cylinder contributions averaging to lean banks. Ran guided high-pressure fuel system tests on both banks per XENTRY protocol; rail pressure held stable at idle (200-250 bar) and under load (up to 2000+ bar), with no external leaks, but leak-off rates on cylinders 3 and 7 exceeded specifications, suggesting internal injector faults or carbon buildup. Cleared all injector adaptation values to reset baseline, then performed Mercedes-Benz prescribed drive cycle: cold start, idle warm-up, steady cruise at 50-60 mph, wide-open throttle bursts to 4000 RPM, and stop-and-go simulation. Post-drive data logging showed trims re-establishing similar patterns, with cylinders 3 and 7 persistently positive and contributing to the lean DTCs, confirming hardware failure rather than software drift. Replaced injectors for cylinders 3 (bank 1, third from front) and 7 (bank 2, third from front) with new Bosch piezo units (calibration codes 322DB and 332FN), entered updated IMA codes into the ECU (updating HW3 to 32 2D and HW7 to 34 34), and re-encoded SE cluster. Cleared adaptations again and performed final verification drive cycle; post-replacement data showed improved global adaptations nearing 1.0 (fra at 1.011810 and fra2 at 0.986298), lambda offsets tightening (ora at 0.242188% and ora2 at -0.554688%), and cylinder trims shifting with cylinder 3 flipping to -3.07% (over-delivery correction) and cylinder 7 at -1.61% (mild over-delivery), while overall spread narrowed with cylinders 1 at +1.57%, 2 at +0.76%, 4 at +0.66%, 5 at -0.01%, 6 at +2.11%, and 8 at -0.44%, and DTCs did not recur after adaptation learning. Vehicle released with smooth idle, no hesitation, and check engine light extinguished. Warranty labor includes diagnostics, smoke test, guided fuel system tests, adaptation resets, injector replacement, recoding, and multiple road test verifications.

Vary the writing style and structure naturally using one of the provided templates so stories do not sound identical, but ALWAYS cover the mandatory requirements above and match the example's technical depth and detail using the actual data provided in the user message (Xentry codes, adaptations, Guided Tests, pressures, etc.). Write in natural first-person technician language. Sound like a real tech who did the work. Structure every story using the 3 C's. Punch times must logically match the work described. Use realistic mileage numbers for test drives. Write only the warranty story for this specific line. Make it sound completely human.`;

// 12 varied template structures for natural variety (AI picks one per generation via prompt)
const STORY_TEMPLATES = [
  "Chronological narrative: Open with customer presentation, symptoms, and initial DTCs from Quick Test. Detail the diagnostic path, data analysis, and tests performed. Identify cause. Describe correction steps including parts and coding. Document final Quick Test results. End with verification drive confirmation and battery charger mention.",
  "Data-first technical deep-dive: Lead with specific Xentry data points, adaptations (e.g. ZGSTH, fra/fra2, ora), module names, and Guided Test results. Explain how the data reveals the cause. Cover initial and final Quick Tests, test drive mileages, 3 C's woven in, repair details, and verification drive.",
  "3 C's explicit structure: Clearly state 'Customer Complaint: ... Cause: ... Correction: ...' early. Then provide supporting test data, initial Quick Test, drive cycles, final Quick Test, and verification. Integrate battery charger and realistic mileages naturally.",
  "Step-by-step diagnostic journey: 'I began by connecting the battery charger and performing initial XENTRY Quick Test...' Sequence through tests, data review, cause determination, repair actions, final Quick Test, verification drive. Use varied sentence lengths for flow.",
  "Before-and-after data comparison: Detail pre-repair data (adaptations, pressures, trims) from initial Quick Test and Guided Tests. Describe correction. Then post-repair data from final Quick Test showing improvement. Include test drives with in/out mileage, 3 C's, battery charger mention.",
  "Module and adaptation focused: Dive deep into specific ECU/module (e.g. MRG1AMGV8), cylinder trims (ZGSTH values), global adaptations, lambda offsets. Tie data to cause. Cover Quick Tests, drive cycle description with mileages, repair (injector replacement + IMA coding), final verification.",
  "Test sequence and drive cycle emphasis: Emphasize the sequence of initial Quick Test, smoke/guided tests, adaptation reset, prescribed drive cycle (cold start, cruise, WOT, etc. with realistic speeds/miles), final Quick Test, verification drive. Weave in data and 3 C's.",
  "Evidence-based cause deduction: List multiple data points (DTCs, adaptations, leak-off rates, pressures) as evidence building to the root cause (e.g. specific injectors). Then correction, tests, drives, battery charger, final confirmation.",
  "Repair execution and recoding focus: After brief diagnosis, detail the physical repair (which cylinders, part numbers, calibration codes), ECU recoding steps (HWx to XX XX), SE cluster, then post-repair Quick Test and verification drive data proving success.",
  "Customer symptom to root cause narrative: Start with how symptoms manifested (idle, hesitation during accel). Link to initial Quick Test DTCs. Use data to deduce cause. Detail fix, final tests and drives. End with customer vehicle released smooth.",
  "Warranty labor documentation style: Frame as professional record: Initial Quick Test and charger connection. Diagnostic steps and findings with exact values. Cause and 3 C's. Replacement and coding actions. Final Quick Test and verification drive. Summarize labor operations.",
  "Conversational tech recap: Sound like explaining the job to a fellow tech over coffee: 'Customer comes in with CEL and rough idle...' Describe the process, key data points that sealed the cause, what was replaced and coded, the drives, final confirmation that it was fixed."
];

// Grok API call
async function generateWarrantyStoryWithGrok(
  ro: RepairOrder,
  line: RepairLine,
  apiKey: string,
  historyContext: string = ''
): Promise<string> {
  const vehicleInfo = `${ro.vehicle.year} ${ro.vehicle.model} | VIN: ${ro.vehicle.vin} | Miles: ${ro.vehicle.mileageIn} → ${ro.vehicle.mileageOut}`;

  const allRepairs = ro.repairLines
    .map((l) => `Line ${l.lineNumber}: ${l.description}`)
    .join('\n');

  const data = line.extractedData || { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] };
  const xentryText = [
    data.codes.length ? `Codes: ${data.codes.join(', ')}` : '',
    data.guidedTests.length ? `Guided Tests: ${data.guidedTests.join(' | ')}` : '',
    data.measurements.length ? `Measurements: ${data.measurements.map(m => `${m.label} = ${m.value}`).join('; ')}` : '',
    data.components.length ? `Components: ${data.components.join(' | ')}` : '',
    data.circuits.length ? `Circuits/Pins: ${data.circuits.join(', ')}` : ''
  ].filter(Boolean).join('\n') || 'No Xentry data provided.';

  // Include raw OCR from diagnostic photos for more accurate AI analysis
  const rawXentryOcr = (line.xentryOcrTexts && line.xentryOcrTexts.length > 0)
    ? '\nRaw OCR from Xentry photos:\n' + line.xentryOcrTexts.join('\n---\n')
    : '';

  const selectedTemplate = STORY_TEMPLATES[Math.floor(Math.random() * STORY_TEMPLATES.length)];

  const userMessage = `Vehicle information: ${vehicleInfo}

RO Complaints (A, B, C etc from photo):
${(ro.complaints || []).join('\n')}

All repairs on this RO:
${allRepairs}

Current repair line: Line ${line.lineNumber} - ${line.description}

Customer concern for this line: ${line.customerConcern || line.description}

Technician notes: ${line.technicianNotes || 'None'}

Xentry test data and images:
${xentryText}
${rawXentryOcr}
${historyContext}

MANDATORY REQUIREMENTS - Your story MUST explicitly include all of these (use the example in system prompt as gold standard for depth):
- A battery charger was connected during the entire repair.
- An initial Quick Test was performed using XENTRY.
- Include a test drive with realistic mileage in (e.g. 12 miles) and mileage out (e.g. 15 miles).
- Clearly show the 3 C’s: Customer Complaint/Concern, Cause, and Correction.
- Always perform and document a final Quick Test after repairs.
- End with a final verification drive to confirm the repair.

For natural variety on this generation, follow this template structure (but keep it flowing naturally in first-person tech language and match the technical detail level of the example): ${selectedTemplate}

Write only the warranty story for this specific line. Make it sound completely human.`;

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-3',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 900
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error: ${response.status} ${err}`);
  }

  const apiResponse = await response.json();
  return apiResponse.choices?.[0]?.message?.content?.trim() || 'No story generated.';
}

function App() {
  const [view, setView] = useState<'home' | 'ro' | 'line' | 'settings'>('home');
  const [currentRO, setCurrentRO] = useState<RepairOrder | null>(null);
  const [currentLineId, setCurrentLineId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [allROs, setAllROs] = useState<RepairOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // IndexedDB helpers for persistent multi-RO storage
  const DB_NAME = 'benztech_db';
  const STORE_NAME = 'repairOrders';

  async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadAllROs(): Promise<RepairOrder[]> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('IDB load failed, falling back to empty', e);
      return [];
    }
  }

  async function saveROToDB(ro: RepairOrder): Promise<void> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(ro);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('IDB save failed', e);
    }
  }

  async function deleteROFromDB(id: string): Promise<void> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('IDB delete failed', e);
    }
  }

  // Load all ROs and key on mount
  useEffect(() => {
    (async () => {
      const saved = await loadAllROs();
      setAllROs(saved);
      const savedKey = localStorage.getItem('benztech_grok_key');
      if (savedKey) setApiKey(savedKey);
    })();
  }, []);

  const saveRO = (ro: RepairOrder | null) => {
    if (ro) {
      saveROToDB(ro); // persist async in background
      setAllROs(prev => {
        const idx = prev.findIndex(r => r.id === ro.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = ro;
          return copy;
        } else {
          return [ro, ...prev];
        }
      });
    }
    setCurrentRO(ro);
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('benztech_grok_key', key);
  };

  const deleteRO = async (id: string) => {
    if (!confirm('Delete this RO and all its data?')) return;
    await deleteROFromDB(id);
    setAllROs(prev => prev.filter(r => r.id !== id));
    if (currentRO?.id === id) {
      setCurrentRO(null);
      setCurrentLineId(null);
      setView('home');
    }
  };

  const openRO = (ro: RepairOrder) => {
    setCurrentRO(ro);
    setCurrentLineId(null);
    setView('ro');
  };

  const currentLine = currentRO?.repairLines.find(l => l.id === currentLineId);

  // Camera + OCR
  const handleScanRO = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setIsProcessingOCR(true);
      setOcrProgress(0);

      try {
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: m => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        });

        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();

        createROFromText(text);
      } catch (error) {
        alert('OCR failed. You can enter data manually.');
        createROFromText('');
      } finally {
        setIsProcessingOCR(false);
        setOcrProgress(0);
      }
    };
    input.click();
  };

  // Helper to parse complaints A. B. C. etc from RO OCR text
  function extractComplaints(text: string): string[] {
    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 3);
    const comps: string[] = [];
    let capturing = false;
    for (const line of lines) {
      if (/customer\s*concern|complaint|concerns?/i.test(line)) {
        capturing = true;
        continue;
      }
      if (capturing) {
        const match = line.match(/^([A-Z]\.?\s*|\d+\.?\s*|-?\s*)(.+)$/);
        if (match && match[2].length > 5) {
          comps.push(`${match[1].trim()} ${match[2].trim()}`.trim());
        } else if (comps.length === 0 && line.length > 15 && !/vin|ro\s*#|mileage|tech|date/i.test(line)) {
          comps.push(line);
        }
        if (comps.length > 0 && /vehicle|vin|mileage|technician|ro\s*#/i.test(line)) break;
      }
    }
    return comps.length > 0 ? comps.slice(0, 8) : (text ? [text.slice(0, 300)] : ['Enter customer concerns manually']);
  }

  function extractVehicleDetails(text: string) {
    const vin = (text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/) || [])[1] || '';
    const yearMatch = text.match(/\b(20\d{2}|19\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : '';
    const modelMatch = text.match(/\b(GLE|GLS|GLC|E-Class|C-Class|S-Class|CLS|GLA|GLB|AMG)\s*[\w-]*\b/i);
    const model = modelMatch ? modelMatch[0] : '';
    const mileageMatch = text.match(/(\d{1,3}(,\d{3})*)\s*(mi|mile|km)/i);
    const mileageIn = mileageMatch ? mileageMatch[1].replace(/,/g,'') : '';
    return { vin, year, model, mileageIn, mileageOut: '' };
  }

  const createROFromText = (text: string) => {
    const roNumber = (text.match(/RO[:\s#]*(\S+)/i) || [])[1] || `R-${Date.now()}`;
    const vehicle = extractVehicleDetails(text);
    const complaints = extractComplaints(text);

    const newRO: RepairOrder = {
      id: 'ro-' + Date.now(),
      roNumber,
      vehicle,
      customer: { name: '' },
      complaints,
      createdAt: new Date().toISOString(),
      repairLines: [{
        id: 'line-1',
        lineNumber: 1,
        description: 'Enter repair description',
        customerConcern: complaints[0] || '',
        technicianNotes: '',
        xentryImages: [],
        xentryOcrTexts: [],
        extractedData: { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] }
      }]
    };

    saveRO(newRO);
    setView('ro');
  };

  // Parse Xentry diagnostic screenshot text into structured data
  function parseDiagnosticText(text: string): Partial<ExtractedData> {
    const upper = text.toUpperCase();
    const codes = Array.from(upper.matchAll(/\b([PBCU]\d{4}(?:[-–]\d{3})?)\b/g)).map(m => m[1]);
    const guidedTests = Array.from(text.matchAll(/Guided Test[:\s-]*(.+?)(?=\n|Test|$)/gi)).map(m => m[1].trim()).filter(t => t.length > 3);
    const measurements = Array.from(text.matchAll(/([A-Za-z0-9\s\/]+?)\s*[:=]\s*([\d.]+\s*(?:V|VOLTS|PSI|BAR|OHM|kOHM|°C|°F)?)/gi))
      .map(m => ({ label: m[1].trim(), value: m[2].trim() })).slice(0, 6);
    const components = Array.from(upper.matchAll(/\b([A-Z]\d{1,2}\/\d{1,2}[A-Z]?(?:Y\d)?)\b/g)).map(m => m[1]);
    const circuits = Array.from(text.matchAll(/pin\s*(\d+\.?\d*)|circuit\s*(\d+[A-Z]?)/gi)).map(m => m[0].trim());
    return { codes, guidedTests, measurements, components, circuits };
  }

  function mergeExtracted(base: ExtractedData, add: Partial<ExtractedData>): ExtractedData {
    return {
      codes: [...new Set([...(base.codes || []), ...(add.codes || [])])],
      guidedTests: [...new Set([...(base.guidedTests || []), ...(add.guidedTests || [])])],
      measurements: [...(base.measurements || []), ...(add.measurements || [])].slice(0, 8),
      components: [...new Set([...(base.components || []), ...(add.components || [])])],
      circuits: [...new Set([...(base.circuits || []), ...(add.circuits || [])])],
    };
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  const createManualRO = () => {
    const newRO: RepairOrder = {
      id: 'ro-' + Date.now(),
      roNumber: `R-${Date.now().toString().slice(-6)}`,
      vehicle: { vin: '', year: '', model: '', mileageIn: '', mileageOut: '' },
      customer: { name: '' },
      complaints: ['Enter customer concerns from RO'],
      createdAt: new Date().toISOString(),
      repairLines: [{
        id: 'line-1',
        lineNumber: 1,
        description: 'Enter repair description',
        customerConcern: '',
        technicianNotes: '',
        xentryImages: [],
        xentryOcrTexts: [],
        extractedData: { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] }
      }]
    };
    saveRO(newRO);
    setView('ro');
  };

  const addXentryPhotos = async (lineId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.setAttribute('capture', 'environment');

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length === 0 || !currentRO) return;

      setIsProcessingOCR(true);
      setOcrProgress(0);

      const latestROAtClick = allROs.find(r => r.id === currentRO?.id) || currentRO;
      const lineForExtract = latestROAtClick ? latestROAtClick.repairLines.find(l => l.id === lineId) : null;
      let updatedExtracted: ExtractedData = (lineForExtract?.extractedData) || { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] };
      let updatedOcrTexts: string[] = lineForExtract?.xentryOcrTexts || [];
      const newImgs: Array<{ id: string; dataUrl: string; name: string }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrl = await fileToDataUrl(file);
        newImgs.push({ id: 'ximg-' + Date.now() + i, dataUrl, name: file.name });

        try {
          const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
              if (m.status === 'recognizing text') {
                setOcrProgress(Math.round(((i + m.progress) / files.length) * 100));
              }
            }
          });
          const { data: { text } } = await worker.recognize(file);
          await worker.terminate();

          const diag = parseDiagnosticText(text);
          updatedExtracted = mergeExtracted(updatedExtracted, diag);
          updatedOcrTexts = [...updatedOcrTexts, text];
        } catch (err) {
          console.warn('Xentry OCR failed for one image', err);
        }
      }

      if (!latestROAtClick) return;
      const lineInLatest = latestROAtClick.repairLines.find(l => l.id === lineId);
      const updatedLine = {
        xentryImages: [...(lineInLatest?.xentryImages || []), ...newImgs],
        xentryOcrTexts: updatedOcrTexts,
        extractedData: updatedExtracted
      };
      const updatedLines = latestROAtClick.repairLines.map(l => l.id === lineId ? { ...l, ...updatedLine } : l);
      saveRO({ ...latestROAtClick, repairLines: updatedLines });
      setIsProcessingOCR(false);
      setOcrProgress(0);
      alert(`${files.length} diagnostic photo(s) added and analyzed.`);
    };
    input.click();
  };

  const addRepairLine = () => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const newLine: RepairLine = {
      id: 'line-' + Date.now(),
      lineNumber: latestRO.repairLines.length + 1,
      description: 'New repair item',
      customerConcern: '',
      technicianNotes: '',
      xentryImages: [],
      xentryOcrTexts: [],
      extractedData: { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] }
    };
    const updated = { ...latestRO, repairLines: [...latestRO.repairLines, newLine] };
    saveRO(updated);
    setCurrentLineId(newLine.id);
    setView('line');
  };

  const updateLine = (lineId: string, updates: Partial<RepairLine>) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const updatedLines = latestRO.repairLines.map(line =>
      line.id === lineId ? { ...line, ...updates } : line
    );
    const updatedRO = { ...latestRO, repairLines: updatedLines };
    saveRO(updatedRO);
  };

  // Grok generation - enhanced with history for smarter AI over time
  const generateStory = async (lineId: string) => {
    if (!currentRO || !apiKey) {
      alert('Please enter your Grok API key in Settings first.');
      setView('settings');
      return;
    }

    // use latest from list to avoid stale closure
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const line = latestRO.repairLines.find(l => l.id === lineId);
    if (!line) return;

    setIsGenerating(true);
    try {
      // Learn from history: include 1-2 similar past stories in prompt for consistency
      let historyContext = '';
      const similar = allROs
        .filter(r => r.id !== latestRO.id && r.vehicle.model && latestRO.vehicle.model && r.vehicle.model.toLowerCase().includes(latestRO.vehicle.model.toLowerCase().split(' ')[0]))
        .slice(0, 2);
      if (similar.length > 0) {
        historyContext = '\n\nFor style consistency, examples from my previous similar repairs:\n' + 
          similar.map(r => r.repairLines.filter(l => l.warrantyStory).map(l => `For ${l.description}: ${l.warrantyStory!.substring(0, 250)}...`).join('\n')).join('\n---\n');
      }

      const story = await generateWarrantyStoryWithGrok(latestRO, line, apiKey, historyContext);
      const updatedLines = latestRO.repairLines.map(l => l.id === lineId ? { ...l, warrantyStory: story } : l);
      saveRO({ ...latestRO, repairLines: updatedLines });
    } catch (error: any) {
      alert('Failed to generate story: ' + (error.message || 'Check your API key and internet connection.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const copyStory = (story: string) => {
    navigator.clipboard.writeText(story);
    alert('Copied to clipboard!');
  };

  // Render helpers
  const renderHome = () => {
    const filteredROs = allROs.filter(ro => 
      ro.roNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ro.vehicle.model && ro.vehicle.model.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (ro.vehicle.vin && ro.vehicle.vin.toLowerCase().includes(searchTerm.toLowerCase()))
    ).sort((a,b) => ((b.createdAt || '0') > (a.createdAt || '0') ? 1 : -1));

    return (
      <div className="relative min-h-dvh px-4 pt-2 pb-8">
        {/* Gear icon in top right of main screen */}
        <button
          onClick={() => setView('settings')}
          className="absolute top-4 right-4 p-2 text-[#8e8e93] z-10 touch-target"
          aria-label="Settings"
        >
          <Settings size={22} />
        </button>

        <div className="pt-12">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#0a84ff] to-[#0066cc] flex items-center justify-center mb-3">
              <span className="text-white text-3xl font-bold">★</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tighter">BenzTech</h1>
            <p className="text-[#8e8e93] text-sm">Mercedes-Benz Warranty Stories • History</p>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              onClick={handleScanRO}
              disabled={isProcessingOCR}
              className="primary-btn flex-1 h-12 flex items-center justify-center gap-2 text-sm"
            >
              <Camera size={18} />
              {isProcessingOCR ? `SCANNING RO... ${ocrProgress}%` : 'SCAN NEW RO'}
            </button>
            <button
              onClick={createManualRO}
              className="secondary-btn flex-1 h-12 flex items-center justify-center gap-2 text-sm"
            >
              <Plus size={18} /> NEW MANUAL
            </button>
          </div>

          <div className="mb-3">
            <input
              type="text"
              placeholder="Search past ROs (number, model, VIN)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-xl px-4 py-2.5 text-sm placeholder-[#8e8e93]"
            />
          </div>

          {filteredROs.length === 0 ? (
            <div className="text-center py-10 text-[#8e8e93]">
              <p>No past ROs yet.</p>
              <p className="text-xs mt-1">Scan your first repair order above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredROs.map(ro => (
                <div 
                  key={ro.id} 
                  onClick={() => openRO(ro)}
                  className="ios-card p-3 active:bg-[#252528] cursor-pointer flex justify-between items-center"
                >
                  <div>
                    <div className="font-semibold text-sm">{ro.roNumber}</div>
                    <div className="text-xs text-[#8e8e93]">{ro.vehicle.year} {ro.vehicle.model} • {ro.repairLines.length} lines</div>
                    <div className="text-[10px] text-[#8e8e93] mt-0.5">{ro.complaints[0]?.slice(0,60)}...</div>
                    <div className="text-[9px] text-[#666]">{ro.createdAt ? new Date(ro.createdAt).toLocaleDateString() : ''}</div>
                  </div>
                  <div className="text-right">
                    {ro.repairLines.some(l => l.warrantyStory) && <div className="text-[10px] text-[#30d158]">✓ stories</div>}
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteRO(ro.id); }} 
                      className="text-[10px] text-[#ff9f0a] mt-1"
                    >
                      DEL
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRO = () => {
    if (!currentRO) return null;

    return (
      <div className="px-5 pt-4 pb-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="text-xl font-semibold">{currentRO.roNumber}</div>
            <div className="text-sm text-[#8e8e93]">{currentRO.vehicle.model || 'Vehicle details'}</div>
          </div>
        </div>

        <div className="ios-card p-4 mb-6">
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-2">CUSTOMER CONCERNS (from RO)</div>
          {currentRO.complaints.map((c, idx) => (
            <div key={idx} className="text-sm leading-snug mb-1 border-l-2 border-[#0a84ff] pl-2">{c}</div>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-sm font-semibold text-[#8e8e93]">REPAIR LINES</div>
          <button onClick={addRepairLine} className="flex items-center gap-1 text-[#0a84ff] text-sm font-medium">
            <Plus size={16} /> ADD LINE
          </button>
        </div>

        <div className="space-y-2">
          {currentRO.repairLines.map(line => (
            <div
              key={line.id}
              onClick={() => {
                const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
                if (latestRO) {
                  setCurrentRO(latestRO);
                  setCurrentLineId(line.id);
                  setView('line');
                }
              }}
              className="ios-card px-4 py-4 flex justify-between items-center active:bg-[#252528] cursor-pointer"
            >
              <div>
                <div className="font-medium">Line {line.lineNumber}: {line.description}</div>
                {line.warrantyStory && <div className="text-xs text-[#30d158] mt-0.5">Story ready</div>}
              </div>
              <div className="text-[#8e8e93]">›</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setView('home')}
            className="flex-1 text-sm text-[#8e8e93] py-2 border border-[#38383a] rounded"
          >
            Back to List
          </button>
          <button
            onClick={() => deleteRO(currentRO.id)}
            className="flex-1 text-sm text-[#ff9f0a] py-2 border border-[#38383a] rounded"
          >
            Delete RO
          </button>
        </div>
      </div>
    );
  };

  const renderLine = () => {
    if (!currentLine || !currentRO) return null;

    return (
      <div className="px-5 pt-4 pb-10">
        <button onClick={() => {
          const latest = allROs.find(r => r.id === currentRO?.id) || currentRO;
          if (latest) setCurrentRO(latest);
          setView('ro');
        }} className="flex items-center text-[#0a84ff] mb-4">
          <ArrowLeft size={18} className="mr-1" /> Back to RO
        </button>

        <div className="mb-6">
          <div className="text-sm text-[#8e8e93]">LINE {currentLine.lineNumber}</div>
          <input
            value={currentLine.description}
            onChange={(e) => updateLine(currentLine.id, { description: e.target.value })}
            className="text-xl font-semibold bg-transparent w-full focus:outline-none"
          />
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-xs uppercase tracking-widest text-[#8e8e93] block mb-1.5">CUSTOMER CONCERN</label>
            <textarea
              value={currentLine.customerConcern}
              onChange={(e) => updateLine(currentLine.id, { customerConcern: e.target.value })}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-2xl p-3.5 text-sm min-h-[80px]"
              placeholder="Customer stated..."
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-[#8e8e93] block mb-1.5">TECHNICIAN NOTES</label>
            <textarea
              value={currentLine.technicianNotes}
              onChange={(e) => updateLine(currentLine.id, { technicianNotes: e.target.value })}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-2xl p-3.5 text-sm min-h-[100px]"
              placeholder="Road test results, findings..."
            />
          </div>

          {/* New: Add Xentry / Diagnostic Photos button */}
          <div>
            <button
              onClick={() => addXentryPhotos(currentLine.id)}
              disabled={isProcessingOCR}
              className="secondary-btn w-full h-12 flex items-center justify-center gap-2 text-sm mb-2"
            >
              <Camera size={18} />
              {isProcessingOCR ? `ANALYZING XENTRY PHOTOS... ${ocrProgress}%` : 'ADD XENTRY / DIAGNOSTIC PHOTOS'}
            </button>
            {currentLine.xentryImages && currentLine.xentryImages.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                {currentLine.xentryImages.map((img, idx) => (
                  <img 
                    key={idx} 
                    src={img.dataUrl} 
                    className="w-full h-16 object-cover rounded border border-[#38383a]" 
                    alt={img.name}
                    onClick={() => window.open(img.dataUrl)}
                  />
                ))}
              </div>
            )}
            {currentLine.extractedData && (currentLine.extractedData.codes.length || currentLine.extractedData.guidedTests.length || currentLine.extractedData.measurements.length) && (
              <div className="text-[10px] bg-[#1c1c1e] p-2 rounded mb-2">
                <div className="font-semibold mb-1">Extracted from Xentry:</div>
                {currentLine.extractedData.codes.length > 0 && <div>Codes: {currentLine.extractedData.codes.join(', ')}</div>}
                {currentLine.extractedData.guidedTests.length > 0 && <div>Guided: {currentLine.extractedData.guidedTests.slice(0,2).join(' | ')}</div>}
                {currentLine.extractedData.measurements.length > 0 && <div>Meas: {currentLine.extractedData.measurements[0].label}={currentLine.extractedData.measurements[0].value}</div>}
              </div>
            )}
          </div>

          <div>
            <button
              onClick={() => generateStory(currentLine.id)}
              disabled={isGenerating || !apiKey}
              className="primary-btn w-full h-14 text-base disabled:opacity-60"
            >
              {isGenerating ? 'GENERATING WITH GROK...' : 'GENERATE WARRANTY STORY'}
            </button>
            {!apiKey && <p className="text-center text-xs text-[#ff9f0a] mt-2">Add API key in Settings to use Grok</p>}
          </div>

          {currentLine.warrantyStory && (
            <div className="story-card p-5 mt-2">
              <div className="text-xs uppercase tracking-[1px] text-[#8e8e93] mb-3">WARRANTY STORY</div>
              <div className="whitespace-pre-line text-[14.5px] leading-relaxed mb-5">{currentLine.warrantyStory}</div>
              <div className="flex gap-3">
                <button onClick={() => copyStory(currentLine.warrantyStory!)} className="flex-1 secondary-btn h-11 flex items-center justify-center gap-2 text-sm">
                  <Copy size={16} /> COPY
                </button>
                <button onClick={() => generateStory(currentLine.id)} className="secondary-btn h-11 px-5 flex items-center gap-2 text-sm">
                  <RefreshCw size={16} /> REGENERATE
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="px-5 pt-6">
      <button onClick={() => setView(currentRO ? 'ro' : 'home')} className="flex items-center text-[#0a84ff] mb-6">
        <ArrowLeft size={18} className="mr-1" /> Back
      </button>

      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

      <div className="ios-card p-5 mb-6">
        <div className="font-semibold mb-2">Grok API Key</div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="xai-..."
          className="w-full bg-[#2c2c2e] border border-[#444] rounded-xl p-3.5 font-mono text-sm mb-3"
        />
        <div className="flex gap-3">
          <button onClick={() => saveApiKey(apiKey)} className="flex-1 secondary-btn h-11">Save Key</button>
          <button onClick={() => { setApiKey(''); localStorage.removeItem('benztech_grok_key'); }} className="secondary-btn h-11 px-6 text-[#ff9f0a]">Clear</button>
        </div>
        <p className="text-xs text-[#8e8e93] mt-3 leading-snug">
          Get your key at console.x.ai. Stored locally only. Required for real AI-generated stories.
        </p>
      </div>

      <div className="text-xs text-[#8e8e93] px-1 leading-relaxed">
        This app uses the official Grok API with the exact Mercedes-Benz master technician prompt for warranty stories.
      </div>
    </div>
  );

  return (
    <div className="app-container">
      {/* Global header for non-main screens */}
      {view !== 'home' && view !== 'settings' && (
        <header className="ios-header h-14 px-4 flex items-center justify-between sticky top-0 z-50">
          <div className="font-semibold tracking-tight">BenzTech</div>
          <button onClick={() => setView('settings')} className="p-2 text-[#8e8e93]">
            <Settings size={20} />
          </button>
        </header>
      )}

      {view === 'home' && renderHome()}
      {view === 'ro' && renderRO()}
      {view === 'line' && renderLine()}
      {view === 'settings' && renderSettings()}
    </div>
  );
}

export default App;
