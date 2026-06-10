import Tesseract from 'tesseract.js';

const OCR_TIMEOUT_MS = 120_000;
const MAX_DIM_FAST = 1600;
const MAX_DIM_FULL = 2200;

const TESSERACT_OPTS = {
  workerPath: '/tesseract/worker.min.js',
  langPath: '/tesseract',
  corePath: '/tesseract',
  gzip: true,
  workerBlobURL: false,
} as const;

let sharedWorker: Tesseract.Worker | null = null;
let workerInitPromise: Promise<Tesseract.Worker> | null = null;
let progressListener: ((p: number) => void) | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getSharedWorker(): Promise<Tesseract.Worker> {
  if (sharedWorker) return sharedWorker;
  if (!workerInitPromise) {
    workerInitPromise = Tesseract.createWorker('eng', 1, {
      ...TESSERACT_OPTS,
      logger: (message) => {
        if (message.status === 'recognizing text' && progressListener) {
          progressListener(Math.round(message.progress * 100));
        }
      },
    }).then((worker) => {
      sharedWorker = worker;
      return worker;
    });
  }
  return workerInitPromise;
}

export async function shutdownOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
  }
  sharedWorker = null;
  workerInitPromise = null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for OCR'));
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode preprocessed image'))),
      'image/png',
      0.92
    );
  });
}

/** Fast preprocess for shop-floor mobile devices — no multi-angle deskew. */
async function preprocessFast(file: File): Promise<Blob> {
  const img = await loadImage(file);
  try {
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > MAX_DIM_FAST) {
      const scale = MAX_DIM_FAST / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      minV = Math.min(minV, data[i]);
      maxV = Math.max(maxV, data[i]);
    }
    const range = Math.max(1, maxV - minV);
    for (let i = 0; i < data.length; i += 4) {
      let v = Math.round(((data[i] - minV) / range) * 255);
      v = Math.min(255, Math.max(0, Math.round((v - 128) * 1.8 + 128)));
      const binary = v > 140 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = binary;
    }

    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

/** Legacy heavy preprocess — deskew + sharpen; avoid on mobile scan paths. */
async function preprocessFull(file: File): Promise<Blob> {
  const img = await loadImage(file);
  try {
    let canvas = document.createElement('canvas');
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > MAX_DIM_FULL) {
      const scale = MAX_DIM_FULL / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    let ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);

    let imageData = ctx.getImageData(0, 0, w, h);
    let data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      minV = Math.min(minV, data[i]);
      maxV = Math.max(maxV, data[i]);
    }
    const range = Math.max(1, maxV - minV);
    for (let i = 0; i < data.length; i += 4) {
      let v = Math.round(((data[i] - minV) / range) * 255);
      v = Math.min(255, Math.max(0, Math.round((v - 128) * 2.2 + 128)));
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    const threshold = 140;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas);
  } catch (e) {
    console.warn('Full preprocess failed, using original', e);
    return file;
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export async function preprocessImageForOCR(
  file: File,
  mode: 'fast' | 'full' = 'fast'
): Promise<Blob> {
  try {
    return mode === 'full' ? await preprocessFull(file) : await preprocessFast(file);
  } catch (e) {
    console.warn('Preprocess failed, using original image', e);
    return file;
  }
}

type OcrPageSegMode = '4' | '6' | '11';

export async function runOCR(
  imageSource: Blob | File,
  onProgress?: (p: number) => void,
  pageSegMode: OcrPageSegMode = '6'
): Promise<string> {
  progressListener = onProgress ?? null;
  const recognize = async () => {
    const worker = await getSharedWorker();
    const {
      data: { text },
    } = await worker.recognize(imageSource as File, {
      tessedit_pageseg_mode: pageSegMode,
      tessedit_oem: '3',
      tessedit_char_whitelist:
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;/-_()[]#%&*+=@\'" \n',
    } as Record<string, string>);
    return text;
  };

  if (onProgress) onProgress(5);

  try {
    const text = await withTimeout(recognize(), OCR_TIMEOUT_MS, 'On-device OCR');
    if (onProgress) onProgress(100);
    return text;
  } finally {
    progressListener = null;
  }
}

/** Merge multiple OCR passes — keep the longest useful variant of each unique line. */
export function mergeOcrTextPasses(...passes: string[]): string {
  const lineMap = new Map<string, string>();

  for (const pass of passes) {
    if (!pass?.trim()) continue;
    for (const rawLine of pass.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
      const existing = lineMap.get(key);
      if (!existing || trimmed.length > existing.length) {
        lineMap.set(key, trimmed);
      }
    }
  }

  return [...lineMap.values()].join('\n');
}

/** Accuracy-first OCR: full preprocess + fast pass + sparse-column PSM for # A–F labels. */
export async function runMultiPassOCR(
  file: File,
  onProgress?: (p: number) => void
): Promise<string> {
  const full = await preprocessImageForOCR(file, 'full');
  const fast = await preprocessImageForOCR(file, 'fast');

  const pass1 = await runOCR(full, onProgress ? (p) => onProgress(Math.round(p * 0.4)) : undefined, '6');
  const pass2 = await runOCR(fast, onProgress ? (p) => onProgress(40 + Math.round(p * 0.35)) : undefined, '6');
  const pass3 = await runOCR(full, onProgress ? (p) => onProgress(75 + Math.round(p * 0.25)) : undefined, '4');

  return mergeOcrTextPasses(pass1, pass2, pass3);
}