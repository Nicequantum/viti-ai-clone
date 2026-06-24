import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';

const STORY_ACTIONS = ['story.generate', 'story.review', 'story.edit'] as const;

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
        select: { id: true },
      });

      if (!line) {
        return { hash: null, promptVersion: null };
      }

      const latestLog = await prisma.auditLog.findFirst({
        where: {
          dealershipId: session.dealershipId,
          entityType: 'repairLine',
          entityId: repairLineId,
          action: { in: [...STORY_ACTIONS] },
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