import { withAuth } from '@/lib/apiRoute';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const advisors = await prisma.serviceAdvisor.findMany({
        where: { dealershipId: session.dealershipId, status: 'active' },
        orderBy: { lastSeenAt: 'desc' },
        include: {
          profile: {
            select: {
              observationCount: true,
              lastComputedAt: true,
              profileData: true,
            },
          },
        },
      });

      return {
        advisors: advisors.map((advisor) => {
          let typicallyAllCaps = false;
          let commonPhraseCount = 0;
          if (advisor.profile?.profileData) {
            try {
              const data = JSON.parse(advisor.profile.profileData) as {
                formatting?: { typicallyAllCaps?: boolean };
                commonPhrases?: unknown[];
              };
              typicallyAllCaps = Boolean(data.formatting?.typicallyAllCaps);
              commonPhraseCount = data.commonPhrases?.length ?? 0;
            } catch {
              // ignore malformed profile JSON
            }
          }

          return {
            id: advisor.id,
            displayName: advisor.displayName,
            roCount: advisor.roCount,
            firstSeenAt: advisor.firstSeenAt.toISOString(),
            lastSeenAt: advisor.lastSeenAt.toISOString(),
            observationCount: advisor.profile?.observationCount ?? 0,
            profileUpdatedAt: advisor.profile?.lastComputedAt?.toISOString() ?? null,
            typicallyAllCaps,
            commonPhraseCount,
          };
        }),
      };
    },
    { rateLimitKey: 'advisors.list', requireManager: true }
  );
}