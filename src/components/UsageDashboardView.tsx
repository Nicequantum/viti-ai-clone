'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, Users } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { UsageAnalytics } from '@/types';
import { DealershipBranding } from '@/components/DealershipBranding';

interface UsageDashboardViewProps {
  dealershipName: string;
  onBackHref?: string;
}

function StatCard({
  label,
  value,
  icon,
  accent = 'text-[#0a84ff]',
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="stat-card p-4">
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-[#8e8e93] mb-2 ${accent}`}>
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function UsageDashboardView({ dealershipName, onBackHref = '/' }: UsageDashboardViewProps) {
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getUsageAnalytics();
      setAnalytics(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load usage analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  return (
    <div className="app-container px-4 pt-2 pb-8">
      <div className="relative pt-4 mb-5">
        <Link href={onBackHref} className="absolute top-4 left-0 p-2 text-[#8e8e93] touch-target" aria-label="Back">
          <ArrowLeft size={22} />
        </Link>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#0a84ff] font-semibold text-center mb-3">
          Usage Analytics
        </p>
        <DealershipBranding size="md" />
        <p className="text-xs text-[#8e8e93] mt-2 text-center">{dealershipName}</p>
      </div>

      {loading ? (
        <div className="ios-card p-6 text-sm text-[#8e8e93]">Loading usage metrics...</div>
      ) : analytics ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatCard
              label="Today's AI Calls"
              value={analytics.totalDailyUsage}
              icon={<Activity size={14} />}
            />
            <StatCard
              label="Daily Limit"
              value={analytics.dailyLimit}
              icon={<BarChart3 size={14} />}
              accent="text-[#ff9f0a]"
            />
          </div>

          <div className="ios-card p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-[#0a84ff]" />
              <div>
                <div className="font-semibold text-sm">Technician Usage</div>
                <div className="text-[10px] text-[#8e8e93]">Sorted by today&apos;s AI API calls</div>
              </div>
            </div>

            {analytics.technicians.length === 0 ? (
              <p className="text-sm text-[#8e8e93]">No usage recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {analytics.technicians.map((tech) => {
                  const atLimit = tech.dailyCount >= analytics.dailyLimit;
                  return (
                    <div key={tech.technicianId} className="bg-[#1c1c1e] rounded-lg px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{tech.name}</div>
                          <div className="text-[10px] text-[#8e8e93]">
                            {tech.d7Number} · {tech.role}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-semibold ${atLimit ? 'text-[#ff453a]' : 'text-[#30d158]'}`}>
                            {tech.dailyCount} today
                          </div>
                          <div className="text-[10px] text-[#8e8e93]">{tech.weeklyCount} this week</div>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 bg-[#2c2c2e] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${atLimit ? 'bg-[#ff453a]' : 'bg-[#0a84ff]'}`}
                          style={{
                            width: `${Math.min(100, (tech.dailyCount / analytics.dailyLimit) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[10px] text-[#8e8e93] leading-relaxed px-1">
            Tracks AI extraction and warranty story API calls. Each technician is limited to {analytics.dailyLimit}{' '}
            requests per day.
          </p>
        </>
      ) : null}
    </div>
  );
}