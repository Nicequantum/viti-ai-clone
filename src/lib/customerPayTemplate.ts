import { appendAuditLogInTransaction } from '@/lib/audit';
import { encryptOptionalSensitiveText, decryptSensitiveText, decryptOptionalSensitiveText } from '@/lib/encryption';
import { prisma } from '@/lib/db';
import { GLOBAL_DEALERSHIP_ID } from '@/lib/templateLibrary';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';

export interface ApplyCustomerPayTemplateInput {
  repairOrderId: string;
  repairLineId: string;
  templateId: string;
  dealershipId: string;
  technicianId: string;
  ipAddress?: string;
}

export interface ApplyCustomerPayTemplateResult {
  warrantyStory: string;
  templateTitle: string;
  isCustomerPay: true;
  /** M3: true when apply was skipped because line already had this template story. */
  idempotent?: boolean;
  /** True when unsafe characters were stripped for CDK compatibility. */
  cdkSanitized?: boolean;
}

export interface ClearCustomerPayModeInput {
  repairOrderId: string;
  repairLineId: string;
  dealershipId: string;
}

/**
 * M1: Explicitly clear Customer Pay mode so warranty AI generation can resume.
 */
export async function clearCustomerPayMode(input: ClearCustomerPayModeInput): Promise<void> {
  const ro = await prisma.repairOrder.findFirst({
    where: { id: input.repairOrderId, dealershipId: input.dealershipId },
    include: { repairLines: true },
  });
  if (!ro) throw new Error('Repair order not found');
  const line = ro.repairLines.find((l) => l.id === input.repairLineId);
  if (!line) throw new Error('Repair line not found');

  await prisma.repairLine.update({
    where: { id: input.repairLineId },
    data: { isCustomerPay: false },
  });
}

/** M3: Skip duplicate audit/usage when the same template story is already on the line. */
async function isDuplicateTemplateApply(
  line: { isCustomerPay: boolean; warrantyStoryEncrypted: string | null },
  templateId: string,
  repairLineId: string,
  dealershipId: string,
  preWrittenStory: string
): Promise<boolean> {
  if (!line.isCustomerPay) return false;
  const existingStory = decryptOptionalSensitiveText(line.warrantyStoryEncrypted);
  if (existingStory !== preWrittenStory) return false;

  const recent = await prisma.auditLog.findFirst({
    where: {
      action: 'customerPayTemplateApplied',
      entityId: repairLineId,
      dealershipId,
      createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
      metadata: { contains: `"templateId":"${templateId}"` },
    },
    orderBy: { createdAt: 'desc' },
  });
  return Boolean(recent);
}

/**
 * Apply a Customer Pay template to a repair line.
 * Customer Pay bypasses Grok — instant pre-written stories with lightweight audit only.
 * M2: Line update, usage counter, and audit run in one transaction.
 * M3: Idempotent when the same template story is already applied.
 */
export async function applyCustomerPayTemplate(
  input: ApplyCustomerPayTemplateInput
): Promise<ApplyCustomerPayTemplateResult> {
  const template = await prisma.template.findFirst({
    where: {
      id: input.templateId,
      OR: [{ dealershipId: input.dealershipId }, { dealershipId: GLOBAL_DEALERSHIP_ID }],
    },
  });

  if (!template) {
    throw new Error('Template not found');
  }

  if (!template.isCustomerPay) {
    throw new Error('This template is not a Customer Pay template');
  }

  const ro = await prisma.repairOrder.findFirst({
    where: { id: input.repairOrderId, dealershipId: input.dealershipId },
    include: { repairLines: true },
  });

  if (!ro) {
    throw new Error('Repair order not found');
  }

  const line = ro.repairLines.find((l) => l.id === input.repairLineId);
  if (!line) {
    throw new Error('Repair line not found');
  }

  const templateStory = decryptSensitiveText(template.contentEncrypted);
  const { text: preWrittenStory, wasModified: cdkSanitized } = sanitizeForCDKWithMeta(templateStory);

  if (
    await isDuplicateTemplateApply(
      line,
      template.id,
      input.repairLineId,
      input.dealershipId,
      preWrittenStory
    )
  ) {
    return {
      warrantyStory: preWrittenStory,
      templateTitle: template.title,
      isCustomerPay: true,
      idempotent: true,
      cdkSanitized,
    };
  }

  const encryptedStory = encryptOptionalSensitiveText(preWrittenStory);

  // M2: atomic apply — rollback line + usage + audit together on failure.
  await prisma.$transaction(async (tx) => {
    await tx.repairLine.update({
      where: { id: input.repairLineId },
      data: {
        warrantyStoryEncrypted: encryptedStory,
        isCustomerPay: true,
      },
    });

    await tx.template.updateMany({
      where: {
        id: input.templateId,
        OR: [{ dealershipId: input.dealershipId }, { dealershipId: GLOBAL_DEALERSHIP_ID }],
      },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });

    await appendAuditLogInTransaction(tx, {
      action: 'customerPayTemplateApplied',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      entityType: 'repairLine',
      entityId: input.repairLineId,
      metadata: {
        templateId: template.id,
        templateTitle: template.title,
        repairOrderId: input.repairOrderId,
      },
      ipAddress: input.ipAddress,
    });
  });

  return {
    warrantyStory: preWrittenStory,
    templateTitle: template.title,
    isCustomerPay: true,
    cdkSanitized,
  };
}