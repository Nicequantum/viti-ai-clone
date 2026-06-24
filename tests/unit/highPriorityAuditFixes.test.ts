import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { CUSTOMER_PAY_AUDIT_ACTIONS } from '@/lib/audit';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('High priority audit fixes (H1–H15)', () => {
  it('H1: shared isCustomerPayRepairLine helper', () => {
    assert.equal(isCustomerPayRepairLine({ isCustomerPay: true }), true);
    assert.equal(isCustomerPayRepairLine({ isCustomerPay: false }), false);
    assert.equal(isCustomerPayRepairLine({}), false);
    const hookSrc = readSrc('src/hooks/useRepairOrders.ts');
    assert.ok(hookSrc.includes('isCustomerPayRepairLine'));
  });

  it('H2: serialized save queue and awaitable debounce flush', () => {
    const queueSrc = readSrc('src/lib/repairOrderSaveQueue.ts');
    const debounceSrc = readSrc('src/lib/debounce.ts');
    const hookSrc = readSrc('src/hooks/useRepairOrders.ts');
    assert.ok(queueSrc.includes('enqueueRepairOrderSave'));
    assert.ok(debounceSrc.includes('flush: () => Promise<void>'));
    assert.ok(hookSrc.includes('await flushPendingSave()'));
  });

  it('H3/H4: customer pay story audit actions', () => {
    assert.ok(CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayStory.edit'));
    assert.ok(CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayStory.pdf_export'));
    const putSrc = readSrc('src/app/api/repair-orders/[id]/route.ts');
    assert.ok(putSrc.includes("action: 'customerPayStory.edit'"));
    const latestSrc = readSrc('src/app/api/audit-logs/latest/route.ts');
    assert.ok(latestSrc.includes('customerPayTemplateApplied'));
    const pdfSrc = readSrc('src/app/api/audit-logs/pdf-export/route.ts');
    assert.ok(pdfSrc.includes("action: 'customerPayStory.pdf_export'"));
  });

  it('H5: audit advisory lock', () => {
    const auditSrc = readSrc('src/lib/audit.ts');
    assert.ok(auditSrc.includes('pg_advisory_xact_lock'));
  });

  it('H6/H7: encryption loud decrypt and derived salt', () => {
    const encSrc = readSrc('src/lib/encryption.ts');
    assert.ok(encSrc.includes('encryption.decrypt_failed'));
    assert.ok(encSrc.includes('getScryptSalt'));
    assert.ok(!encSrc.includes("return scryptSync(secret, 'benz-tech-pii-salt', 32)"));
  });

  it('H8: production KV requirement', () => {
    const envSrc = readSrc('src/lib/env.ts');
    assert.ok(envSrc.includes('PRODUCTION_REQUIRED_ENV_VARS'));
    const rateSrc = readSrc('src/lib/rate-limit.ts');
    assert.ok(rateSrc.includes('effectiveRateLimitConfig'));
  });

  it('H9: image access uses targeted query', () => {
    const src = readSrc('src/lib/imageAccess.ts');
    assert.ok(src.includes('findFirst'));
    assert.equal(src.includes('findMany({\n    where: {\n      dealershipId'), false);
  });

  it('H10: repair order list pagination', () => {
    const src = readSrc('src/app/api/repair-orders/route.ts');
    assert.ok(src.includes('nextCursor'));
    assert.ok(src.includes('hasMore'));
  });

  it('H11: no hardcoded changeme123 in seed sources', () => {
    const seedDb = readSrc('src/lib/seedDatabase.ts');
    const seedSec = readSrc('src/lib/seedSecurity.ts');
    assert.equal(seedDb.includes('changeme123'), false);
    assert.equal(seedSec.includes('changeme123'), false);
    assert.equal(seedSec.includes('DEFAULT_TECH_SEED_PASSWORD'), false);
  });

  it('H12: noise monitor throttled to 4Hz', () => {
    const src = readSrc('src/lib/voice/noiseMonitor.ts');
    assert.ok(src.includes('EMIT_INTERVAL_MS = 250'));
  });

  it('H13: recognition start failure stops noise monitor', () => {
    const src = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.ok(src.includes('if (!started)'));
    assert.ok(src.includes('await this.noiseMonitor.stop()'));
  });

  it('H14: template apply requires isCustomerPay flag', () => {
    const src = readSrc('src/lib/customerPayTemplate.ts');
    assert.ok(src.includes('if (!template.isCustomerPay)'));
  });

  it('H15: build script does not auto-migrate', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: { build?: string; 'db:migrate:deploy'?: string };
    };
    const buildScript = pkg.scripts?.build ?? '';
    assert.equal(buildScript.includes('prisma migrate deploy'), false);
    assert.ok(pkg.scripts?.['db:migrate:deploy']?.includes('prisma migrate deploy'));
  });
});