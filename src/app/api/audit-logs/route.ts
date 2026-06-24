import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { auditLogQuerySchema, parseBody } from '@/lib/validation';

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toCsvValue(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const params = Object.fromEntries(new URL(request.url).searchParams.entries());
      const parsed = parseBody(auditLogQuerySchema, params);
      if ('error' in parsed) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const { technicianId, action, from, to, format } = parsed.data;
      const where: {
        dealershipId: string;
        technicianId?: string;
        action?: string;
        createdAt?: { gte?: Date; lte?: Date };
      } = { dealershipId: session.dealershipId };

      if (technicianId) where.technicianId = technicianId;
      if (action) where.action = action;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const logs = await prisma.auditLog.findMany({
        where,
        include: { technician: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });

      const entries = logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        technicianId: log.technicianId,
        technicianName: log.technician?.name ?? null,
        metadata: parseMetadata(log.metadata),
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
        entryHash: log.entryHash || null,
        promptVersion: log.promptVersion,
      }));

      if (format === 'csv') {
        const header = [
          'id',
          'action',
          'technicianName',
          'entityType',
          'entityId',
          'ipAddress',
          'createdAt',
          'entryHash',
          'promptVersion',
          'metadata',
        ];
        const rows = entries.map((entry) =>
          [
            entry.id,
            entry.action,
            entry.technicianName,
            entry.entityType,
            entry.entityId,
            entry.ipAddress,
            entry.createdAt,
            entry.entryHash,
            entry.promptVersion,
            JSON.stringify(entry.metadata),
          ]
            .map(toCsvValue)
            .join(',')
        );
        const csv = [header.join(','), ...rows].join('\n');
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.csv"`,
          },
        });
      }

      return { logs: entries, count: entries.length };
    },
    { rateLimitKey: 'audit-logs.list', requireManager: true }
  );
}