import { NextResponse } from 'next/server';
import { getPwaManifest } from '@/lib/pwaManifest';

/** Public PWA manifest — no session required. */
export function GET() {
  return NextResponse.json(getPwaManifest(), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}