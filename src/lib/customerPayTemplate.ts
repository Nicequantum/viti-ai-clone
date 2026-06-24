import { writeCustomerPayTemplateAudit } from '@/lib/audit';
import { encryptOptionalSensitiveText, decryptSensitiveText } from '@/lib/encryption';
import { prisma } from '@/lib/db';
import { GLOBAL_DEALERSHIP_ID, recordTemplateUsage } from '@/lib/templateLibrary';


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
}

/**
 * Apply a Customer Pay template to a repair line.
 *
 * Compliance bypass (intentional):
 * - No Grok API call
 * - No MI 2.0 story quality scoring
 * - No Merlin promptVersion on audit (uses customer-pay sentinel)
 * Warranty AI flows remain unchanged for non–Customer Pay lines.
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

  // H14: explicit flag only — category/templateType alone cannot trigger compliance bypass.
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

  const preWrittenStory = decryptSensitiveText(template.contentEncrypted);

  await prisma.repairLine.update({
    where: { id: input.repairLineId },
    data: {
      warrantyStoryEncrypted: encryptOptionalSensitiveText(preWrittenStory),
      isCustomerPay: true,
    },
  });

  await recordTemplateUsage(input.templateId, input.dealershipId);

  await writeCustomerPayTemplateAudit({
    dealershipId: input.dealershipId,
    technicianId: input.technicianId,
    repairLineId: input.repairLineId,
    repairOrderId: input.repairOrderId,
    templateId: template.id,
    templateTitle: template.title,
    ipAddress: input.ipAddress,
  });

  return {
    warrantyStory: preWrittenStory,
    templateTitle: template.title,
    isCustomerPay: true,
  };
}