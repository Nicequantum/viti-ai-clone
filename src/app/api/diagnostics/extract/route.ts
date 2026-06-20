import { fetchPrivateBlobAsDataUrl } from '@/lib/blob';
import { withAuth } from '@/lib/apiRoute';
import { extractDiagnosticsFromImage } from '@/lib/grok';
import { apiError, FORBIDDEN_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { userCanAccessImage } from '@/lib/imageAccess';
import { extractPathnameFromImageRef, isAllowedImagePathname } from '@/lib/imageUrls';
import { imagePathnamesSchema, parseBody } from '@/lib/validation';

/** Must match DIAGNOSTIC_EXTRACT_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 100;

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const body = await request.json();
      const parsed = parseBody(imagePathnamesSchema, body);
      if ('error' in parsed) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const pathname =
        extractPathnameFromImageRef(parsed.data.imagePathnames[0]) || parsed.data.imagePathnames[0];

      if (!isAllowedImagePathname(pathname)) {
        return apiError(FORBIDDEN_ERROR, 403);
      }
      const allowed = await userCanAccessImage(session, pathname);
      if (!allowed) {
        return apiError(FORBIDDEN_ERROR, 403);
      }

      const imageDataUrl = await fetchPrivateBlobAsDataUrl(pathname);
      const extracted = await extractDiagnosticsFromImage(imageDataUrl);
      return extracted;
    },
    { rateLimitKey: 'diagnostics.extract', rateLimit: { limit: 30, windowMs: 60_000 }, trackUsage: true }
  );
}