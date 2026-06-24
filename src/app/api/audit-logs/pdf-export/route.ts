import { writeAuditLog } from '@/lib/audit';
import { PROMPT_VERSION } from '@/prompts/version';
import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { logPerformance } from '@/lib/perf';
import { parseRequestBody, pdfExportAuditSchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, pdfExportAuditSchema);
      if ('error' in parsed) return parsed.error;

      const { repairLineId, repairOrderId, durationMs } = parsed.data;

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

      if (durationMs != null) {
        logPerformance('client.pdf.export', durationMs, {
          repairLineId,
          repairOrderId,
          technicianId: session.technicianId,
        });
      }

      return { ok: true };
    },
    { rateLimitKey: 'audit-logs.pdf-export', perfEvent: 'route.pdf.export.audit' }
  );
}