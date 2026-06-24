import { verifyAuditChain, type AuditChainPayload } from './auditChain';
import { prisma } from './db';

export interface AuditDashboardSummary {
  totalEntries: number;
  last24Hours: number;
  last7Days: number;
  actionCounts: Array<{ action: string; count: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    technicianName: string | null;
    createdAt: string;
  }>;
  chain: {
    enabled: true;
    description: string;
    hashedEntries: number;
    legacyEntries: number;
    valid: boolean;
    brokenAt: number | null;
    headHash: string | null;
    limitations: string[];
  };
}

export async function getAuditDashboardSummary(dealershipId: string): Promise<AuditDashboardSummary> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalEntries, last24Hours, last7Days, grouped, recent, chainLogs] = await Promise.all([
    prisma.auditLog.count({ where: { dealershipId } }),
    prisma.auditLog.count({ where: { dealershipId, createdAt: { gte: dayAgo } } }),
    prisma.auditLog.count({ where: { dealershipId, createdAt: { gte: weekAgo } } }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { dealershipId, createdAt: { gte: weekAgo } },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    }),
    prisma.auditLog.findMany({
      where: { dealershipId },
      include: { technician: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.auditLog.findMany({
      where: { dealershipId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        technicianId: true,
        dealershipId: true,
        metadata: true,
        ipAddress: true,
        previousHash: true,
        entryHash: true,
        promptVersion: true,
        createdAt: true,
      },
    }),
  ]);

  const hashed = chainLogs.filter((l) => l.entryHash);
  const legacyEntries = chainLogs.length - hashed.length;

  const chainPayload: Array<AuditChainPayload & { previousHash: string; entryHash: string }> = hashed.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    technicianId: log.technicianId,
    dealershipId: log.dealershipId,
    metadata: log.metadata,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt.toISOString(),
    previousHash: log.previousHash,
    entryHash: log.entryHash,
    promptVersion: log.promptVersion,
  }));

  const verification = verifyAuditChain(chainPayload);

  return {
    totalEntries,
    last24Hours,
    last7Days,
    actionCounts: grouped.map((g) => ({ action: g.action, count: g._count.action })),
    recentActivity: recent.map((log) => ({
      id: log.id,
      action: log.action,
      technicianName: log.technician?.name ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
    chain: {
      enabled: true,
      description:
        'Each audit entry is SHA-256 linked to the previous entry per dealership. Tampering with a row breaks the chain from that point forward.',
      hashedEntries: hashed.length,
      legacyEntries,
      valid: verification.valid,
      brokenAt: verification.brokenAt,
      headHash: hashed.length > 0 ? hashed[hashed.length - 1].entryHash : null,
      limitations: [
        'Chain verifies append-only integrity — it does not prevent a privileged database admin from rewriting the full table.',
        'Entries created before hash-chain rollout may appear as legacy (no entryHash).',
        'For legal defensibility, pair with database backups, access controls, and exported CSV archives.',
      ],
    },
  };
}