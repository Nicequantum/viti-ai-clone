import React, { useState, useEffect } from 'react';
import { Camera, Settings, ArrowLeft, Plus, Copy, RefreshCw, Trash2, Edit2 } from 'lucide-react';
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
    make: string;
    model: string;
    mileageIn: string;
    mileageOut: string;
  };
  customer: {
    name: string;
  };
  complaints: string[];
  // RO-level Xentry saved data / Quick Test images (scanned on second page after RO)
  xentryImages?: Array<{ id: string; dataUrl: string; name: string }>;
  xentryOcrTexts?: string[];
  repairLines: RepairLine[];
  createdAt?: string;
}

// SUPER AGGRESSIVE pre-processing for Tesseract OCR on Mercedes RO forms.
// Grayscale, extreme contrast, noise reduction, deskew, sharpen, Otsu binarization.
// This is the core of making local OCR production-grade and robust against real shop conditions.
async function preprocessImageForOCR(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        const MAX_DIM = 2200; // higher res for better text
        if (Math.max(w, h) > MAX_DIM) {
          const scale = MAX_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        canvas.width = w;
        canvas.height = h;
        let ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);

        let imageData = ctx.getImageData(0, 0, w, h);
        let data = imageData.data;

        // 1. Grayscale
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          data[i] = data[i + 1] = data[i + 2] = gray;
        }

        // 2. Extreme contrast boost + stretch (aggressive for faded print)
        let minV = 255, maxV = 0;
        for (let i = 0; i < data.length; i += 4) {
          minV = Math.min(minV, data[i]);
          maxV = Math.max(maxV, data[i]);
        }
        const range = Math.max(1, maxV - minV);
        for (let i = 0; i < data.length; i += 4) {
          let v = Math.round(((data[i] - minV) / range) * 255);
          // sharp contrast curve
          v = Math.min(255, Math.max(0, Math.round((v - 128) * 2.2 + 128)));
          data[i] = data[i + 1] = data[i + 2] = v;
        }

        // 3. Noise reduction - 3x3 box blur (mean filter)
        const tempData = new Uint8ClampedArray(data);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const idx = ((y + dy) * w + (x + dx)) * 4;
                sum += tempData[idx];
                cnt++;
              }
            }
            const avg = Math.round(sum / cnt);
            const idx = (y * w + x) * 4;
            data[idx] = data[idx + 1] = data[idx + 2] = avg;
          }
        }

        // 4. Sharpen (unsharp mask)
        const sharpData = new Uint8ClampedArray(data);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            const c = data[idx];
            let neigh = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
              neigh += data[((y + dy) * w + (x + dx)) * 4];
            }
            const sharpened = Math.min(255, Math.max(0, Math.round(c + (c - Math.round(neigh / 8)) * 1.8)));
            sharpData[idx] = sharpData[idx + 1] = sharpData[idx + 2] = sharpened;
          }
        }
        data.set(sharpData);

        // 5. Otsu binarization (optimal threshold for text)
        let hist = new Array(256).fill(0);
        for (let i = 0; i < data.length; i += 4) hist[data[i]]++;
        let totalPix = w * h;
        let sum = 0;
        for (let t = 0; t < 256; t++) sum += t * hist[t];
        let sumB = 0, wB = 0, varMax = 0, threshold = 140;
        for (let t = 0; t < 256; t++) {
          wB += hist[t];
          if (wB === 0) continue;
          const wF = totalPix - wB;
          if (wF === 0) break;
          sumB += t * hist[t];
          const mB = sumB / wB;
          const mF = (sum - sumB) / wF;
          const variance = wB * wF * (mB - mF) * (mB - mF);
          if (variance > varMax) {
            varMax = variance;
            threshold = t;
          }
        }
        for (let i = 0; i < data.length; i += 4) {
          const v = data[i] > threshold ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = v;
        }

        // 6. Deskew - aggressive search for best horizontal alignment (max row variance)
        function computeRowVariance(idata: ImageData, ww: number, hh: number): number {
          const rowSums = new Array(hh).fill(0);
          for (let y = 0; y < hh; y++) {
            for (let x = 0; x < ww; x++) {
              if (idata.data[(y * ww + x) * 4] === 0) rowSums[y]++; // count black pixels
            }
          }
          const mean = rowSums.reduce((a, b) => a + b, 0) / hh;
          return rowSums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / hh;
        }

        let bestAngle = 0;
        let bestScore = -Infinity;
        const testAngles: number[] = [];
        for (let a = -6; a <= 6; a += 0.25) testAngles.push(a);
        for (const angle of testAngles) {
          const rad = (angle * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const nw = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
          const nh = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
          const tCan = document.createElement('canvas');
          tCan.width = nw;
          tCan.height = nh;
          const tctx = tCan.getContext('2d', { willReadFrequently: true })!;
          tctx.translate(nw / 2, nh / 2);
          tctx.rotate(rad);
          tctx.drawImage(canvas, -w / 2, -h / 2, w, h);
          const tData = tctx.getImageData(0, 0, nw, nh);
          const score = computeRowVariance(tData, nw, nh);
          if (score > bestScore) {
            bestScore = score;
            bestAngle = angle;
          }
        }

        if (Math.abs(bestAngle) > 0.1) {
          const rad = (bestAngle * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const nw = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
          const nh = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
          const rotCan = document.createElement('canvas');
          rotCan.width = nw;
          rotCan.height = nh;
          const rctx = rotCan.getContext('2d')!;
          rctx.translate(nw / 2, nh / 2);
          rctx.rotate(rad);
          rctx.drawImage(canvas, -w / 2, -h / 2, w, h);
          canvas = rotCan;
          ctx = rctx;
          imageData = ctx.getImageData(0, 0, nw, nh);
          data = imageData.data;
          w = nw;
          h = nh;
          // re-apply light binarize after rotate
          for (let i = 0; i < data.length; i += 4) {
            const v = data[i] > threshold ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => {
          resolve(blob || file);
        }, 'image/png', 0.95);
      } catch (e) {
        console.warn('Aggressive preprocess failed, using original', e);
        resolve(file);
      }
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

// Helper to run Tesseract with AGGRESSIVE settings for Mercedes RO forms.
// Multiple PSM attempts internally for robustness, best for tables + labeled complaints.
async function runOCR(imageSource: Blob | File, onProgress?: (p: number) => void): Promise<string> {
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    }
  });
  // Aggressive config: try best PSM for forms (PSM 4/6/11 good for mixed layout + labels)
  // OEM 3 for best accuracy. Whitelist helps with VIN/mileage/RO numbers.
  const { data: { text } } = await worker.recognize(imageSource as any, { 
    tessedit_pageseg_mode: '6' as any,
    tessedit_oem: '3' as any,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;/-_()[]#%&*+=@\'" \n',
  });
  await worker.terminate();
  return text;
}

// === Encrypted xAI Grok API key handling (client-side AES-GCM + PBKDF2) ===
// Never stores plain key in localStorage. Requires user passphrase to unlock per session.
// "Selection" supported via multiple named slots in future; current: primary encrypted key.

const ENC_KEY_STORAGE = 'benztech_grok_key_enc_v1';
const PLAIN_KEY_STORAGE = 'maybachtech_grok_key'; // legacy migration only (pre-encryption)

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plain: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const payload = {
    v: 1,
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct)))
  };
  return JSON.stringify(payload);
}

