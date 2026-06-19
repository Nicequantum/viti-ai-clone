import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import { revokeTechnicianSessions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, NOT_FOUND_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { parseBody, updateUserSchema } from '@/lib/validation';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return withAuth(
    request,
    async (session) => {
      const body = await request.json();
      const parsed = parseBody(updateUserSchema, body);
      if ('error' in parsed) {
        return apiError(VALIDATION_ERROR, 400);
      }

      if (id === session.technicianId && !parsed.data.isActive) {
        return apiError('You cannot deactivate your own account.', 400);
      }

      const user = await prisma.technician.findFirst({
        where: { id, dealershipId: session.dealershipId },
      });

      if (!user) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const updated = await prisma.technician.update({
        where: { id },
        data: { isActive: parsed.data.isActive },
        select: {
          id: true,
          d7Number: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (!parsed.data.isActive) {
        await revokeTechnicianSessions(updated.id);
      }

      await writeAuditLog({
        action: parsed.data.isActive ? 'user.reactivate' : 'user.deactivate',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: updated.id,
        metadata: { d7Number: updated.d7Number },
        ipAddress: getRequestIp(request),
      });

      return {
        user: { ...updated, createdAt: updated.createdAt.toISOString() },
      };
    },
    { rateLimitKey: 'users.update', requireManager: true }
  );
}