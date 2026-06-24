import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';

const WARRANTY_STORY_ACTIONS = ['story.generate', 'story.review', 'story.edit'] as const;
const CUSTOMER_PAY_STORY_ACTIONS = [
  'customerPayTemplateApplied',
  'customerPayStory.edit',
  'customerPayStory.pdf_export',
] as const;

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const repairLineId = new URL(request.url).searchParams.get('repairLineId')?.trim();
      if (!repairLineId) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const line = await prisma.repairLine.findFirst({
        where: {
          id: repairLineId,
          repairOrder: { dealershipId: session.dealershipId },
        },
        select: { id: true, isCustomerPay: true },
      });

      if (!line) {
        return { hash: null, promptVersion: null };
      }

      const actions = line.isCustomerPay
        ? [...CUSTOMER_PAY_STORY_ACTIONS]
        : [...WARRANTY_STORY_ACTIONS];

      const latestLog = await prisma.auditLog.findFirst({
        where: {
          dealershipId: session.dealershipId,
          entityType: 'repairLine',
          entityId: repairLineId,
          action: { in: actions },
          entryHash: { not: '' },
        },
        orderBy: { createdAt: 'desc' },
        select: { entryHash: true, promptVersion: true },
      });

      return {
        hash: latestLog?.entryHash ?? null,
        promptVersion: latestLog?.promptVersion ?? null,
      };
    },
    { rateLimitKey: 'audit-logs.latest' }
  );
}