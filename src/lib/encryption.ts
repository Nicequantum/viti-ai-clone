import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPTION_KEY must be set (min 32 chars) for PII encryption');
  }
  return scryptSync(secret, 'benz-tech-pii-salt', 32);
}

export function encryptPII(plaintext: string): string {
  if (!plaintext) return '';
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptPII(ciphertext: string): string {
  if (!ciphertext) return '';
  try {
    const key = getKey();
    const data = Buffer.from(ciphertext, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = data.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function encryptStringArray(items: string[]): string {
  if (!items.length) return '';
  return encryptPII(JSON.stringify(items));
}

function isLegacyJsonArray(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('[');
}

export function decryptStringArray(ciphertext: string): string[] {
  if (!ciphertext) return [];
  if (isLegacyJsonArray(ciphertext)) {
    try {
      const parsed = JSON.parse(ciphertext);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  const raw = decryptPII(ciphertext);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return [];
  }
  return [];
}

/** Encrypt a sensitive text field for storage (technician notes, etc.). */
export function encryptSensitiveText(plaintext: string): string {
  if (!plaintext) return '';
  return encryptPII(plaintext);
}

/** Decrypt a sensitive text field, falling back to legacy plaintext values. */
export function decryptSensitiveText(ciphertext: string): string {
  if (!ciphertext) return '';
  const decrypted = decryptPII(ciphertext);
  if (decrypted) return decrypted;
  return ciphertext;
}

export function decryptOptionalSensitiveText(ciphertext: string | null): string | undefined {
  if (!ciphertext) return undefined;
  const value = decryptSensitiveText(ciphertext);
  return value || undefined;
}

export function encryptOptionalSensitiveText(plaintext: string | undefined | null): string | null {
  if (!plaintext) return null;
  const encrypted = encryptPII(plaintext);
  return encrypted || null;
}

export interface ComplaintsPayload {
  complaints: string[];
  labels?: string[];
}

/** Backward-compatible: legacy payloads are plain string arrays. */
export function decryptComplaintsPayload(ciphertext: string): ComplaintsPayload {
  const raw = decryptPII(ciphertext);
  if (!raw) return { complaints: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { complaints: parsed.map(String) };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.complaints)) {
      const complaints = parsed.complaints.map(String);
      const labels = Array.isArray(parsed.labels) ? parsed.labels.map(String) : undefined;
      if (labels && labels.length === complaints.length) {
        return { complaints, labels };
      }
      return { complaints };
    }
  } catch {
    return { complaints: [] };
  }
  return { complaints: [] };
}

export function encryptComplaintsPayload(complaints: string[], labels?: string[]): string {
  const hasLabels = Boolean(labels && labels.length === complaints.length);
  const payload: ComplaintsPayload | string[] = hasLabels ? { complaints, labels } : complaints;
  return encryptPII(JSON.stringify(payload));
}

