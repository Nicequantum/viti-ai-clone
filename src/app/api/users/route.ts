import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import { hashPassword } from '@/lib/auth';
import { internalEmailForD7 } from '@/lib/d7Number';
import { prisma } from '@/lib/db';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { createUserSchema, parseRequestBody } from '@/lib/validation';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const users = await prisma.technician.findMany({
        where: { dealershipId: session.dealershipId },
        select: {
          id: true,
          d7Number: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          consentAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        users: users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          consentAt: u.consentAt?.toISOString() ?? null,
          deletedAt: u.deletedAt?.toISOString() ?? null,
        })),
      };
    },
    { rateLimitKey: 'users.list', requireManager: true }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createUserSchema);
      if ('error' in parsed) return parsed.error;

      const { d7Number, name, password, role } = parsed.data;

      const existing = await prisma.technician.findUnique({ where: { d7Number } });
      if (existing) {
        return apiError('An account with this D7 number already exists.', 409);
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.technician.create({
        data: {
          d7Number,
          email: internalEmailForD7(d7Number),
          name: name.trim(),
          passwordHash,
          role,
          isActive: true,
          dealershipId: session.dealershipId,
        },
        select: {
          id: true,
          d7Number: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      await writeAuditLog({
        action: 'user.create',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: user.id,
        metadata: { d7Number: user.d7Number, role: user.role },
        ipAddress: getRequestIp(request),
      });

      return {
        user: { ...user, createdAt: user.createdAt.toISOString() },
      };
    },
    { rateLimitKey: 'users.create', requireManager: true }
  );
}