async function decryptApiKey(payloadJson: string, passphrase: string): Promise<string> {
  const p = JSON.parse(payloadJson);
  const salt = Uint8Array.from(atob(p.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(p.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(p.ct), c => c.charCodeAt(0));
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(dec);
}

async function loadEncryptedKey(passphrase?: string): Promise<string> {
  try {
    const enc = localStorage.getItem(ENC_KEY_STORAGE);
    if (enc && passphrase) {
      return await decryptApiKey(enc, passphrase);
    }
    // legacy plain (one-time migrate on save)
    const plain = localStorage.getItem(PLAIN_KEY_STORAGE);
    if (plain && !enc) return plain;
    return '';
  } catch (e) {
    console.warn('Key decrypt failed (bad passphrase?)', e);
    return '';
  }
}

async function saveEncryptedKey(plain: string, passphrase: string) {
  if (!plain) {
    localStorage.removeItem(ENC_KEY_STORAGE);
    localStorage.removeItem(PLAIN_KEY_STORAGE);
    return;
  }
  const enc = await encryptApiKey(plain, passphrase);
  localStorage.setItem(ENC_KEY_STORAGE, enc);
  localStorage.removeItem(PLAIN_KEY_STORAGE); // clean legacy
}

// Full system prompt - Mercedes-Benz (incl. Maybach) master technician warranty story requirements
const SYSTEM_PROMPT = `Act as a senior Mercedes-Maybach master technician with 18 years experience writing warranty stories that always pass review.
Strict rules you must follow:

Always mention that a battery charger was connected during the entire repair.
Always state that an initial Quick Test was performed using XENTRY.
Include a test drive with mileage in and mileage out (use realistic numbers like 12 miles in, 15 miles out).
Clearly show the 3 C’s: Customer Complaint/Concern, Cause, and Correction. Use the actual customer complaints labeled A/B/C from the RO and tie the work to them.
Always perform and document a final Quick Test after repairs.
End with a final verification drive to confirm the repair.
Reference standard test values and common issues for the model/mileage when they align with data (e.g. "fuel rail pressure held at 220-245 bar per spec"). Incorporate any provided smart defaults / extracted measurements naturally.

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

// Smart Mercedes-Benz knowledge: common issues + standard test values by model family + mileage bands.
// Used client-side to suggest + prefill when vehicle/mileage known and after diagnostic photo uploads.
const MERCEDES_KB: Record<string, {
  families: string[];
  mileageBands: Array<{
    min: number; max: number;
    commonIssues: string[];
    standardTests: Array<{ label: string; spec: string; note?: string }>;
  }>;
}> = {
  'GLE': {
    families: ['GLE', 'GLS', 'GLC'],
    mileageBands: [
      { min: 0, max: 30000, commonIssues: ['Software updates / SCN coding', 'Battery / IBS issues', 'Sensor faults (TPMS, radar)'], standardTests: [
        { label: 'Battery voltage (resting)', spec: '12.6-12.8 V', note: 'Charger connected during diag' },
        { label: 'Fuel rail pressure idle (M256/M177)', spec: '200-280 bar' },
      ]},
      { min: 30001, max: 75000, commonIssues: ['High pressure fuel injectors (lean codes P0171/P0174)', 'Turbo actuator / boost leaks', 'ABC or Airmatic suspension leaks', 'Crankshaft position sensor'], standardTests: [
        { label: 'Fuel rail pressure idle', spec: '200-250 bar' },
        { label: 'Leak-off rate (injectors)', spec: '< 2 ml / 30s per cyl per XENTRY' },
        { label: 'Rail pressure under load', spec: 'up to 2000+ bar stable' },
        { label: 'Injector adaptation ZGSTH', spec: 'typically ±1.0% max recommended' },
      ]},
      { min: 75001, max: 150000, commonIssues: ['Injector failure / carbon', 'Timing chain stretch (some M276)', 'Transmission conductor plate / valve body', 'EGR cooler / AdBlue'], standardTests: [
        { label: 'Compression test', spec: 'per XENTRY spec ~12-15 bar' },
        { label: 'Chain stretch measurement', spec: 'see XENTRY guided' },
      ]}
    ]
  },
  'S': {
    families: ['S', 'Maybach'],
    mileageBands: [
      { min: 0, max: 40000, commonIssues: ['Active Body Control (ABC) leaks', 'Distronic radar alignment', 'Magic Body Control sensor'], standardTests: [{ label: 'ABC pressure', spec: '~180-200 bar system' }] },
      { min: 40001, max: 90000, commonIssues: ['Injectors / fuel trim issues on M256', 'Air suspension compressor', 'Wiring harness chafing (doors, trunk)'], standardTests: [
        { label: 'Fuel pressure', spec: '200-250 bar idle' },
        { label: 'Battery + IBS', spec: '>12.4V resting, check quiescent current <50mA' },
      ]}
    ]
  },
  'E': {
    families: ['E', 'CLS'],
    mileageBands: [
      { min: 25000, max: 80000, commonIssues: ['M264/M256 injector / HPFP issues', 'Balance shaft / chain', 'Electrical consumers drain'], standardTests: [
        { label: 'HP fuel pressure', spec: '200-280 bar' },
        { label: 'Lambda / fuel trims', spec: 'fra/fra2 near 1.0 ±0.03' },
      ]}
    ]
  },
  'C': {
    families: ['C', 'CLA', 'GLA'],
    mileageBands: [
      { min: 20000, max: 70000, commonIssues: ['M264 timing chain / balance', 'Turbo wastegate rattle', '7G/9G conductor plate'], standardTests: [{ label: 'Oil pressure', spec: 'per spec ~2.5-4.5 bar hot' }] }
    ]
  },
  default: {
    families: [],
    mileageBands: [
      { min: 0, max: 999999, commonIssues: ['Battery/charging system', 'Sensor faults', 'Software adaptations drift'], standardTests: [
        { label: 'Battery resting voltage', spec: '12.6 V+' },
        { label: 'Guided test values', spec: 'follow XENTRY exactly' },
      ]}
    ]
  }
};

function getSuggestions(ro: RepairOrder): { issues: string[]; tests: Array<{label: string; spec: string; note?: string}>; bandNote: string } {
  const model = (ro.vehicle.model || '').toUpperCase();
  const miles = parseInt(ro.vehicle.mileageIn || '0', 10) || 0;
  let kb = MERCEDES_KB.default;
  let famKey = 'default';
  for (const [key, val] of Object.entries(MERCEDES_KB)) {
    if (key === 'default') continue;
    if (val.families.some(f => model.includes(f)) || model.includes(key)) {
      kb = val;
      famKey = key;
      break;
    }
  }
  // pick best band
  let band = kb.mileageBands[kb.mileageBands.length-1];
  for (const b of kb.mileageBands) {
    if (miles >= b.min && miles <= b.max) { band = b; break; }
  }
  const bandNote = `${famKey} • ${miles ? miles + ' mi' : 'mileage unknown'} band`;
  return { issues: band.commonIssues, tests: band.standardTests, bandNote };
}

// Enhance parseDiagnosticText to also capture some standard value hints
function parseDiagnosticText(text: string): Partial<ExtractedData> {
  const upper = text.toUpperCase();
  const codes = Array.from(upper.matchAll(/\b([PBCU]\d{4}(?:[-–]\d{3})?)\b/g)).map(m => m[1]);
  const guidedTests = Array.from(text.matchAll(/Guided Test[:\s-]*(.+?)(?=\n|Test|$)/gi)).map(m => m[1].trim()).filter(t => t.length > 3);
  const measurements = Array.from(text.matchAll(/([A-Za-z0-9\s\/]+?)\s*[:=]\s*([\d.]+\s*(?:V|VOLTS|PSI|BAR|OHM|kOHM|mA|°C|°F|bar|kpa)?)/gi))
    .map(m => ({ label: m[1].trim(), value: m[2].trim() })).slice(0, 8);
  const components = Array.from(upper.matchAll(/\b([A-Z]\d{1,2}\/\d{1,2}[A-Z]?(?:Y\d)?)\b/g)).map(m => m[1]);
  const circuits = Array.from(text.matchAll(/pin\s*(\d+\.?\d*)|circuit\s*(\d+[A-Z]?)/gi)).map(m => m[0].trim());
  return { codes, guidedTests, measurements, components, circuits };
}

// Grok API call
async function generateWarrantyStoryWithGrok(
  ro: RepairOrder,
  line: RepairLine,
  apiKey: string,
  historyContext: string = ''
): Promise<string> {
  const vehicleInfo = `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model} | VIN: ${ro.vehicle.vin} | Miles: ${ro.vehicle.mileageIn} → ${ro.vehicle.mileageOut}`.replace(/\s+/g, ' ').trim();

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
    ? '\nRaw OCR from Xentry photos (per line):\n' + line.xentryOcrTexts.join('\n---\n')
    : '';

  // RO-level Xentry saved data (scanned on the RO review / second page) - critical for initial QT / saved data
  const roRawXentryOcr = (ro.xentryOcrTexts && ro.xentryOcrTexts.length > 0)
    ? '\nRO-level Xentry Saved Data / Quick Test OCR (from RO page scan):\n' + ro.xentryOcrTexts.join('\n---\n')
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
${roRawXentryOcr}
${historyContext}

MANDATORY REQUIREMENTS - Your story MUST explicitly include all of these (use the example in system prompt as gold standard for depth):
- A battery charger was connected during the entire repair.
- An initial Quick Test was performed using XENTRY.
- Include a test drive with realistic mileage in (e.g. 12 miles) and mileage out (e.g. 15 miles).
- Clearly show the 3 C’s: Customer Complaint/Concern, Cause, and Correction. Reference the specific labeled complaints (A, B, C...) from the RO.
- Always perform and document a final Quick Test after repairs.
- End with a final verification drive to confirm the repair.
Incorporate standard values (pressures, adaptations, leak rates etc) and common model/mileage issues from the provided context when they match the data. Sound like a real tech. Avoid hedging language.

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
  const [apiKey, setApiKey] = useState(''); // in-memory only (decrypted)
  const [passphrase, setPassphrase] = useState(''); // temp for encrypt/unlock ops
  const [hasEncryptedKey, setHasEncryptedKey] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [allROs, setAllROs] = useState<RepairOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingROImages, setPendingROImages] = useState<Array<{id: string; dataUrl: string; name: string}>>([]);

  // IndexedDB helpers for persistent multi-RO storage
  const DB_NAME = 'maybachtech_db';
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

  // Load all ROs and detect encrypted key status on mount. Key stays encrypted until user unlocks with passphrase.
  useEffect(() => {
    (async () => {
      let saved = await loadAllROs();
      saved = saved.map((ro: any) => {
        if (ro.vehicle && ro.vehicle.make === undefined) {
          ro.vehicle.make = '';
        }
        return ro;
      });
      setAllROs(saved);

      const enc = localStorage.getItem(ENC_KEY_STORAGE);
      setHasEncryptedKey(!!enc);

      // Legacy plain migration (will be re-saved encrypted on next Settings save)
      const legacy = localStorage.getItem(PLAIN_KEY_STORAGE);
      if (legacy && !enc) {
        setApiKey(legacy);
        setIsUnlocked(true);
      }
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

  const saveApiKey = async (key: string, pass: string) => {
    setApiKey(key);
    if (pass && key) {
      await saveEncryptedKey(key, pass);
      setHasEncryptedKey(true);
      setIsUnlocked(true);
      setPassphrase(''); // clear after use
      alert('Key encrypted and saved locally. Remember your passphrase to unlock on future sessions.');
    } else if (key) {
      // no pass provided: warn but allow plain for this session only (not recommended)
      localStorage.setItem(PLAIN_KEY_STORAGE, key);
      localStorage.removeItem(ENC_KEY_STORAGE);
      setHasEncryptedKey(false);
      alert('Saved without encryption (legacy). Enter passphrase next time to encrypt.');
    } else {
      await saveEncryptedKey('', '');
      setHasEncryptedKey(false);
      setIsUnlocked(false);
    }
  };

  const unlockWithPassphrase = async (pass: string) => {
    const k = await loadEncryptedKey(pass);
    if (k) {
      setApiKey(k);
      setIsUnlocked(true);
      setPassphrase('');
      return true;
    } else {
      alert('Unlock failed. Check passphrase.');
      return false;
    }
  };

  const clearAllKeys = () => {
    localStorage.removeItem(ENC_KEY_STORAGE);
    localStorage.removeItem(PLAIN_KEY_STORAGE);
    setApiKey('');
    setHasEncryptedKey(false);
    setIsUnlocked(false);
    setPassphrase('');
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

  // === MULTI-PAGE RO SCAN (new flow) ===
  // User can click "Add RO Photo" multiple times (2-3 pages recommended) to capture/ select photos of different pages.
  // Thumbnails appear. Then "Process All Images" runs OCR (Grok vision preferred for accuracy on first block + all complaints).
  // Keeps old local Tesseract path for no-key fallback (concatenates text from all images).
  // Does NOT touch other working code.

  const addROPhoto = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.multiple = true; // allow batch select from gallery if user has pages ready; camera can be used repeatedly

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length === 0) return;

      const newImgs: Array<{id: string; dataUrl: string; name: string}> = [];
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        newImgs.push({
          id: 'roimg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          dataUrl,
          name: file.name || `page-${newImgs.length + 1}.jpg`
        });
      }
      setPendingROImages(prev => [...prev, ...newImgs]);
    };
    input.click();
  };

  const processPendingROImages = async () => {
    if (pendingROImages.length === 0) return;

    setIsProcessingOCR(true);
    setOcrProgress(0);

    try {
      const dataUrls = pendingROImages.map(img => img.dataUrl);

      if (apiKey) {
        // Preferred: send all pages as multiple images to Grok with improved prompt (first block + RO# + complaints from any)
        setOcrProgress(20);
        const extracted = await extractVehicleAndComplaintsWithGrok(dataUrls, apiKey);
        setOcrProgress(90);
        createROFromExtracted(extracted);
      } else {
        // Local fallback: OCR each page, combine texts, use existing createROFromText (which handles RO# + complaints)
        let combinedText = '';
        for (let i = 0; i < pendingROImages.length; i++) {
          const img = pendingROImages[i];
          const file = await dataUrlToFile(img.dataUrl, img.name);
          const preprocessed = await preprocessImageForOCR(file);
          const text = await runOCR(preprocessed, (p) =>
            setOcrProgress(Math.round((i / pendingROImages.length) * 80 + (p / pendingROImages.length) * 80 * 0.2))
          );
          combinedText += `\n\n=== PAGE ${i + 1} ===\n` + text;
        }
        setOcrProgress(95);
        createROFromText(combinedText);
      }

      // Clear pending after successful process
      setPendingROImages([]);
    } catch (error) {
      console.error('Multi-image RO extraction error', error);
      alert('Processing images failed. Try fewer images or add your Grok key in Settings for reliable vision OCR.');
      // do not clear pending so user can retry
    } finally {
      setIsProcessingOCR(false);
      setOcrProgress(0);
    }
  };

  // Clear helper for UI
  const clearPendingROImages = () => setPendingROImages([]);

  // SUPER AGGRESSIVE customer complaint extraction for Mercedes ROs.
  // Bulletproof: uses many trigger phrases (customer states, tech notes, found, etc.), block collection, labeled + free text extraction.
  // Works across multi-page combined text. Ignores page markers.
  function extractComplaints(text: string): string[] {
    if (!text || text.trim().length < 6) return [];
    const comps: string[] = [];
    // clean page markers from multi-photo
    let cleaned = text.replace(/=== PAGE \d+ ===/g, '\n\n').replace(/\s+/g, ' ');
    const lines = cleaned.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

    const TRIGGERS = [
      'customer states', 'customer complaint', 'customer concern', 'customer reported', 'customer states that',
      'technician notes', 'tech notes', 'technician found', 'technician observed', 'technician seen', 'tech found', 'tech observed',
      'concern', 'complaint', 'issue', 'problem', 'needs', 'requires', 'state inspection', 'found', 'observed', 'reported',
      'requires repair', 'inspection result', 'technician notes', 'tech seen', 'customer states', 'c/s', 'c s'
    ];

    const isJunk = (s: string) => /^(vin|mile|km|ro\s*#|date|tech|name|model|customer|service|advisor|authorized|total|tax|parts|shop|dealer|labor|signature)/i.test(s);

    let collecting = false;
    let currentBlock = '';

    const flushBlock = () => {
      if (currentBlock.length < 8) return;
      // parse labeled A. B. etc first
      const labeledMatches = currentBlock.match(/([A-D])[\.\)\:\s\-–—–—]+\s*([A-Za-z][^\.]{6,220})/gi) || [];
      if (labeledMatches.length > 0) {
        labeledMatches.forEach(m => {
          let c = m.replace(/^[A-D][\.\)\:\s\-–—–—]+/i, '').trim();
          c = c.replace(/[\s\-–—–—]+$/, '');
          if (c.length > 6 && !isJunk(c) && !comps.includes(c)) comps.push(c);
        });
      } else {
        // free text after trigger - split on . or lines
        const parts = currentBlock.split(/[\.\!\?]\s+|\n|;/).map(p => p.trim()).filter(p => p.length > 6);
        parts.forEach(p => {
          if (!isJunk(p) && /[a-zA-Z]/.test(p) && p.length > 6 && !comps.includes(p)) {
            comps.push(p);
          }
        });
      }
      currentBlock = '';
    };

    for (const line of lines) {
      const lower = line.toLowerCase();
      const hitTrigger = TRIGGERS.some(t => lower.includes(t));
      if (hitTrigger) {
        flushBlock();
        collecting = true;
        currentBlock = line + '. ';
        continue;
      }
      if (collecting) {
        // stop at obvious new section
        if (/vin|ro\s*#|mileage|odometer|parts|labor|total|authorized|signature|print name|phone/i.test(lower) && !lower.match(/complaint|concern|issue|problem/)) {
          flushBlock();
          collecting = false;
          continue;
        }
        currentBlock += line + ' ';
      }
      // also catch stray labeled even outside
      const strayLabel = line.match(/^([A-D])[\.\)\:\s\-–—–—]+\s*(.+)$/i);
      if (strayLabel && strayLabel[2] && strayLabel[2].length > 6 && !isJunk(strayLabel[2])) {
        const c = strayLabel[2].trim();
        if (!comps.includes(c)) comps.push(c);
      }
    }
    flushBlock();

    // Ultra aggressive global labeled + trigger phrases fallback (for mangled OCR)
    if (comps.length < 2) {
      const globalPatterns = [
        /([A-D])[\.\)\:\s\-–—–—]+\s*([A-Za-z][^\n]{7,220})/gi,
        /(?:customer\s*states?|customer\s*complaint|technician\s*notes?|tech\s*notes?|technician\s*found|concern|complaint|issue|problem|needs|requires|found|observed)\s*[:\-]?\s*([A-Za-z][^\n]{7,220})/gi,
        /([A-D])\s*[\.\)]\s*([A-Za-z][^\n]{7,220})/gi
      ];
      globalPatterns.forEach(p => {
        let m;
        while ((m = p.exec(cleaned)) !== null) {
          const cand = (m[2] || m[1] || '').trim().replace(/[\s\-–—–—]+$/, '');
          if (cand.length > 6 && !isJunk(cand) && !comps.includes(cand) && /[a-z]/.test(cand)) {
            comps.push(cand);
          }
        }
      });
    }

    // Dedupe, clean, limit
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of comps) {
      const key = c.toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
      if (!seen.has(key) && c.length > 5 && c.length < 280) {
        seen.add(key);
        unique.push(c.replace(/\s+/g, ' ').trim());
      }
    }
    return unique.slice(0, 10);
  }

  function extractVehicleDetails(text: string) {
    // Clean common OCR confusions early (VINs especially) - strict for first block
    let cleaned = text
      .replace(/\bO\b/g, '0').replace(/\bI\b/g, '1').replace(/\bL\b/g, '1')
      .replace(/[\u2018\u2019]/g, "'");

    // RO Number - top center / header (first 400 chars priority for "first block")
    let roNumber = '';
    const topBlock = cleaned.substring(0, 500);
    const roMatch = topBlock.match(/(?:^|\n)\s*(?:RO\s*#?|Repair\s*Order|Work\s*Order|RO#)\s*[:#]?\s*([A-Z0-9\-]{3,12})/i) ||
                    topBlock.match(/(?:RO|Repair Order|Work Order)\s*[:#]?\s*([A-Z0-9\-]{3,12})/i);
    if (roMatch) roNumber = roMatch[1];

    const vinMatch = cleaned.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    let vin = vinMatch ? vinMatch[1] : '';
    if (vin) {
      vin = vin.toUpperCase()
        .replace(/O/g, '0').replace(/I/g, '1').replace(/Q/g, '0').replace(/B/g, '8');
      if (!vin.match(/^[A-HJ-NPR-Z0-9]{17}$/)) vin = '';
    }

    // Year/Make/Model - prioritize first block / table area (top ~600 chars)
    const headerText = cleaned.substring(0, 600);
    let year = '';
    const myMatch = headerText.match(/\bM\.?Y\.?\s*(20\d{2}|19\d{2})\b/i) || headerText.match(/\bModel\s*Year\s*(20\d{2}|19\d{2})\b/i) || headerText.match(/\b(20\d{2}|19\d{2})\s*MY\b/i);
    if (myMatch) year = myMatch[1];
    if (!year) {
      const yearBefore = headerText.match(/\b(20\d{2}|19\d{2})\s+(?:Mercedes|Maybach|MB|GLE|GLS|GLC|GLA|S\s|E\s|C\s|EQ|AMG|GT|SL|CLS|CLA)\b/i);
      if (yearBefore) year = yearBefore[1];
    }
    if (!year) {
      const yearAny = headerText.match(/\b(20\d{2}|19\d{2})\b/);
      if (yearAny) year = yearAny[1];
    }

    let make = 'Mercedes-Benz';
    if (/Maybach/i.test(headerText)) make = 'Maybach';
    else if (/Mercedes[- ]?Benz/i.test(headerText) || /\bMercedes\b/i.test(headerText)) make = 'Mercedes-Benz';
    else if (/\bMB\b/i.test(headerText) || /\bMERCEDES\b/i.test(headerText)) make = 'Mercedes-Benz';
    else if (vin.startsWith('W1') || vin.startsWith('WDD') || vin.startsWith('WDC') || vin.startsWith('WDF') || vin.startsWith('W1N') || vin.startsWith('W1K')) {
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
      /\b(?:Sprinter|Vito|Metris)\b/i
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

    // Mileage IN - specific "MILEAGE IN / OUT" column or labels, first occurrence
    let mileageIn = '';
    const labeled = headerText.match(/(?:MILEAGE\s*IN|MILEAGE IN|mileage\s*in|odometer|current\s*(?:mile|km)|miles\s*in)\s*:?\s*([\d,]{3,7})/i);
    if (labeled) {
      mileageIn = labeled[1].replace(/,/g, '');
    } else {
      const any = cleaned.match(/([\d,]{4,7})\s*(?:mi|mile|miles|km)\b/i);
      if (any) mileageIn = any[1].replace(/,/g, '');
    }

    return { vin, year, make, model, mileageIn, mileageOut: '' };
  }

  // Extract customer name if present on RO scan - top left / customer section bias (first block)
  function extractCustomerName(text: string): string {
    const top = text.substring(0, 400);
    const patterns = [
      /customer\s*(?:name|:)?:?\s*([A-Z][A-Za-z'\-\s]{2,40})/i,
      /(?:name|owner)\s*:?\s*([A-Z][A-Za-z'\-\s]{2,40})/i,
      /^([A-Z][A-Za-z'\-\s]{2,30})\s*(?:RO|Repair|Vehicle|VIN)/im
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

  // Parser for Grok vision output - robust fallback regex for layout fields + super aggressive complaints.
  // Post-validation included.
  function parseStructuredROText(text: string): { vehicle: any; complaints: string[]; customerName: string; roNumber: string } {
    const vehicle: any = { vin: '', year: '', make: '', model: '', mileageIn: '', mileageOut: '' };
    let complaints: string[] = [];
    let customerName = '';
    let roNumber = '';

    // Primary: try exact structured lines
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let inComplaints = false;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('ro number:')) {
        roNumber = (line.split(':')[1] || '').trim();
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
          complaints = [];
          inComplaints = false;
          continue;
        }
        let m = line.match(/^([A-Z])[\.\)\:\s\-–—–—]+\s*(.+)$/i);
        if (!m) m = line.match(/^(\d{1,2})[\.\)\:\s\-–—–—]+\s*(.+)$/i);
        if (m && m[2]) {
          const c = m[2].trim();
          if (c.length > 4) complaints.push(c);
        } else if (line.length > 6 && !/^[A-Z]:/i.test(line)) {
          complaints.push(line);
        }
      }
    }

    // Aggressive fallback for fields if Grok didn't follow format perfectly (layout aware)
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

    // Use the super aggressive complaints extractor as final (guarantees A/B/C from triggers even if format off)
    const aggressive = extractComplaints(text);
    if (aggressive.length > complaints.length) {
      complaints = aggressive;
    }

    // Post-processing validation
    if (vehicle.vin && vehicle.vin.length !== 17) {
      vehicle.vin = vehicle.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
    }
    vehicle.mileageIn = (vehicle.mileageIn || '').replace(/[^0-9]/g, '');
    complaints = complaints.filter((c: string) => c && c.trim().length > 5 && /[a-zA-Z]/.test(c));

    return { vehicle, complaints, customerName, roNumber };
  }

  // SUPER AGGRESSIVE prompt for Grok vision OCR - layout specific + bulletproof complaints from triggers across pages.
  const RO_EXTRACTION_PROMPT = `Use OCR to carefully analyze the provided repair order image(s). Extract ACCURATELY and ONLY from the FIRST BLOCK (top header / primary vehicle info section — ignore labor, parts, totals, signatures, lower notes).

STRICT FIELD LOCATIONS FOR THIS MERCEDES-BENZ RO FORMAT:
- RO Number: top center of page (near "RO #", "Repair Order", "Work Order")
- Customer Name: top left customer section
- Year / Make / Model: specific vehicle information table row
- VIN: the VIN field (must be exactly 17 characters)
- Mileage IN: the "MILEAGE IN / OUT" or mileage column (numbers only)

Customer Complaints (MOST IMPORTANT - SUPER AGGRESSIVE):
Search the ENTIRE document (all pages/images) for ANY text after or under these EXACT trigger phrases (case insensitive):
"Customer states", "Customer complaint", "Customer concern", "customer states that",
"Technician notes", "Tech notes", "Technician found", "Technician observed", "Technician seen", "tech found", "tech observed", "technician notes",
"Concern", "Complaint", "Issue", "Problem", "Needs", "Requires", "state inspection", "found", "observed", "reported", "requires repair", "inspection result", "c/s", "c s".
Extract the full following text as complaints. Label them A, B, C, D etc (use form labels if present, or assign sequentially). Pull EVERY complaint from any page. If none, output exactly "None listed."

Output ONLY this exact format, nothing else:

RO Number: [precise value from top center]
Customer Name: [value]
Year: [value]
Make: [value]
Model: [value]
VIN: [exact 17 char]
Mileage IN: [numbers only]
Customer Complaints:
A. [exact text]
B. [exact text]
...

Be extremely precise on VIN (17 alphanum, fix O/0 I/1), mileage numbers, RO number. Use the trigger phrases above aggressively for complaints.`;

  // Use Grok vision (image understanding) + exact prompt for reliable first-block extraction (RO#, vehicle fields, complaints from any page).
  // Supports multiple images (for multi-page RO). Falls back to local Tesseract if no key or error.
  async function extractVehicleAndComplaintsWithGrok(imageDataUrls: string[], apiKey: string): Promise<{ vehicle: any; complaints: string[]; customerName: string; roNumber: string }> {
    const prompt = RO_EXTRACTION_PROMPT;

    const imageContents = imageDataUrls.map(url => ({ type: 'image_url', image_url: { url } }));

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3', // Vision-capable via chat completions per xAI API (multiple image_url supported)
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageContents
            ]
          }
        ],
        temperature: 0.05,
        max_tokens: 700
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok vision extraction error: ${response.status} ${err}`);
    }

    const apiResponse = await response.json();
    const extractedText = apiResponse.choices?.[0]?.message?.content?.trim() || '';
    return parseStructuredROText(extractedText);
  }

  const createROFromText = (text: string) => {
    // Layout aware: RO# from top center/header area first
    let roNumber = (text.match(/(?:^|\n)\s*(?:RO\s*#?|Repair\s*Order|Work\s*Order|RO#)\s*[:#]?\s*([A-Z0-9\-]{3,12})/im) || [])[1] ||
                   (text.match(/(?:RO|Repair Order|Work Order)\s*[:#]?\s*([A-Z0-9\-]{3,12})/i) || [])[1] ||
                   `R-${Date.now().toString().slice(-6)}`;
    const vehicle = extractVehicleDetails(text);
    const complaints = extractComplaints(text);
    const custName = extractCustomerName(text);

    // Post-processing validation (VIN 17 char, mileage numeric, meaningful complaints)
    if (vehicle.vin && vehicle.vin.length !== 17) {
      vehicle.vin = vehicle.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
    }
    vehicle.mileageIn = (vehicle.mileageIn || '').replace(/[^0-9]/g, '');
    const cleanComplaints = complaints.filter(c => c && c.trim().length > 5 && /[a-zA-Z]/.test(c));

    const newRO: RepairOrder = {
      id: 'ro-' + Date.now(),
      roNumber,
      vehicle,
      customer: { name: custName },
      complaints: cleanComplaints,
      xentryImages: [],
      xentryOcrTexts: [],
      createdAt: new Date().toISOString(),
      repairLines: [{
        id: 'line-1',
        lineNumber: 1,
        description: cleanComplaints[0] ? cleanComplaints[0].slice(0, 60) : 'Enter repair description',
        customerConcern: cleanComplaints[0] || '',
        technicianNotes: '',
        xentryImages: [],
        xentryOcrTexts: [],
        extractedData: { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] }
      }]
    };

    saveRO(newRO);
    setView('ro');
  };

  // Helper to create RO from the structured vision extraction (matches the exact prompt output format)
  const createROFromExtracted = (extracted: { vehicle: any; complaints: string[]; customerName: string; roNumber?: string }) => {
    let roNumber = extracted.roNumber || `R-${Date.now().toString().slice(-6)}`;
    // Post-processing validation
    let v = { ...extracted.vehicle };
    if (v.vin && v.vin.length !== 17) {
      v.vin = v.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
    }
    v.mileageIn = (v.mileageIn || '').replace(/[^0-9]/g, '');
    const cleanComplaints = (extracted.complaints || []).filter((c: string) => c && c.trim().length > 5 && /[a-zA-Z]/.test(c));

    const newRO: RepairOrder = {
      id: 'ro-' + Date.now(),
      roNumber,
      vehicle: v,
      customer: { name: extracted.customerName },
      complaints: cleanComplaints,
      xentryImages: [],
      xentryOcrTexts: [],
      createdAt: new Date().toISOString(),
      repairLines: [{
        id: 'line-1',
        lineNumber: 1,
        description: cleanComplaints[0] ? cleanComplaints[0].slice(0, 60) : 'Enter repair description',
        customerConcern: cleanComplaints[0] || '',
        technicianNotes: '',
        xentryImages: [],
        xentryOcrTexts: [],
        extractedData: { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] }
      }]
    };

    saveRO(newRO);
    setView('ro');
  };

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

  // Helper for local OCR fallback with multiple images (convert dataUrl back to File for existing preprocess/runOCR)
  async function dataUrlToFile(dataUrl: string, filename: string = 'ro-page.jpg'): Promise<File> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  }

  const createManualRO = () => {
    const newRO: RepairOrder = {
      id: 'ro-' + Date.now(),
      roNumber: `R-${Date.now().toString().slice(-6)}`,
      vehicle: { vin: '', year: '', make: '', model: '', mileageIn: '', mileageOut: '' },
      customer: { name: '' },
      complaints: ['Enter customer concern / symptom here (will label as A.)'],
      xentryImages: [],
      xentryOcrTexts: [],
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
          const pre = await preprocessImageForOCR(file);
          const text = await runOCR(pre, (p) => setOcrProgress(Math.round(((i + p) / files.length) * 100)));
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
      // Auto-seed smart defaults for this vehicle if tech notes still empty (helps new lines)
      const updatedLineCheck = updatedLines.find(l => l.id === lineId);
      if (updatedLineCheck && (!updatedLineCheck.technicianNotes || updatedLineCheck.technicianNotes.trim().length < 5)) {
        // fire and forget, will use latest in closure via re-find inside
        setTimeout(() => applySmartDefaultsToLine(lineId), 60);
      }
      alert(`${files.length} diagnostic photo(s) added and analyzed. Smart defaults suggested.`);
    };
    input.click();
  };

  // RO-level Xentry Saved Data scan (called from second page / renderRO)
  // Stores images+OCR on the RO, and also merges parsed data + OCR texts into the *first* repair line
  // so the line's story generator sees the initial Quick Test / saved data.
  const addROXentryPhotos = async () => {
    if (!currentRO) return;
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

      // RO level accumulators
      let roUpdatedImgs: Array<{ id: string; dataUrl: string; name: string }> = [...(latestROAtClick.xentryImages || [])];
      let roUpdatedOcr: string[] = [...(latestROAtClick.xentryOcrTexts || [])];

      // Also merge into first repair line so extracted data flows to stories
      const firstLine = latestROAtClick.repairLines[0];
      let lineUpdatedExtracted: ExtractedData = { ...(firstLine?.extractedData || { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] }) };
      let lineUpdatedOcr: string[] = [...(firstLine?.xentryOcrTexts || [])];
      const newImgsForRO: Array<{ id: string; dataUrl: string; name: string }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrl = await fileToDataUrl(file);
        const imgEntry = { id: 'rox-' + Date.now() + i, dataUrl, name: file.name || `xentry-${i+1}.jpg` };
        newImgsForRO.push(imgEntry);

        try {
          const pre = await preprocessImageForOCR(file);
          const text = await runOCR(pre, (p) => setOcrProgress(Math.round(((i + p) / files.length) * 100)));
          const diag = parseDiagnosticText(text);
          lineUpdatedExtracted = mergeExtracted(lineUpdatedExtracted, diag);
          lineUpdatedOcr = [...lineUpdatedOcr, text];
          roUpdatedOcr = [...roUpdatedOcr, text];
        } catch (err) {
          console.warn('RO Xentry OCR failed for one image', err);
        }
      }

      roUpdatedImgs = [...roUpdatedImgs, ...newImgsForRO];

      if (!latestROAtClick) return;

      // Update first line with merged data + ocr
      let updatedLines = latestROAtClick.repairLines;
      if (firstLine) {
        updatedLines = latestROAtClick.repairLines.map((l, idx) =>
          idx === 0 ? {
            ...l,
            xentryImages: [...(l.xentryImages || []), ...newImgsForRO],
            xentryOcrTexts: lineUpdatedOcr,
            extractedData: lineUpdatedExtracted
          } : l
        );
      }

      const updatedRO: RepairOrder = {
        ...latestROAtClick,
        xentryImages: roUpdatedImgs,
        xentryOcrTexts: roUpdatedOcr,
        repairLines: updatedLines
      };
      saveRO(updatedRO);
      setIsProcessingOCR(false);
      setOcrProgress(0);
      alert(`${files.length} Xentry saved data photo(s) added and analyzed.`);
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

  // RO-level editable updates for pre-populated scan data (vehicle, customer, complaints)
  const updateVehicle = (updates: Partial<RepairOrder['vehicle']>) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const updated = { ...latestRO, vehicle: { ...latestRO.vehicle, ...updates } };
    saveRO(updated);
  };

  const updateCustomer = (name: string) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const updated = { ...latestRO, customer: { ...latestRO.customer, name } };
    saveRO(updated);
  };

  const updateComplaints = (newComplaints: string[]) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    // If first complaint changed, try to keep line 1 concern in sync if it was previously matching
    let updatedLines = latestRO.repairLines;
    if (newComplaints.length > 0) {
      const oldFirst = latestRO.complaints[0] || '';
      updatedLines = latestRO.repairLines.map((l, idx) => {
        if (idx === 0 && (!l.customerConcern || l.customerConcern === oldFirst)) {
          return { ...l, customerConcern: newComplaints[0] || '' };
        }
        return l;
      });
    }
    const updated = { ...latestRO, complaints: newComplaints, repairLines: updatedLines };
    saveRO(updated);
  };

  const addComplaint = () => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    updateComplaints([...(latestRO.complaints || []), 'New concern - describe symptom']);
  };

  const removeComplaint = (index: number) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const filtered = (latestRO.complaints || []).filter((_, i) => i !== index);
    updateComplaints(filtered);
  };

  const editComplaint = (index: number, value: string) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const updated = [...(latestRO.complaints || [])];
    updated[index] = value;
    updateComplaints(updated);
  };

  const updateRONumber = (roNumber: string) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const updated = { ...latestRO, roNumber: roNumber.trim() };
    saveRO(updated);
  };

  // Apply smart Mercedes defaults + common issues for the current vehicle + mileage into the line
  const applySmartDefaultsToLine = (lineId: string) => {
    const latestRO = allROs.find(r => r.id === currentRO?.id) || currentRO;
    if (!latestRO) return;
    const line = latestRO.repairLines.find(l => l.id === lineId);
    if (!line) return;

    const sugg = getSuggestions(latestRO);
    let notes = (line.technicianNotes || '').trim();
    const addBlock = `\n\n[Smart defaults for ${sugg.bandNote}]\nCommon issues at this mileage: ${sugg.issues.join(' • ')}\nStandard values: ${sugg.tests.map(t => `${t.label}: ${t.spec}${t.note ? ' ('+t.note+')' : ''}`).join('; ')}`;

    if (!notes.includes('Smart defaults')) {
      notes = (notes + addBlock).trim();
    }
    // Also seed some measurements into extractedData if none
    let newExtract = line.extractedData || { codes: [], guidedTests: [], measurements: [], components: [], circuits: [] };
    if (newExtract.measurements.length === 0 && sugg.tests.length) {
      newExtract = {
        ...newExtract,
        measurements: sugg.tests.slice(0, 4).map(t => ({ label: t.label, value: t.spec }))
      };
    }
    const updatedLines = latestRO.repairLines.map(l => l.id === lineId ? { ...l, technicianNotes: notes, extractedData: newExtract } : l);
    saveRO({ ...latestRO, repairLines: updatedLines });
  };

  // Grok generation - enhanced with history for smarter AI over time
  const generateStory = async (lineId: string) => {
    if (!currentRO || !apiKey) {
      if (hasEncryptedKey && !isUnlocked) {
        alert('Unlock your encrypted xAI key in Settings using your passphrase.');
        setView('settings');
        return;
      }
      alert('Please enter / unlock your xAI Grok API key in Settings (gear icon).');
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
        .filter(r => r.id !== latestRO.id && r.vehicle.model && latestRO.vehicle.model && 
          (r.vehicle.model.toLowerCase().includes(latestRO.vehicle.model.toLowerCase().split(' ')[0]) ||
           (r.vehicle.make && latestRO.vehicle.make && r.vehicle.make.toLowerCase() === latestRO.vehicle.make.toLowerCase())))
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
      (ro.vehicle.make && ro.vehicle.make.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (ro.vehicle.model && ro.vehicle.model.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (ro.vehicle.year && ro.vehicle.year.includes(searchTerm)) ||
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
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#0a84ff] to-[#0066cc] flex items-center justify-center mb-3 p-1">
              <img src="/icon-512.png" alt="Benz Tech - Mercedes-Benz" className="w-full h-full rounded-2xl" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tighter">Benz Tech</h1>
            <p className="text-[#8e8e93] text-sm">Mercedes-Benz Technician • Warranty Story Assistant</p>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              onClick={addROPhoto}
              disabled={isProcessingOCR}
              className="primary-btn flex-1 h-12 flex items-center justify-center gap-2 text-sm"
            >
              <Camera size={18} />
              {isProcessingOCR ? `PROCESSING... ${ocrProgress}%` : 'ADD RO PHOTO'}
            </button>
            <button
              onClick={createManualRO}
              className="secondary-btn flex-1 h-12 flex items-center justify-center gap-2 text-sm"
            >
              <Plus size={18} /> NEW MANUAL
            </button>
          </div>

          {/* Pending multi-page RO images UI (new) - user adds 2-3 pages, then processes once */}
          {pendingROImages.length > 0 && (
            <div className="ios-card p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-widest text-[#8e8e93]">SELECTED RO PAGES ({pendingROImages.length}) — recommend 2-3 different pages</div>
                <button onClick={clearPendingROImages} disabled={isProcessingOCR} className="text-[10px] text-[#ff9f0a]">CLEAR</button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {pendingROImages.map((img, idx) => (
                  <div key={img.id} className="relative group">
                    <img 
                      src={img.dataUrl} 
                      className="w-full h-16 object-cover rounded border border-[#38383a] cursor-pointer" 
                      alt={img.name}
                      onClick={() => window.open(img.dataUrl)}
                    />
                    <button 
                      onClick={(e) => { e.stopPropagation(); setPendingROImages(prev => prev.filter((_, i) => i !== idx)); }}
                      disabled={isProcessingOCR}
                      className="absolute -top-1 -right-1 bg-[#ff3b30] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none"
                      title="Remove page"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={processPendingROImages}
                disabled={isProcessingOCR}
                className="primary-btn w-full h-11 text-sm font-semibold"
              >
                {isProcessingOCR ? `PROCESSING ALL IMAGES... ${ocrProgress}%` : 'PROCESS ALL IMAGES'}
              </button>
              <div className="text-center text-[9px] text-[#8e8e93] mt-1">Combines pages for accurate first-block extraction (RO#, vehicle, VIN, mileage, complaints A/B/C...)</div>
            </div>
          )}

          <div className="text-center text-[10px] text-[#8e8e93] mb-4 -mt-1">
            Add 2-3 RO page photos (tap Add repeatedly or select multiple). Then Process All for reliable extraction of RO# + first-block fields + all labeled complaints.
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
                    <div className="text-xs text-[#8e8e93]">{[ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ')} • {ro.repairLines.length} lines</div>
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
    const ro = currentRO;

    const letter = (i: number) => String.fromCharCode(65 + i); // A, B, C...

    return (
      <div className="px-5 pt-4 pb-8">
        <div className="flex justify-between items-center mb-3">
          <div>
            <div className="text-xl font-semibold">{ro.roNumber}</div>
            <div className="text-sm text-[#8e8e93]">Repair Order • Pre-populated from scan or manual entry</div>
          </div>
          <button onClick={() => setView('home')} className="text-[#0a84ff] text-sm">Done</button>
        </div>

        {/* MAIN FIRST BLOCK - combined larger organized card for RO Number + Vehicle/Customer + all labeled Complaints (A/B/C...).
           Everything from the improved first-block OCR now lives here. No separate complaints section. */}
        <div className="ios-card p-5 mb-6">
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-3">RO DETAILS (from first block of scan — RO# at top center, vehicle fields, all complaints from any page)</div>
          
          {/* RO Number prominent */}
          <div className="mb-3">
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">RO NUMBER</label>
            <input 
              value={ro.roNumber} 
              onChange={e => updateRONumber(e.target.value)} 
              placeholder="RO-123456" 
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm font-mono tracking-[1px]" 
            />
          </div>

          {/* Vehicle grid - 4 fields */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-[#8e8e93] block mb-0.5">YEAR</label>
              <input value={ro.vehicle.year} onChange={e => updateVehicle({ year: e.target.value })} placeholder="2023" className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-[#8e8e93] block mb-0.5">MAKE</label>
              <input value={ro.vehicle.make} onChange={e => updateVehicle({ make: e.target.value })} placeholder="Mercedes-Benz" className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-[#8e8e93] block mb-0.5">MODEL</label>
              <input value={ro.vehicle.model} onChange={e => updateVehicle({ model: e.target.value })} placeholder="GLE 450 4MATIC" className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-[#8e8e93] block mb-0.5">MILEAGE IN</label>
              <input value={ro.vehicle.mileageIn} onChange={e => updateVehicle({ mileageIn: e.target.value })} placeholder="48250" className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">VIN</label>
            <input value={ro.vehicle.vin} onChange={e => updateVehicle({ vin: e.target.value.toUpperCase() })} placeholder="W1Nxxxx..." maxLength={17} className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm font-mono tracking-[1px]" />
          </div>

          <div className="mb-4">
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">CUSTOMER NAME</label>
            <input value={ro.customer?.name || ''} onChange={e => updateCustomer(e.target.value)} placeholder="John Smith" className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm" />
          </div>

          {/* Complaints integrated here - no separate section */}
          <div className="border-t border-[#38383a] pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-widest text-[#8e8e93]">CUSTOMER COMPLAINTS (A, B, C, D... from any page)</div>
              <button onClick={addComplaint} className="text-[#0a84ff] text-xs flex items-center gap-1"><Plus size={14}/> ADD</button>
            </div>
            <p className="text-[9px] text-[#8e8e93] mb-2">Pre-populated from scan (first block + multi-page). Edit as needed.</p>

            {(ro.complaints && ro.complaints.length > 0) ? (
              ro.complaints.map((c, idx) => (
                <div key={idx} className="flex gap-2 mb-2 items-start">
                  <div className="mt-2 w-6 text-[#0a84ff] font-semibold text-sm shrink-0">{letter(idx)}.</div>
                  <textarea
                    value={c}
                    onChange={(e) => editComplaint(idx, e.target.value)}
                    className="flex-1 bg-[#2c2c2e] border border-[#38383a] rounded-2xl px-3 py-2 text-sm min-h-[48px] resize-y"
                  />
                  <button onClick={() => removeComplaint(idx)} className="mt-1 p-1.5 text-[#ff9f0a]" title="Remove complaint">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-sm text-[#8e8e93] mb-2">No complaints extracted. Add or rescan.</div>
            )}
            <button onClick={addComplaint} className="text-xs text-[#0a84ff] mt-1">+ Add another complaint</button>
          </div>
        </div>

        {/* XENTRY SAVED DATA IMAGE SCAN - supports Quick Test, fault codes, guided, wiring, continuity etc. */}
        <div className="ios-card p-4 mb-6">
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-1">XENTRY / DIAGNOSTIC IMAGE SCANS (RO level)</div>
          <p className="text-[10px] text-[#8e8e93] mb-2 leading-snug">Upload or capture XENTRY Quick Test, fault codes, Guided Tests, wiring diagrams, continuity checks, measurements. OCR + smart parsing feeds the AI + suggestions.</p>
          <button
            onClick={addROXentryPhotos}
            disabled={isProcessingOCR}
            className="secondary-btn w-full h-12 flex items-center justify-center gap-2 text-sm mb-2"
          >
            <Camera size={18} />
            {isProcessingOCR ? `ANALYZING... ${ocrProgress}%` : 'SCAN / ADD XENTRY PHOTOS (QT, CODES, GUIDED, WIRING...)'}
          </button>
          {ro.xentryImages && ro.xentryImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-2">
              {ro.xentryImages.map((img, idx) => (
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
          {ro.repairLines[0]?.extractedData && (ro.repairLines[0].extractedData.codes.length > 0 || ro.repairLines[0].extractedData.guidedTests.length > 0 || ro.repairLines[0].extractedData.measurements.length > 0) && (
            <div className="text-[10px] bg-[#1c1c1e] p-2 rounded">
              <div className="font-semibold mb-0.5">Extracted:</div>
              {ro.repairLines[0].extractedData.codes.length > 0 && <div>Codes: {ro.repairLines[0].extractedData.codes.join(', ')}</div>}
              {ro.repairLines[0].extractedData.guidedTests.length > 0 && <div>Guided: {ro.repairLines[0].extractedData.guidedTests.slice(0, 2).join(' | ')}</div>}
              {ro.repairLines[0].extractedData.measurements.length > 0 && <div>Meas: {ro.repairLines[0].extractedData.measurements.slice(0,1).map(m => `${m.label}=${m.value}`).join('; ')}</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-sm font-semibold text-[#8e8e93]">REPAIR LINES (A/B/C map to lines)</div>
          <button onClick={addRepairLine} className="flex items-center gap-1 text-[#0a84ff] text-sm font-medium">
            <Plus size={16} /> ADD LINE
          </button>
        </div>

        <div className="space-y-2">
          {ro.repairLines.map(line => (
            <div
              key={line.id}
              onClick={() => {
                const latestRO = allROs.find(r => r.id === ro?.id) || ro;
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
                {line.customerConcern && <div className="text-[10px] text-[#8e8e93] mt-0.5 truncate max-w-[240px]">{line.customerConcern}</div>}
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
            onClick={() => deleteRO(ro.id)}
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
    const ro = currentRO;
    const line = currentLine;

    // Show vehicle summary + all complaints labeled for context on diagnostic page
    const letter = (i: number) => String.fromCharCode(65 + i);
    const vehicleSummary = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
    const mileageStr = ro.vehicle.mileageIn ? `${ro.vehicle.mileageIn} mi` : '';

    return (
      <div className="px-5 pt-4 pb-10">
        <button onClick={() => {
          const latest = allROs.find(r => r.id === currentRO?.id) || currentRO;
          if (latest) setCurrentRO(latest);
          setView('ro');
        }} className="flex items-center text-[#0a84ff] mb-4">
          <ArrowLeft size={18} className="mr-1" /> Back to RO
        </button>

        {/* Customer / Vehicle info summary + complaints reference */}
        <div className="ios-card p-3 mb-4 text-xs">
          <div className="font-semibold mb-0.5">{vehicleSummary} {mileageStr ? `• ${mileageStr}` : ''} {ro.vehicle.vin ? `• VIN ${ro.vehicle.vin.slice(0,10)}...` : ''}</div>
          {ro.customer?.name && <div className="text-[#8e8e93]">Customer: {ro.customer.name}</div>}
          {ro.complaints && ro.complaints.length > 0 && (
            <div className="mt-1.5 text-[10px] text-[#8e8e93]">
              Complaints: {ro.complaints.map((c,i) => `${letter(i)}. ${c.slice(0,42)}${c.length>42?'…':''}`).join('  ')}
            </div>
          )}
        </div>

        <div className="mb-5">
          <div className="text-sm text-[#8e8e93]">LINE {line.lineNumber}</div>
          <input
            value={line.description}
            onChange={(e) => updateLine(line.id, { description: e.target.value })}
            className="text-xl font-semibold bg-transparent w-full focus:outline-none"
          />
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-xs uppercase tracking-widest text-[#8e8e93] block mb-1.5">CUSTOMER CONCERN (prefilled from scan)</label>
            <textarea
              value={line.customerConcern}
              onChange={(e) => updateLine(line.id, { customerConcern: e.target.value })}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-2xl p-3.5 text-sm min-h-[80px]"
              placeholder="Customer stated..."
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-[#8e8e93] block mb-1.5">TECHNICIAN NOTES + FINDINGS</label>
            <textarea
              value={line.technicianNotes}
              onChange={(e) => updateLine(line.id, { technicianNotes: e.target.value })}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-2xl p-3.5 text-sm min-h-[100px]"
              placeholder="Road test results, findings, observations..."
            />
          </div>

          {/* Uploads for Xentry tests, fault codes, guided tests, wiring diagrams, continuity checks */}
          <div>
            <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-1.5">DIAGNOSTIC EVIDENCE PHOTOS</div>
            <button
              onClick={() => addXentryPhotos(line.id)}
              disabled={isProcessingOCR}
              className="secondary-btn w-full h-12 flex items-center justify-center gap-2 text-sm mb-2"
            >
              <Camera size={18} />
              {isProcessingOCR ? `ANALYZING PHOTOS... ${ocrProgress}%` : 'ADD XENTRY TESTS / FAULT CODES / GUIDED / WIRING / CONTINUITY'}
            </button>
            <p className="text-[10px] text-[#8e8e93] -mt-1 mb-2">Photos analyzed with OCR. AI uses them + common issue knowledge for suggestions and stories.</p>

            {line.xentryImages && line.xentryImages.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                {line.xentryImages.map((img, idx) => (
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
            {line.extractedData && (line.extractedData.codes.length || line.extractedData.guidedTests.length || line.extractedData.measurements.length) && (
              <div className="text-[10px] bg-[#1c1c1e] p-2 rounded mb-2">
                <div className="font-semibold mb-1">Extracted from photos:</div>
                {line.extractedData.codes.length > 0 && <div>Codes: {line.extractedData.codes.join(', ')}</div>}
                {line.extractedData.guidedTests.length > 0 && <div>Guided: {line.extractedData.guidedTests.slice(0,2).join(' | ')}</div>}
                {line.extractedData.measurements.length > 0 && <div>Meas: {line.extractedData.measurements[0].label}={line.extractedData.measurements[0].value}</div>}
              </div>
            )}
          </div>

          {/* Smart Mercedes defaults + common issues + standard test values (client-side, augments AI) */}
          <div className="ios-card p-3 mb-1">
            <div className="flex justify-between items-center mb-1">
              <div className="text-xs uppercase tracking-widest text-[#8e8e93]">SMART DEFAULTS &amp; COMMON ISSUES</div>
              <button onClick={() => applySmartDefaultsToLine(line.id)} className="text-[10px] px-2 py-0.5 bg-[#2c2c2e] rounded text-[#0a84ff]">APPLY FOR THIS VEHICLE</button>
            </div>
            <div className="text-[10px] text-[#8e8e93]">
              {(() => { const s = getSuggestions(ro); return `${s.bandNote} — ${s.issues.slice(0,2).join(', ')}... Standard: ${s.tests.slice(0,2).map(t=>t.label).join(' / ')}`; })()}
            </div>
            <div className="text-[9px] mt-1 text-[#666]">Click APPLY to seed technician notes + expected values. AI will reference + expand in the warranty story.</div>
          </div>

          {/* One-click generate - prominent */}
          <div>
            <button
              onClick={() => generateStory(line.id)}
              disabled={isGenerating || !apiKey}
              className="primary-btn w-full h-14 text-base disabled:opacity-60"
            >
              {isGenerating ? 'GENERATING WITH GROK...' : 'GENERATE WARRANTY STORY (ONE-CLICK)'}
            </button>
            {!apiKey && <p className="text-center text-xs text-[#ff9f0a] mt-2">Add xAI Grok API key in Settings (gear) to generate.</p>}
          </div>

          {line.warrantyStory && (
            <div className="story-card p-5 mt-2">
              <div className="text-xs uppercase tracking-[1px] text-[#8e8e93] mb-3">WARRANTY STORY — 3 C's • AUDIT-RESISTANT</div>
              <div className="whitespace-pre-line text-[14.5px] leading-relaxed mb-5">{line.warrantyStory}</div>
              <div className="flex gap-3">
                <button onClick={() => copyStory(line.warrantyStory!)} className="flex-1 secondary-btn h-11 flex items-center justify-center gap-2 text-sm">
                  <Copy size={16} /> COPY
                </button>
                <button onClick={() => generateStory(line.id)} className="secondary-btn h-11 px-5 flex items-center gap-2 text-sm">
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
        <div className="font-semibold mb-1">xAI Grok API Key (encrypted storage)</div>
        <div className="text-[10px] text-[#8e8e93] mb-3">Key never stored in plain text. Uses AES-GCM encryption with your passphrase.</div>

        {hasEncryptedKey && !isUnlocked && (
          <div className="mb-4 p-3 bg-[#2c2c2e] rounded-xl">
            <div className="text-sm mb-2">Encrypted key detected. Enter passphrase to unlock for this session:</div>
            <input
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder="Your encryption passphrase"
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-xl p-3 text-sm mb-2"
            />
            <button onClick={async () => { if (passphrase) await unlockWithPassphrase(passphrase); }} className="primary-btn w-full h-10 text-sm">UNLOCK KEY</button>
          </div>
        )}

        <div>
          <label className="text-xs text-[#8e8e93] mb-1 block">API KEY (xai-...)</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="xai-yourkeyhere"
            className="w-full bg-[#2c2c2e] border border-[#444] rounded-xl p-3.5 font-mono text-sm mb-3"
          />
        </div>

        <div>
          <label className="text-xs text-[#8e8e93] mb-1 block">PASSPHRASE (for encryption - remember this!)</label>
          <input
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            placeholder="Strong passphrase to encrypt key"
            className="w-full bg-[#2c2c2e] border border-[#444] rounded-xl p-3.5 text-sm mb-3"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={() => saveApiKey(apiKey, passphrase)} className="flex-1 secondary-btn h-11">SAVE ENCRYPTED KEY</button>
          <button onClick={clearAllKeys} className="secondary-btn h-11 px-6 text-[#ff9f0a]">CLEAR ALL</button>
        </div>
        <p className="text-xs text-[#8e8e93] mt-3 leading-snug">
          Get key at <span className="underline">console.x.ai</span>. Encrypted with passphrase using Web Crypto (AES-GCM + 150k PBKDF2). Passphrase required on each app restart if key is encrypted.
          The key also enables premium Grok vision OCR for the initial RO scan (highly accurate structured extraction of vehicle info + labeled complaints).
        </p>
        {isUnlocked && <div className="text-[10px] text-[#30d158] mt-2">✓ Key unlocked in memory for this session.</div>}
      </div>

      <div className="text-xs text-[#8e8e93] px-1 leading-relaxed">
        Uses official xAI Grok API + master Mercedes-Benz technician prompt engineered for detailed, audit-resistant warranty stories covering the 3 C's, battery charger, initial/final Quick Tests, realistic test drives, etc.
      </div>
    </div>
  );

  return (
    <div className="app-container">
      {/* Global header for non-main screens */}
      {view !== 'home' && view !== 'settings' && (
        <header className="ios-header h-14 px-4 flex items-center justify-between sticky top-0 z-50">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/icon-512.png" alt="Benz Tech" className="w-6 h-6 rounded" />
            Benz Tech
          </div>
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
