import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { scoreWarrantyStory } from '@/lib/grok';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { dbToRepairOrder } from '@/lib/roMapper';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { PROMPT_VERSION } from '@/prompts/version';
import { parseRequestBody, reviewStorySchema } from '@/lib/validation';
import { STORY_SCORE_ROUTE_MAX_DURATION_S } from '@/lib/timeouts';

/** Keep in sync with STORY_SCORE_ROUTE_MAX_DURATION_S in `@/lib/timeouts`. */
export const maxDuration = STORY_SCORE_ROUTE_MAX_DURATION_S;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await params;

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, reviewStorySchema);
      if ('error' in parsed) return parsed.error;

      const warrantyStory = parsed.data.warrantyStory.trim();
      if (!warrantyStory) {
        return apiError('Warranty story text is required for scoring.', 400);
      }

      const ro = await prisma.repairOrder.findUnique({
        where: { id },
        include: { repairLines: true },
      });

      if (!ro || ro.dealershipId !== session.dealershipId) {
        return apiError(NOT_FOUND_ERROR, 404);
      }
      if (session.role !== 'manager' && ro.technicianId !== session.technicianId) {
        return apiError('You do not have permission to perform this action.', 403);
      }

      const mapped = dbToRepairOrder(ro);
      const line = mapped.repairLines.find((l) => l.id === lineId);
      if (!line) return apiError(NOT_FOUND_ERROR, 404);

      const dbLine = ro.repairLines.find((l) => l.id === lineId);
      if (isCustomerPayRepairLine(dbLine)) {
        return apiError('Customer Pay stories do not require AI quality scoring.', 400);
      }

      let quality;
      try {
        quality = { ...(await scoreWarrantyStory(mapped, line, warrantyStory)), scoredAgainstStory: warrantyStory };
      } catch (error) {
        const mappedError = mapGrokRouteError(error, 'Story scoring');
        return apiError(mappedError.message, mappedError.status);
      }

      await writeAuditLog({
        action: 'story.review',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: lineId,
        promptVersion: PROMPT_VERSION,
        metadata: {
          repairOrderId: id,
          lineNumber: line.lineNumber,
          promptVersion: PROMPT_VERSION,
          qualityScore: quality.score,
          qualityGrade: quality.grade,
          scoreOnly: true,
        },
        ipAddress: getRequestIp(request),
      });

      return { quality };
    },
    {
      rateLimitKey: 'story.score',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.story.score',
    }
  );
}