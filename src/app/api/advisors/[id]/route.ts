import { withAuth } from '@/lib/apiRoute';
import type { AdvisorProfileData } from '@/lib/advisorIntelligence';
import { prisma } from '@/lib/db';
import { decryptPII } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return withAuth(
    request,
    async (session) => {
      const advisor = await prisma.serviceAdvisor.findFirst({
        where: { id, dealershipId: session.dealershipId, status: 'active' },
        include: {
          profile: true,
          observations: {
            orderBy: { observedAt: 'desc' },
            take: 12,
            select: {
              id: true,
              lineLabel: true,
              vehicleFamily: true,
              vehicleMake: true,
              vehicleModel: true,
              observedAt: true,
              complaintTextEncrypted: true,
              repairOrder: { select: { roNumber: true } },
            },
          },
        },
      });

      if (!advisor) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      let profileData: AdvisorProfileData | null = null;
      if (advisor.profile?.profileData) {
        try {
          profileData = JSON.parse(advisor.profile.profileData) as AdvisorProfileData;
        } catch {
          profileData = null;
        }
      }

      return {
        advisor: {
          id: advisor.id,
          displayName: advisor.displayName,
          roCount: advisor.roCount,
          firstSeenAt: advisor.firstSeenAt.toISOString(),
          lastSeenAt: advisor.lastSeenAt.toISOString(),
          profile: advisor.profile
            ? {
                observationCount: advisor.profile.observationCount,
                profileVersion: advisor.profile.profileVersion,
                lastComputedAt: advisor.profile.lastComputedAt?.toISOString() ?? null,
                profileData,
              }
            : null,
          recentObservations: advisor.observations.map((obs) => ({
            id: obs.id,
            lineLabel: obs.lineLabel,
            roNumber: obs.repairOrder.roNumber,
            vehicleFamily: obs.vehicleFamily,
            vehicle: [obs.vehicleMake, obs.vehicleModel].filter(Boolean).join(' '),
            complaint: decryptPII(obs.complaintTextEncrypted),
            observedAt: obs.observedAt.toISOString(),
          })),
        },
      };
    },
    { rateLimitKey: 'advisors.get', requireManager: true }
  );
}