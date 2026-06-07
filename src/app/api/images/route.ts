import { streamPrivateBlob } from '@/lib/blob';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR, UNAUTHORIZED_ERROR } from '@/lib/errors';
import { isAllowedImagePathname } from '@/lib/imageUrls';
import { checkRateLimit } from '@/lib/rate-limit';

async function userCanAccessImage(
  session: { technicianId: string; role: string; dealershipId: string },
  pathname: string
): Promise<boolean> {
  const orders = await prisma.repairOrder.findMany({
    where: {
      dealershipId: session.dealershipId,
      ...(session.role === 'manager' ? {} : { technicianId: session.technicianId }),
      OR: [
        { xentryImageUrls: { contains: pathname } },
        { repairLines: { some: { xentryImageUrls: { contains: pathname } } } },
      ],
    },
    select: { id: true },
    take: 1,
  });

  if (orders.length > 0) return true;

  // Allow freshly uploaded images not yet attached to an RO (same dealership session)
  const recentUpload = await prisma.auditLog.findFirst({
    where: {
      action: 'image.upload',
      dealershipId: session.dealershipId,
      technicianId: session.technicianId,
      metadata: { contains: pathname },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  return Boolean(recentUpload);
}

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request, 'images.get');
  if (rateLimited) return rateLimited;

  const session = await getSession(request);
  if (!session) {
    return apiError(UNAUTHORIZED_ERROR, 401);
  }

  const pathname = new URL(request.url).searchParams.get('pathname');
  if (!pathname || !isAllowedImagePathname(pathname)) {
    return apiError(NOT_FOUND_ERROR, 404);
  }

  const allowed = await userCanAccessImage(session, pathname);
  if (!allowed) {
    return apiError(FORBIDDEN_ERROR, 403);
  }

  try {
    const result = await streamPrivateBlob(pathname);
    if (!result) {
      return apiError(NOT_FOUND_ERROR, 404);
    }

    return new Response(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[images]', error);
    return apiError('Unable to load image.', 500);
  }
}