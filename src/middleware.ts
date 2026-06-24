import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isMaintenanceModeEnabled } from '@/lib/env';

const MAINTENANCE_ALLOWLIST = new Set(['/api/health', '/api/status']);

/**
 * Edge middleware — maintenance gate and security response headers.
 * Authentication remains in API route wrappers (withAuth).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (isMaintenanceModeEnabled()) {
    response.headers.set('X-Merlin-Maintenance', '1');
    const isAllowlisted = MAINTENANCE_ALLOWLIST.has(pathname);
    if (!isAllowlisted && pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Merlin is in maintenance mode. Story generation and uploads are paused — try again shortly.' },
        { status: 503, headers: response.headers }
      );
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|apple-|manifest.json).*)'],
};