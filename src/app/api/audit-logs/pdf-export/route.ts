import { writeAuditLog } from '@/lib/audit';
import { PROMPT_VERSION } from '@/prompts/version';
import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { parseBody, pdfExportAuditSchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError(VALIDATION_ERROR, 400);
      }

      const parsed = parseBody(pdfExportAuditSchema, body);
      if ('error' in parsed) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const { repairLineId, repairOrderId } = parsed.data;

      const line = await prisma.repairLine.findFirst({
        where: {
          id: repairLineId,
          repairOrderId,
          repairOrder: { dealershipId: session.dealershipId },
        },
        select: { id: true, lineNumber: true },
      });

      if (!line) {
        return apiError(VALIDATION_ERROR, 400);
      }

      await writeAuditLog({
        action: 'story.pdf_export',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: repairLineId,
        promptVersion: PROMPT_VERSION,
        metadata: {
          repairOrderId,
          lineNumber: line.lineNumber,
          promptVersion: PROMPT_VERSION,
        },
        ipAddress: getRequestIp(request),
      });

      return { ok: true };
    },
    { rateLimitKey: 'audit-logs.pdf-export' }
  );
}