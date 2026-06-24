import { fetchPrivateBlobAsDataUrl } from '@/lib/blob';
import { withAuth } from '@/lib/apiRoute';
import { extractROFromImages } from '@/lib/grok';
import { apiError, FORBIDDEN_ERROR } from '@/lib/errors';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { userCanAccessImage } from '@/lib/imageAccess';
import { extractPathnameFromImageRef, isAllowedImagePathname } from '@/lib/imageUrls';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { imagePathnamesSchema, parseRequestBody } from '@/lib/validation';

/** Must match RO_EXTRACT_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 130;

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, imagePathnamesSchema);
      if ('error' in parsed) return parsed.error;

      const pathnames = parsed.data.imagePathnames.map((ref) => extractPathnameFromImageRef(ref) || ref);

      for (const pathname of pathnames) {
        if (!isAllowedImagePathname(pathname)) {
          return apiError(FORBIDDEN_ERROR, 403);
        }
        const allowed = await userCanAccessImage(session, pathname);
        if (!allowed) {
          return apiError(FORBIDDEN_ERROR, 403);
        }
      }

      const imageDataUrls = await Promise.all(pathnames.map((pathname) => fetchPrivateBlobAsDataUrl(pathname)));
      try {
        const extracted = await extractROFromImages(imageDataUrls);
        return extracted;
      } catch (error) {
        const mapped = mapGrokRouteError(error, 'Repair order scan');
        return apiError(mapped.message, mapped.status);
      }
    },
    {
      rateLimitKey: 'ro.extract',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.ro.extract',
    }
  );
}