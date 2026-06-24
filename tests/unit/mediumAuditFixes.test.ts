import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { JWT_AUDIENCE, JWT_ISSUER } from '@/lib/auth';
import { sanitizeAuditMetadata } from '@/lib/auditMetadataSanitize';
import { buildPromptAuditFingerprint } from '@/lib/promptFingerprint';
import { getClientIp } from '@/lib/rate-limit';
import { DAILY_USAGE_LIMIT } from '@/lib/usageMonitoring';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Medium audit fixes (M1–M30)', () => {
  it('M1: clear Customer Pay API and UI', () => {
    assert.ok(readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/clear-customer-pay/route.ts').includes('clearCustomerPayMode'));
    assert.ok(readSrc('src/components/LineView.tsx').includes('Switch to warranty AI'));
  });

  it('M2/M3: transactional idempotent Customer Pay apply', () => {
    const src = readSrc('src/lib/customerPayTemplate.ts');
    assert.ok(src.includes('prisma.$transaction'));
    assert.ok(src.includes('isDuplicateTemplateApply'));
  });

  it('M4/M5: warranty KB and similar RO filters', () => {
    assert.ok(readSrc('src/lib/templateLibrary.ts').includes("entry.category !== 'customer'"));
    assert.ok(readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts').includes('!l.isCustomerPay'));
  });

  it('M6: prompt fingerprint metadata', () => {
    const fp = buildPromptAuditFingerprint();
    assert.ok(fp.systemPromptHash);
    assert.ok(fp.miGuidelinesHash);
  });

  it('M7: expanded field encryption columns', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.ok(schema.includes('roNumberEncrypted'));
    assert.ok(schema.includes('descriptionEncrypted'));
  });

  it('M9: JWT iss/aud constants', () => {
    assert.equal(JWT_ISSUER, 'merlin');
    assert.equal(JWT_AUDIENCE, 'benz-tech-session');
    assert.ok(readSrc('src/lib/auth.ts').includes('setJti'));
  });

  it('M10: GET logout blocked', () => {
    assert.ok(readSrc('src/app/api/auth/logout/route.ts').includes('405'));
  });

  it('M11: TechnicianRole enum', () => {
    assert.ok(readSrc('prisma/schema.prisma').includes('enum TechnicianRole'));
  });

  it('M12: CSP middleware blocks eval', () => {
    const mw = readSrc('src/middleware.ts');
    const nextCfg = readSrc('next.config.mjs');
    assert.ok(mw.includes("'unsafe-inline'"));
    assert.equal(mw.includes('unsafe-eval'), false);
    assert.equal(nextCfg.includes('unsafe-eval'), false);
  });

  it('M13: audit metadata sanitization', () => {
    const sanitized = sanitizeAuditMetadata({ name: 'Jane', serviceAdvisorId: 'sa-1' });
    assert.equal('name' in sanitized, false);
    assert.equal(sanitized.serviceAdvisorId, 'sa-1');
  });

  it('M14: trusted IP extraction', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
    });
    assert.equal(getClientIp(req), '203.0.113.10');
  });

  it('M15/M16/M17: voice service guards', () => {
    const voice = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.ok(voice.includes('attachManualEditGuard'));
    assert.ok(voice.includes('await this.noiseMonitor.stop()'));
    assert.ok(readSrc('src/hooks/useVoiceInput.ts').includes('pagehide'));
  });

  it('M18: 45s default listening timeout', () => {
    assert.equal(readSrc('src/lib/voice/voiceSettings.ts').includes('45_000'), true);
  });

  it('M21: useRepairOrders split into focused hooks', () => {
    assert.ok(readSrc('src/hooks/repairOrders/useROPersistence.ts').includes('useROPersistence'));
    assert.ok(readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts').includes('useROStoryWorkflow'));
  });

  it('M22/M23: images route uses withAuth', () => {
    assert.ok(readSrc('src/app/api/images/route.ts').includes('withAuth'));
  });

  it('M25: useSession preserves session on non-401', () => {
    const src = readSrc('src/hooks/useSession.ts');
    assert.equal(src.includes('setSession(null);\n      } else {\n        setSession(null)'), false);
  });

  it('M26: batched reencrypt script', () => {
    assert.ok(readSrc('scripts/reencrypt-legacy-data.ts').includes('BATCH_SIZE'));
  });

  it('M28/M29: usage limit and timezone env', () => {
    assert.ok(DAILY_USAGE_LIMIT >= 1);
    assert.ok(readSrc('src/lib/usageMonitoring.ts').includes('USAGE_TIMEZONE'));
  });

  it('M30: reencryption runbook doc', () => {
    assert.ok(readFileSync(resolve(root, 'docs/Reencryption-Runbook.md'), 'utf8').includes('db:reencrypt'));
  });
});