import { NextResponse } from 'next/server';
import { getSession } from './auth';
import { apiError, FORBIDDEN_ERROR, GENERIC_ERROR, handleRouteError, UNAUTHORIZED_ERROR } from './errors';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from './rate-limit';

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

interface RouteOptions {
  rateLimitKey?: string;
  rateLimit?: RateLimitConfig;
  requireManager?: boolean;
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

  const session = await getSession();
  if (!session) {
    return apiError(UNAUTHORIZED_ERROR, 401);
  }

  if (options.requireManager && session.role !== 'manager') {
    return apiError(FORBIDDEN_ERROR, 403);
  }

  try {
    const result = await handler(session);
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