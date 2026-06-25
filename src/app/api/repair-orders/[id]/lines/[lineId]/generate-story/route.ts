import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { generateWarrantyStory } from '@/lib/grok';
import { buildStoryGenerateAuditMetadata } from '@/lib/promptFingerprint';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { encryptOptionalSensitiveText } from '@/lib/encryption';
import { dbToRepairOrder } from '@/lib/roMapper';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';

/** Must match STORY_GENERATE_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await params;

  return withAuth(
    request,
    async (session) => {
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
        return apiError(
          'This line uses a Customer Pay template. Clear Customer Pay mode (Switch to warranty AI) to generate with Grok.',
          400
        );
      }

      let warrantyStory: string;
      let cdkSanitized = false;
      try {
        const rawStory = await generateWarrantyStory(mapped, line);
        const cleaned = sanitizeForCDKWithMeta(rawStory);
        warrantyStory = cleaned.text;
        cdkSanitized = cleaned.wasModified;
      } catch (error) {
        const mapped = mapGrokRouteError(error, 'Story generation');
        return apiError(mapped.message, mapped.status);
      }

      // C3: durable audit trail before persisting story — if audit fails, story is not saved.
      await writeAuditLog({
        action: 'story.generate',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: lineId,
        metadata: buildStoryGenerateAuditMetadata({
          repairOrderId: id,
          lineNumber: line.lineNumber,
          advisorIntelligenceUsed: false,
          advisorContextHash: null,
          knowledgeBaseEntryIds: [],
          historyContextLineCount: 0,
          qualityScore: null,
          qualityGrade: null,
          serviceAdvisorId: null,
        }),
        ipAddress: getRequestIp(request),
      });

      await prisma.repairLine.update({
        where: { id: lineId },
        data: { warrantyStoryEncrypted: encryptOptionalSensitiveText(warrantyStory) },
      });

      return { warrantyStory, quality: null, cdkSanitized };
    },
    {
      rateLimitKey: 'story.generate',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.story.generate',
    }
  );
}