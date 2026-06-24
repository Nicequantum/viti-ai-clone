import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Routes that must stay public (no session) — login page, auth bootstrap, PWA manifest. */
const PUBLIC_PATHS = new Set([
  '/',
  '/manifest.json',
  '/manifest.webmanifest',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** Internal dealership tool — permissive script CSP so Next.js inline bootstrap always runs. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob: https://api.x.ai https://*.google.com https://*.gstatic.com wss://*.google.com",
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth is enforced per API route (withAuth). Middleware only applies CSP and marks public paths.
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (isPublicPath(pathname)) {
    response.headers.set('x-merlin-public-route', '1');
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};