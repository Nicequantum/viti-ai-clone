import { prisma } from './db';
import { extractPathnameFromImageRef } from './imageUrls';

export type ImageAccessSession = {
  technicianId: string;
  role: string;
  dealershipId: string;
};

function pathnamesFromImageJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return extractPathnameFromImageRef(item);
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          if (typeof record.pathname === 'string') {
            return record.pathname;
          }
          if (typeof record.url === 'string') {
            return extractPathnameFromImageRef(record.url);
          }
        }
        return null;
      })
      .filter((pathname): pathname is string => Boolean(pathname));
  } catch {
    return [];
  }
}

function imageJsonContainsPathname(raw: string, pathname: string): boolean {
  return pathnamesFromImageJson(raw).includes(pathname);
}

/** True when the session may read this private blob (RO attachment or recent own upload). */
export async function userCanAccessImage(
  session: ImageAccessSession,
  pathname: string
): Promise<boolean> {
  const orders = await prisma.repairOrder.findMany({
    where: {
      dealershipId: session.dealershipId,
      ...(session.role === 'manager' ? {} : { technicianId: session.technicianId }),
    },
    select: {
      xentryImageUrls: true,
      repairLines: { select: { xentryImageUrls: true } },
    },
  });

  for (const order of orders) {
    if (imageJsonContainsPathname(order.xentryImageUrls, pathname)) {
      return true;
    }
    for (const line of order.repairLines) {
      if (imageJsonContainsPathname(line.xentryImageUrls, pathname)) {
        return true;
      }
    }
  }

  // Allow freshly uploaded images not yet attached to an RO (same dealership session)
  const recentUploads = await prisma.auditLog.findMany({
    where: {
      action: 'image.upload',
      dealershipId: session.dealershipId,
      technicianId: session.technicianId,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    select: { metadata: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  for (const entry of recentUploads) {
    try {
      const metadata = JSON.parse(entry.metadata) as { pathname?: string };
      if (metadata.pathname === pathname) {
        return true;
      }
    } catch {
      // ignore malformed audit metadata
    }
  }

  return false;
}

/** Returns the first pathname the session may not attach, or null when all are allowed. */
export async function findForbiddenImagePathname(
  session: ImageAccessSession,
  pathnames: string[]
): Promise<string | null> {
  const unique = [...new Set(pathnames.filter(Boolean))];
  for (const pathname of unique) {
    const allowed = await userCanAccessImage(session, pathname);
    if (!allowed) {
      return pathname;
    }
  }
  return null;
}

export function collectRepairOrderImagePathnames(input: {
  xentryImages?: Array<{ pathname: string }>;
  repairLines?: Array<{ xentryImages?: Array<{ pathname: string }> }>;
}): string[] {
  const pathnames: string[] = [];
  for (const image of input.xentryImages || []) {
    if (image.pathname) pathnames.push(image.pathname);
  }
  for (const line of input.repairLines || []) {
    for (const image of line.xentryImages || []) {
      if (image.pathname) pathnames.push(image.pathname);
    }
  }
  return pathnames;
}