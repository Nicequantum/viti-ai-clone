import { NextResponse } from 'next/server';
import manifest from '../manifest';

/** Public manifest for legacy /manifest.json requests (avoids 401 from protected routes). */
export function GET() {
  return NextResponse.json(manifest(), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}