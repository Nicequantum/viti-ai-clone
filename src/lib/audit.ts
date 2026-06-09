import { randomUUID } from 'crypto';
import { prisma } from './db';
import { AUDIT_GENESIS_HASH, computeAuditEntryHash } from './auditChain';
import { logger } from './logger';

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.password_change'
  | 'consent.accept'
  | 'ro.create'
  | 'ro.update'
  | 'ro.delete'
  | 'story.generate'
  | 'story.edit'
  | 'user.create'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.password_reset'
  | 'image.upload';

interface AuditLogInput {
  action: AuditAction;
  dealershipId: string;
  technicianId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const metadata = JSON.stringify(input.metadata ?? {});
    const createdAt = new Date();

    await prisma.$transaction(async (tx) => {
      const last = await tx.auditLog.findFirst({
        where: { dealershipId: input.dealershipId },
        orderBy: { createdAt: 'desc' },
        select: { entryHash: true },
      });

      const previousHash = last?.entryHash || AUDIT_GENESIS_HASH;
      const id = randomUUID();
      const entryHash = computeAuditEntryHash({
        id,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        technicianId: input.technicianId ?? null,
        dealershipId: input.dealershipId,
        metadata,
        ipAddress: input.ipAddress ?? null,
        createdAt: createdAt.toISOString(),
        previousHash,
      });

      await tx.auditLog.create({
        data: {
          id,
          action: input.action,
          dealershipId: input.dealershipId,
          technicianId: input.technicianId,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata,
          ipAddress: input.ipAddress,
          previousHash,
          entryHash,
          createdAt,
        },
      });
    });
  } catch (error) {
    logger.error('audit.write_failed', {
      action: input.action,
      dealershipId: input.dealershipId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}