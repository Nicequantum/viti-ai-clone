import { prisma } from './db';

export const DAILY_USAGE_LIMIT = 50;

function startOfLocalDay(): Date {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day;
}

function startOfLocalWeek(): Date {
  const day = startOfLocalDay();
  const weekday = day.getDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  day.setDate(day.getDate() - daysFromMonday);
  return day;
}

export async function getTechnicianDailyUsageCount(technicianId: string): Promise<number> {
  return prisma.usageLog.count({
    where: {
      technicianId,
      createdAt: { gte: startOfLocalDay() },
    },
  });
}

export async function isDailyUsageLimitReached(technicianId: string): Promise<boolean> {
  const count = await getTechnicianDailyUsageCount(technicianId);
  return count >= DAILY_USAGE_LIMIT;
}

export async function logApiUsage(input: {
  technicianId: string;
  dealershipId: string;
  routeKey: string;
}): Promise<void> {
  await prisma.usageLog.create({
    data: {
      technicianId: input.technicianId,
      dealershipId: input.dealershipId,
      routeKey: input.routeKey,
    },
  });
}

export interface TechnicianUsageSummary {
  technicianId: string;
  name: string;
  d7Number: string;
  role: string;
  dailyCount: number;
  weeklyCount: number;
}

export interface UsageAnalytics {
  dailyLimit: number;
  totalDailyUsage: number;
  technicians: TechnicianUsageSummary[];
}

export async function getUsageAnalytics(dealershipId: string): Promise<UsageAnalytics> {
  const dayStart = startOfLocalDay();
  const weekStart = startOfLocalWeek();

  const [technicians, dailyLogs, weeklyLogs] = await Promise.all([
    prisma.technician.findMany({
      where: { dealershipId, isActive: true },
      select: { id: true, name: true, d7Number: true, role: true },
      orderBy: { name: 'asc' },
    }),
    prisma.usageLog.groupBy({
      by: ['technicianId'],
      where: { dealershipId, createdAt: { gte: dayStart } },
      _count: { _all: true },
    }),
    prisma.usageLog.groupBy({
      by: ['technicianId'],
      where: { dealershipId, createdAt: { gte: weekStart } },
      _count: { _all: true },
    }),
  ]);

  const dailyByTech = new Map(dailyLogs.map((row) => [row.technicianId, row._count._all]));
  const weeklyByTech = new Map(weeklyLogs.map((row) => [row.technicianId, row._count._all]));

  const summaries: TechnicianUsageSummary[] = technicians
    .map((tech) => ({
      technicianId: tech.id,
      name: tech.name,
      d7Number: tech.d7Number,
      role: tech.role,
      dailyCount: dailyByTech.get(tech.id) ?? 0,
      weeklyCount: weeklyByTech.get(tech.id) ?? 0,
    }))
    .sort((a, b) => b.dailyCount - a.dailyCount || b.weeklyCount - a.weeklyCount || a.name.localeCompare(b.name));

  return {
    dailyLimit: DAILY_USAGE_LIMIT,
    totalDailyUsage: summaries.reduce((sum, row) => sum + row.dailyCount, 0),
    technicians: summaries,
  };
}