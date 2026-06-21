import type { ExtractedData, ImageAttachment, RepairLine, RepairOrder } from '@/types';
import type { RepairLine as DbLine, RepairOrder as DbRO } from '@prisma/client';
import {
  decryptComplaintsPayload,
  decryptOptionalSensitiveText,
  decryptPII,
  decryptSensitiveText,
  decryptStringArray,
  encryptComplaintsPayload,
  encryptOptionalSensitiveText,
  encryptPII,
  encryptSensitiveText,
  encryptStringArray,
} from './encryption';
import { buildImageProxyUrl, extractPathnameFromImageRef } from './imageUrls';

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseImageAttachments(raw: string): ImageAttachment[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (typeof item === 'string') {
        const pathname = extractPathnameFromImageRef(item);
        if (!pathname) return null;
        return { id: `img-${pathname.slice(-12)}`, pathname, url: buildImageProxyUrl(pathname), name: 'image.jpg' };
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const pathname =
          typeof record.pathname === 'string'
            ? record.pathname
            : extractPathnameFromImageRef(typeof record.url === 'string' ? record.url : '');
        if (!pathname || !pathname.startsWith('benz-tech/')) return null;
        return {
          id: typeof record.id === 'string' ? record.id : `img-${Date.now()}`,
          pathname,
          url: buildImageProxyUrl(pathname),
          name: typeof record.name === 'string' ? record.name : 'image.jpg',
        };
      }
      return null;
    })
    .filter((img): img is ImageAttachment => img !== null);
}

export function normalizeImageAttachments(
  images?: Array<{ id: string; pathname?: string; url?: string; name: string }>
): ImageAttachment[] {
  return (images || [])
    .map((img) => {
      const pathname = img.pathname || extractPathnameFromImageRef(img.url || '');
      if (!pathname || !pathname.startsWith('benz-tech/')) return null;
      return {
        id: img.id,
        pathname,
        url: buildImageProxyUrl(pathname),
        name: img.name,
      };
    })
    .filter((img): img is ImageAttachment => img !== null);
}

export function sanitizeImageAttachments(images?: ImageAttachment[]): ImageAttachment[] {
  return (images || [])
    .filter((img) => img.pathname?.startsWith('benz-tech/'))
    .map((img) => ({
      id: img.id,
      pathname: img.pathname,
      url: buildImageProxyUrl(img.pathname),
      name: img.name,
    }));
}

export function imageAttachmentsToJson(images?: ImageAttachment[]): string {
  return JSON.stringify(
    sanitizeImageAttachments(images).map(({ id, pathname, name }) => ({ id, pathname, name }))
  );
}

type DbROWithAdvisor = DbRO & {
  repairLines: DbLine[];
  serviceAdvisor?: { id: string; displayName: string } | null;
};

export function dbToRepairOrder(ro: DbROWithAdvisor): RepairOrder {
  const advisorName = ro.serviceAdvisorNameEncrypted
    ? decryptPII(ro.serviceAdvisorNameEncrypted)
    : undefined;

  return {
    id: ro.id,
    roNumber: ro.roNumber,
    vehicle: {
      vin: decryptPII(ro.vinEncrypted),
      year: ro.year,
      make: ro.make,
      model: ro.model,
      engine: ro.engine,
      mileageIn: ro.mileageIn,
      mileageOut: ro.mileageOut,
    },
    customer: { name: decryptPII(ro.customerNameEncrypted) },
    ...(() => {
      const payload = decryptComplaintsPayload(ro.complaintsEncrypted);
      return {
        complaints: payload.complaints,
        complaintLabels: payload.labels,
      };
    })(),
    serviceAdvisor: ro.serviceAdvisor
      ? {
          id: ro.serviceAdvisor.id,
          displayName: ro.serviceAdvisor.displayName,
          matchConfidence: ro.advisorMatchConfidence ?? undefined,
        }
      : undefined,
    serviceAdvisorName: advisorName || ro.serviceAdvisor?.displayName,
    xentryImages: parseImageAttachments(ro.xentryImageUrls),
    xentryOcrTexts: decryptStringArray(ro.xentryOcrTextsEncrypted),
    repairLines: ro.repairLines.sort((a, b) => a.lineNumber - b.lineNumber).map(dbToRepairLine),
    createdAt: ro.createdAt.toISOString(),
    technicianId: ro.technicianId,
    technicianName: undefined,
  };
}

export function dbToRepairLine(line: DbLine): RepairLine {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    description: line.description,
    customerConcern: decryptPII(line.customerConcernEncrypted),
    technicianNotes: decryptSensitiveText(line.technicianNotesEncrypted),
    xentryImages: parseImageAttachments(line.xentryImageUrls),
    xentryOcrTexts: decryptStringArray(line.xentryOcrTextsEncrypted),
    extractedData: parseJson<ExtractedData>(line.extractedData, {
      codes: [],
      faultCodes: [],
      guidedTests: [],
      measurements: [],
      components: [],
      circuits: [],
    }),
    warrantyStory: decryptOptionalSensitiveText(line.warrantyStoryEncrypted),
  };
}

export interface RepairOrderInput {
  roNumber: string;
  vehicle: {
    vin: string;
    year: string;
    make: string;
    model: string;
    engine?: string;
    mileageIn: string;
    mileageOut: string;
  };
  customer: { name: string };
  complaints: string[];
  complaintLabels?: string[];
  xentryImages?: ImageAttachment[];
  xentryOcrTexts?: string[];
  repairLines: RepairLine[];
}

export function repairOrderToDbFields(input: RepairOrderInput) {
  return {
    roNumber: input.roNumber,
    vinEncrypted: encryptPII(input.vehicle.vin),
    year: input.vehicle.year,
    make: input.vehicle.make,
    model: input.vehicle.model,
    engine: input.vehicle.engine || '',
    mileageIn: input.vehicle.mileageIn,
    mileageOut: input.vehicle.mileageOut,
    customerNameEncrypted: encryptPII(input.customer.name),
    complaintsEncrypted: encryptComplaintsPayload(input.complaints, input.complaintLabels),
    xentryImageUrls: imageAttachmentsToJson(input.xentryImages),
    xentryOcrTextsEncrypted: encryptStringArray(input.xentryOcrTexts || []),
  };
}

export function repairLineToDbFields(line: RepairLine) {
  return {
    lineNumber: line.lineNumber,
    description: line.description,
    customerConcernEncrypted: encryptPII(line.customerConcern),
    technicianNotesEncrypted: encryptSensitiveText(line.technicianNotes),
    xentryImageUrls: imageAttachmentsToJson(line.xentryImages),
    xentryOcrTextsEncrypted: encryptStringArray(line.xentryOcrTexts || []),
    extractedData: JSON.stringify(line.extractedData || {}),
    warrantyStoryEncrypted: encryptOptionalSensitiveText(line.warrantyStory),
  };
}