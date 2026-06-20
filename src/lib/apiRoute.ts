import { NextResponse } from 'next/server';
import { getSession } from './auth';
import {
  apiError,
  CONSENT_REQUIRED_ERROR,
  DAILY_USAGE_LIMIT_ERROR,
  FORBIDDEN_ERROR,
  GENERIC_ERROR,
  handleRouteError,
  UNAUTHORIZED_ERROR,
} from './errors';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from './rate-limit';
import { isDailyUsageLimitReached, logApiUsage } from './usageMonitoring';

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

interface RouteOptions {
  rateLimitKey?: string;
  rateLimit?: RateLimitConfig;
  requireManager?: boolean;
  requireAdmin?: boolean;
  /** Count toward per-technician daily AI usage (50/day) and persist to UsageLog. */
  trackUsage?: boolean;
  /** When true, allow the route before privacy consent is recorded (e.g. POST /api/consent). */
  skipConsent?: boolean;
}

export async function withAuth<T>(
  request: Request,
  handler: (session: Session) => Promise<T>,
  options: RouteOptions = {}
): Promise<NextResponse | Response> {
  const rateLimited = await checkRateLimit(
    request,
    options.rateLimitKey || 'api',
    options.rateLimit || RATE_LIMITS.default
  );
  if (rateLimited) return rateLimited;

  const session = await getSession(request);
  if (!session) {
    return apiError(UNAUTHORIZED_ERROR, 401);
  }

  if (options.requireManager && session.role !== 'manager') {
    return apiError(FORBIDDEN_ERROR, 403);
  }

  if (options.requireAdmin && !session.isAdmin) {
    return apiError(FORBIDDEN_ERROR, 403);
  }

  if (!options.skipConsent && !session.consentAt) {
    return apiError(CONSENT_REQUIRED_ERROR, 403);
  }

  const usageRouteKey = options.rateLimitKey || 'api';

  if (options.trackUsage) {
    const limitReached = await isDailyUsageLimitReached(session.technicianId);
    if (limitReached) {
      return apiError(DAILY_USAGE_LIMIT_ERROR, 429);
    }
  }

  try {
    const result = await handler(session);
    const isSuccessResponse =
      !(result instanceof NextResponse || result instanceof Response) ||
      (result.status >= 200 && result.status < 300);
    if (options.trackUsage && isSuccessResponse) {
      await logApiUsage({
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
        routeKey: usageRouteKey,
      });
    }
    if (result instanceof NextResponse || result instanceof Response) {
      return result;
    }
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, options.rateLimitKey || 'api');
  }
}

export async function withPublicRoute<T>(
  request: Request,
  handler: () => Promise<T>,
  options: RouteOptions = {}
): Promise<NextResponse | Response> {
  const rateLimited = await checkRateLimit(
    request,
    options.rateLimitKey || 'public',
    options.rateLimit || RATE_LIMITS.default
  );
  if (rateLimited) return rateLimited;

  try {
    const result = await handler();
    if (result instanceof NextResponse || result instanceof Response) {
      return result;
    }
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, options.rateLimitKey || 'public');
  }
}

export function jsonError(message: string, status: number): NextResponse {
  return apiError(message, status);
}

export { GENERIC_ERROR };