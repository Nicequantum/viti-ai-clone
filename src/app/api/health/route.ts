import { aggregateHealthStatus, runAllHealthChecks } from '@/lib/healthChecks';
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

  const payload = {
    status,
    version: process.env.npm_package_version || '3.0.0',
    promptVersion: PROMPT_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks,
  };

  const statusCode = status === 'error' ? 503 : 200;
  return Response.json(payload, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}