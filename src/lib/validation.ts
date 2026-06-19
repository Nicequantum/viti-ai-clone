import { z } from 'zod';
import { d7NumberField } from './d7Number';
import {
  sanitizeComplaintSlots,
  sanitizeIdentifier,
  sanitizeText,
  sanitizeTextArray,
  sanitizeVin,
} from './sanitize';

const safeText = (max: number) => z.string().max(max).transform(sanitizeText);
const safeTextOptional = (max: number) => z.string().max(max).transform(sanitizeText).optional();
const safeId = (max: number) => z.string().max(max).transform(sanitizeIdentifier);
const safeIdOptional = (max: number) => z.string().max(max).transform(sanitizeIdentifier).optional();

export const loginSchema = z.object({
  d7Number: d7NumberField,
  password: z.string().min(1).max(128),
});

export const vinSchema = z.object({
  vin: z.string().trim().min(11).max(17).transform(sanitizeVin),
});

export const imagePathnamesSchema = z.object({
  imagePathnames: z
    .array(z.string().min(3).max(512).transform(sanitizeIdentifier))
    .min(1)
    .max(10),
});

const imageAttachmentSchema = z
  .object({
    id: z.string().max(64).transform(sanitizeIdentifier),
    pathname: z.string().min(3).max(512).transform(sanitizeIdentifier).optional(),
    url: z.string().min(1).max(512).optional(),
    name: z.string().max(255).transform(sanitizeText),
  })
  .refine((img) => Boolean(img.pathname || img.url), {
    message: 'Image attachment requires pathname or url',
  });

const vehicleSchema = z.object({
  vin: z.string().max(17).transform(sanitizeVin).optional(),
  year: safeTextOptional(10),
  make: safeTextOptional(64),
  model: safeTextOptional(64),
  engine: safeTextOptional(64),
  mileageIn: safeTextOptional(16),
  mileageOut: safeTextOptional(16),
});

const faultCodeSchema = z.object({
  code: safeText(32),
  description: safeText(500),
  status: safeText(32).optional(),
});

const extractedDataSchema = z.object({
  codes: z.array(safeText(128)).optional(),
  faultCodes: z.array(faultCodeSchema).max(30).optional(),
  guidedTests: z.array(safeText(2000)).optional(),
  measurements: z
    .array(
      z.object({
        label: safeText(200),
        value: safeText(200),
      })
    )
    .optional(),
  components: z.array(safeText(500)).optional(),
  circuits: z.array(safeText(500)).optional(),
});

const repairLineSchema = z.object({
  id: safeIdOptional(64),
  lineNumber: z.number().int().positive().optional(),
  description: safeTextOptional(500),
  customerConcern: safeTextOptional(2000),
  technicianNotes: safeTextOptional(10000),
  xentryImages: z.array(imageAttachmentSchema).max(20).optional(),
  xentryOcrTexts: z.array(safeText(50000)).max(20).optional(),
  extractedData: extractedDataSchema.optional(),
  warrantyStory: safeTextOptional(5000),
});

const advisorExtractionSourceSchema = z.enum(['grok', 'ocr_fallback', 'manual']);

export const createRepairOrderSchema = z.object({
  fromExtraction: z.boolean().optional(),
  roNumber: safeIdOptional(32),
  vehicle: vehicleSchema.optional(),
  customer: z.object({ name: safeTextOptional(200) }).optional(),
  customerName: safeTextOptional(200),
  serviceAdvisorName: safeTextOptional(48),
  advisorExtractionSource: advisorExtractionSourceSchema.optional(),
  complaints: z.array(safeText(2000)).max(20).transform(sanitizeComplaintSlots).optional(),
  complaintLabels: z.array(safeText(4)).max(20).optional(),
  xentryImages: z.array(imageAttachmentSchema).max(20).optional(),
  xentryOcrTexts: z.array(safeText(50000)).max(20).optional(),
  repairLines: z.array(repairLineSchema).max(50).optional(),
});

export const updateRepairOrderSchema = z.object({
  roNumber: safeIdOptional(32),
  vehicle: vehicleSchema.optional(),
  customer: z.object({ name: safeTextOptional(200) }).optional(),
  serviceAdvisorName: safeTextOptional(48),
  advisorExtractionSource: advisorExtractionSourceSchema.optional(),
  complaintsWereCorrected: z.boolean().optional(),
  complaints: z.array(safeText(2000)).max(20).transform(sanitizeComplaintSlots).optional(),
  complaintLabels: z.array(safeText(4)).max(20).optional(),
  xentryImages: z.array(imageAttachmentSchema).max(20).optional(),
  xentryOcrTexts: z.array(safeText(50000)).max(20).optional(),
  repairLines: z.array(repairLineSchema).max(50).optional(),
});

export const resolveAdvisorSchema = z.object({
  serviceAdvisorName: safeText(48),
});

export const createUserSchema = z.object({
  d7Number: d7NumberField,
  name: safeText(100),
  password: z.string().min(8).max(128),
  role: z.enum(['technician', 'manager']).default('technician'),
});

export const updateUserSchema = z.object({
  isActive: z.boolean(),
});

export const storyEditSchema = z.object({
  warrantyStory: safeText(5000),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

export const reviewStorySchema = z.object({
  warrantyStory: safeText(5000),
});

export const saveTemplateFromStorySchema = z.object({
  title: safeText(120),
  category: z.enum(['customer', 'warranty']),
  finalText: safeText(5000),
  generatedText: safeText(5000),
  lineDescription: safeTextOptional(500),
  vehicleMake: safeTextOptional(64),
  vehicleModel: safeTextOptional(64),
  codes: z.array(safeText(32)).max(20).optional(),
  repairOrderId: safeIdOptional(64),
  lineId: safeIdOptional(64),
});

export const auditLogQuerySchema = z.object({
  technicianId: safeIdOptional(64),
  action: safeIdOptional(64),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { data: result.data };
}