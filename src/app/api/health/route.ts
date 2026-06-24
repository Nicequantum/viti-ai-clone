import { aggregateHealthStatus, runAllHealthChecks } from '@/lib/healthChecks';
import { getRuntimeConfig } from '@/lib/env';
import { logger } from '@/lib/logger';
import { PROMPT_VERSION } from '@/prompts/version';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET() {
  const checks = await runAllHealthChecks();
  const status = aggregateHealthStatus(checks);

  if (status === 'error') {
    logger.warn('health.degraded', {
      status,
      failed: Object.entries(checks)
        .filter(([, c]) => c.status === 'error')
        .map(([name, c]) => ({ name, detail: c.detail })),
    });
  }

  const config = getRuntimeConfig(PROMPT_VERSION);
  const services = {
    database: checks.database?.status ?? 'error',
    grok: checks.grok?.status ?? 'error',
    voice: checks.voice?.status ?? 'warn',
    blob: checks.blob?.status ?? 'warn',
    kv: checks.kv?.status ?? 'warn',
    maintenance: checks.maintenance?.status ?? 'ok',
  };

  const payload = {
    status,
    version: config.appVersion,
    promptVersion: PROMPT_VERSION,
    buildCommit: config.buildCommit,
    buildDate: config.buildDate,
    maintenanceMode: config.maintenanceMode,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    services,
    checks,
  };

  const statusCode = status === 'error' ? 503 : 200;
  return Response.json(payload, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}