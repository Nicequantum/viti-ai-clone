import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, NOT_FOUND_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { reviewWarrantyStory } from '@/lib/grok';
import { dbToRepairOrder } from '@/lib/roMapper';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { parseBody, reviewStorySchema } from '@/lib/validation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await params;

  return withAuth(
    request,
    async (session) => {
      const body = await request.json();
      const parsed = parseBody(reviewStorySchema, body);
      if ('error' in parsed) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const warrantyStory = parsed.data.warrantyStory.trim();
      if (!warrantyStory) {
        return apiError('Warranty story text is required for review.', 400);
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

      let review;
      try {
        review = await reviewWarrantyStory(mapped, line, warrantyStory);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Story review failed';
        if (message.includes('GROK_API_KEY')) {
          return apiError('Story review is not configured. Contact your administrator.', 503);
        }
        if (message.toLowerCase().includes('timed out')) {
          return apiError('Story review timed out — try again in a moment.', 504);
        }
        return apiError('Story review failed — try again in a moment.', 502);
      }

      const quality = { ...review, scoredAgainstStory: warrantyStory };

      await writeAuditLog({
        action: 'story.review',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: lineId,
        metadata: {
          repairOrderId: id,
          lineNumber: line.lineNumber,
          qualityScore: quality.score,
          qualityGrade: quality.grade,
        },
        ipAddress: getRequestIp(request),
      });

      return { review: quality };
    },
    { rateLimitKey: 'story.review', rateLimit: RATE_LIMITS.generate, trackUsage: true }
  );
}