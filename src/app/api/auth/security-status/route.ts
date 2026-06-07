import { checkSeedPasswordSecurity } from '@/lib/seedSecurity';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { handleRouteError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.security-status', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  try {
    const status = await checkSeedPasswordSecurity();
    return Response.json(
      {
        usingDefaultSeedPasswords: status.usingDefaultSeedPasswords,
        warnings: status.warnings,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return handleRouteError(error, 'auth.security-status');
  }
}