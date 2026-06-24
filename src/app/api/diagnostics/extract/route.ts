import { fetchPrivateBlobAsDataUrl } from '@/lib/blob';
import { withAuth } from '@/lib/apiRoute';
import { extractDiagnosticsFromImage } from '@/lib/grok';
import { apiError, FORBIDDEN_ERROR } from '@/lib/errors';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { userCanAccessImage } from '@/lib/imageAccess';
import { extractPathnameFromImageRef, isAllowedImagePathname } from '@/lib/imageUrls';
import { imagePathnamesSchema, parseRequestBody } from '@/lib/validation';

/** Must match DIAGNOSTIC_EXTRACT_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 100;

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, imagePathnamesSchema);
      if ('error' in parsed) return parsed.error;

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
      try {
        const extracted = await extractDiagnosticsFromImage(imageDataUrl);
        return extracted;
      } catch (error) {
        const mapped = mapGrokRouteError(error, 'Diagnostic scan');
        return apiError(mapped.message, mapped.status);
      }
    },
    {
      rateLimitKey: 'diagnostics.extract',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.diagnostics.extract',
    }
  );
}