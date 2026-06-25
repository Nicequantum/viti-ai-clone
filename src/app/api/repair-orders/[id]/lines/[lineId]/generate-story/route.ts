import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import {
  formatAdvisorContextForPrompt,
  loadAdvisorPromptContextForRepairOrder,
} from '@/lib/advisorIntelligence';
import { prisma } from '@/lib/db';
import { generateWarrantyStory } from '@/lib/grok';
import { hashPromptFragment, buildStoryGenerateAuditMetadata } from '@/lib/promptFingerprint';
import {
  formatKnowledgeBaseForPrompt,
  GLOBAL_DEALERSHIP_ID,
  mapKnowledgeBase,
  selectRelevantKnowledgeEntries,
} from '@/lib/templateLibrary';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { encryptOptionalSensitiveText } from '@/lib/encryption';
import { dbToRepairOrder } from '@/lib/roMapper';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import { STORY_GENERATE_ROUTE_MAX_DURATION_S } from '@/lib/timeouts';

/** Keep in sync with STORY_GENERATE_ROUTE_MAX_DURATION_S in `@/lib/timeouts`. */
export const maxDuration = STORY_GENERATE_ROUTE_MAX_DURATION_S;

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

      const [similar, advisorCtx] = await Promise.all([
        prisma.repairOrder.findMany({
          where: {
            dealershipId: session.dealershipId,
            id: { not: id },
            model: ro.model ? { contains: ro.model.split(' ')[0] } : undefined,
          },
          include: { repairLines: true },
          take: 1,
        }),
        loadAdvisorPromptContextForRepairOrder(id),
      ]);

      let historyContext = '';
      if (similar.length > 0) {
        historyContext =
          similar
            .map((r) => {
              const m = dbToRepairOrder(r);
              return m.repairLines
                // M5: exclude Customer Pay stories from warranty style reference.
                .filter((l) => l.warrantyStory && !l.isCustomerPay)
                .map((l) => `${l.description}: ${l.warrantyStory!.substring(0, 160)}…`)
                .join('\n');
            })
            .join('\n');
      }

      const advisorContext = advisorCtx ? formatAdvisorContextForPrompt(advisorCtx) : '';

      const kbRows = await prisma.knowledgeBase.findMany({
        where: {
          // M4: Customer Pay templates must not pollute warranty AI knowledge base.
          category: { not: 'customer' },
          OR: [{ dealershipId: GLOBAL_DEALERSHIP_ID }, { dealershipId: session.dealershipId, source: 'user' }],
        },
        orderBy: [{ source: 'desc' }, { updatedAt: 'desc' }],
        take: 40,
      });
      const kbEntries = kbRows.map(mapKnowledgeBase);
      const relevantKb = selectRelevantKnowledgeEntries(mapped, line, kbEntries, session.dealershipId, 3);
      const knowledgeBaseContext = formatKnowledgeBaseForPrompt(relevantKb, { maxEntryChars: 420 });

      let warrantyStory: string;
      let cdkSanitized = false;
      try {
        const rawStory = await generateWarrantyStory(
          mapped,
          line,
          historyContext,
          advisorContext,
          knowledgeBaseContext
        );
        const cleaned = sanitizeForCDKWithMeta(rawStory);
        warrantyStory = cleaned.text;
        cdkSanitized = cleaned.wasModified;
      } catch (error) {
        const mapped = mapGrokRouteError(error, 'Story generation');
        return apiError(mapped.message, mapped.status);
      }

      // C3: durable audit trail before persisting story — if audit fails, story is not saved.
      const historyContextLineCount = historyContext
        ? historyContext.split('\n').filter((row) => row.trim().length > 0).length
        : 0;

      await writeAuditLog({
        action: 'story.generate',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: lineId,
        metadata: buildStoryGenerateAuditMetadata({
          repairOrderId: id,
          lineNumber: line.lineNumber,
          advisorIntelligenceUsed: Boolean(advisorCtx),
          advisorContextHash: advisorContext ? hashPromptFragment(advisorContext) : null,
          knowledgeBaseEntryIds: relevantKb.map((entry) => entry.id),
          historyContextLineCount,
          qualityScore: null,
          qualityGrade: null,
          serviceAdvisorId: advisorCtx?.serviceAdvisorId ?? null,
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