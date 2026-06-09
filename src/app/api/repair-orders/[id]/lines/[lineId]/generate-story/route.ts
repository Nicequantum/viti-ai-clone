import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import {
  formatAdvisorContextForPrompt,
  loadAdvisorPromptContextForRepairOrder,
} from '@/lib/advisorIntelligence';
import { prisma } from '@/lib/db';
import { generateWarrantyStory } from '@/lib/grok';
import { dbToRepairOrder } from '@/lib/roMapper';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';

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

      if (!ro) return apiError(NOT_FOUND_ERROR, 404);
      if (session.role !== 'manager' && ro.technicianId !== session.technicianId) {
        return apiError('You do not have permission to perform this action.', 403);
      }

      const mapped = dbToRepairOrder(ro);
      const line = mapped.repairLines.find((l) => l.id === lineId);
      if (!line) return apiError(NOT_FOUND_ERROR, 404);

      let historyContext = '';
      const similar = await prisma.repairOrder.findMany({
        where: {
          dealershipId: session.dealershipId,
          id: { not: id },
          model: ro.model ? { contains: ro.model.split(' ')[0] } : undefined,
        },
        include: { repairLines: true },
        take: 2,
      });

      if (similar.length > 0) {
        historyContext =
          '\n\nFor writing style reference only (do NOT copy facts from these — use only current line data):\n' +
          similar
            .map((r) => {
              const m = dbToRepairOrder(r);
              return m.repairLines
                .filter((l) => l.warrantyStory)
                .map((l) => `For ${l.description}: ${l.warrantyStory!.substring(0, 250)}...`)
                .join('\n');
            })
            .join('\n---\n');
      }

      const advisorCtx = await loadAdvisorPromptContextForRepairOrder(id);
      const advisorContext = advisorCtx ? formatAdvisorContextForPrompt(advisorCtx) : '';

      const warrantyStory = await generateWarrantyStory(mapped, line, historyContext, advisorContext);

      await prisma.repairLine.update({
        where: { id: lineId },
        data: { warrantyStory },
      });

      await writeAuditLog({
        action: 'story.generate',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: lineId,
        metadata: {
          repairOrderId: id,
          lineNumber: line.lineNumber,
          advisorIntelligenceUsed: Boolean(advisorCtx),
          serviceAdvisorId: advisorCtx?.serviceAdvisorId ?? null,
          serviceAdvisorName: advisorCtx?.displayName ?? null,
        },
        ipAddress: getRequestIp(request),
      });

      return { warrantyStory };
    },
    { rateLimitKey: 'story.generate', rateLimit: RATE_LIMITS.generate }
  );
}