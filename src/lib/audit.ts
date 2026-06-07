import { prisma } from './db';

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'consent.accept'
  | 'ro.create'
  | 'ro.update'
  | 'ro.delete'
  | 'story.generate'
  | 'story.edit'
  | 'user.create'
  | 'user.deactivate'
  | 'user.reactivate'
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
    await prisma.auditLog.create({
      data: {
        action: input.action,
        dealershipId: input.dealershipId,
        technicianId: input.technicianId,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: JSON.stringify(input.metadata ?? {}),
        ipAddress: input.ipAddress,
      },
    });
  } catch (error) {
    console.error('[audit]', error);
  }
}