import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { handleRouteError } from '@/lib/errors';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.me', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  try {
    const session = await getSession();
    return NextResponse.json({ session });
  } catch (error) {
    return handleRouteError(error, 'auth.me');
  }
}