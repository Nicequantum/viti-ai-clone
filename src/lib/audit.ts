import { randomUUID } from 'crypto';
import { PROMPT_VERSION } from '@/prompts/version';
import { prisma } from './db';
import {
  AUDIT_GENESIS_HASH,
  AUDIT_LEGACY_PROMPT_VERSION,
  AUDIT_NON_AI_PROMPT_VERSION,
  computeAuditEntryHash,
} from './auditChain';
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
  | 'story.review'
  | 'story.edit'
  | 'story.pdf_export'
  | 'user.create'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.delete'
  | 'user.password_reset'
  | 'image.upload'
  | 'advisor.resolve'
  | 'advisor.capture'
  | 'template.save';

/** AI warranty story actions must record the active Merlin PROMPT_VERSION for audit defensibility. */
export const STORY_PROMPT_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'story.generate',
  'story.review',
  'story.edit',
  'story.pdf_export',
]);

export interface AuditLogInput {
  action: AuditAction;
  dealershipId: string;
  technicianId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  /**
   * Merlin prompt version stamped on this audit entry.
   * Required on every write — auto-filled for story actions when omitted.
   */
  promptVersion?: string;
}

/**
 * Warranty auditors use promptVersion to prove which Merlin instruction set produced
 * an AI-generated story, review, edit trail, or PDF export at a point in time.
 */
function resolvePromptVersion(input: AuditLogInput): string {
  const explicit = input.promptVersion?.trim();
  if (explicit) return explicit;
  if (STORY_PROMPT_AUDIT_ACTIONS.has(input.action)) return PROMPT_VERSION;
  return AUDIT_NON_AI_PROMPT_VERSION;
}

/** Fail loudly — missing or invalid promptVersion breaks compliance traceability. */
function assertPromptVersionValid(action: AuditAction, promptVersion: string): void {
  if (!promptVersion?.trim()) {
    throw new Error(`Audit log rejected: promptVersion is required for action "${action}"`);
  }

  if (STORY_PROMPT_AUDIT_ACTIONS.has(action)) {
    if (promptVersion === AUDIT_NON_AI_PROMPT_VERSION || promptVersion === AUDIT_LEGACY_PROMPT_VERSION) {
      throw new Error(
        `Audit log rejected: story action "${action}" requires active Merlin prompt version, got "${promptVersion}"`
      );
    }
  }
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const promptVersion = resolvePromptVersion(input);
  assertPromptVersionValid(input.action, promptVersion);

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
        promptVersion,
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
          promptVersion,
          previousHash,
          entryHash,
          createdAt,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Audit log rejected:')) {
      throw error;
    }
    logger.error('audit.write_failed', {
      action: input.action,
      dealershipId: input.dealershipId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}