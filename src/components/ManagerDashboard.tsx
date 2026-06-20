'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ClipboardList,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { DealershipBranding } from '@/components/DealershipBranding';
import { ScanROSection } from '@/components/ScanROSection';
import type { PendingImage } from '@/types';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DashboardSummary, RepairOrder, TechnicianSession } from '@/types';

interface ManagerDashboardProps {
  session: TechnicianSession;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  openingROId: string | null;
  onOpenRO: (target: RepairOrder | string) => void;
  onOpenSettings: () => void;
  onOpenAuditLogs: () => void;
  onOpenServiceAdvisors: () => void;
  pendingROImages: PendingImage[];
  onScanRO: () => void;
  onAddFromGallery: () => void;
  onProcessScan: () => void;
  onClearPendingScan: () => void;
  onCancelScan: () => void;
  onCreateManualRO: () => void;
  isProcessingOCR: boolean;
  ocrProgress: number;
  scanStatusMessage: string;
  children: React.ReactNode;
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

export function ManagerDashboard({
  session,
  searchTerm,
  onSearchChange,
  openingROId,
  onOpenRO,
  onOpenSettings,
  onOpenAuditLogs,
  onOpenServiceAdvisors,
  pendingROImages,
  onScanRO,
  onAddFromGallery,
  onProcessScan,
  onClearPendingScan,
  onCancelScan,
  onCreateManualRO,
  isProcessingOCR,
  ocrProgress,
  scanStatusMessage,
  children,
}: ManagerDashboardProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDashboardSummary();
      setSummary(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const chain = summary?.audit?.chain;
  const isAdmin = session.isAdmin;

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="relative pt-4 mb-5">
        <button
          onClick={onOpenSettings}
          className="absolute top-4 right-0 p-2 text-[#8e8e93] touch-target"
          aria-label="Settings"
        >
          <Settings size={22} />
        </button>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#0a84ff] font-semibold text-center mb-3">
          Manager Dashboard
        </p>
        <DealershipBranding size="md" />
        <p className="text-xs text-[#8e8e93] mt-2 text-center">Signed in as {session.name}</p>
      </div>

      {loading ? (
        <div className="ios-card p-6 text-sm text-[#8e8e93] mb-4">Loading dealership metrics...</div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatCard label="Repair Orders" value={summary.stats.totalRepairOrders} icon={<ClipboardList size={14} />} />
            <StatCard
              label="Warranty Stories"
              value={summary.stats.warrantyStories}
              icon={<Sparkles size={14} />}
              accent="text-[#30d158]"
            />
            <StatCard label="Active Techs" value={summary.stats.activeTechnicians} icon={<Users size={14} />} />
            <StatCard
              label="Audit Events (7d)"
              value={summary.stats.auditEventsThisWeek}
              icon={<Activity size={14} />}
              accent="text-[#ff9f0a]"
            />
          </div>

          <div className="ios-card p-4 mb-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className={chain?.valid ? 'text-[#30d158]' : 'text-[#ff9f0a]'} />
                <div>
                  <div className="font-semibold text-sm">Audit Chain Integrity</div>
                  <div className="text-[10px] text-[#8e8e93]">SHA-256 hash chain per dealership</div>
                </div>
              </div>
              <span className={`status-pill ${chain?.valid ? 'bg-[#30d158]/15 text-[#30d158]' : 'bg-[#ff9f0a]/15 text-[#ff9f0a]'}`}>
                {chain?.valid ? 'VALID' : 'REVIEW'}
              </span>
            </div>
            <p className="text-xs text-[#8e8e93] leading-relaxed mb-3">
              {chain?.description}
              {chain && chain.legacyEntries > 0
                ? ` ${chain.legacyEntries} legacy entr${chain.legacyEntries === 1 ? 'y' : 'ies'} pre-date the hash chain.`
                : ''}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {isAdmin && (
                <Link
                  href="/admin/usage"
                  className="secondary-btn w-full h-10 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <BarChart3 size={14} /> USAGE
                </Link>
              )}
              <button
                onClick={onOpenServiceAdvisors}
                className="secondary-btn w-full h-10 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <UserRound size={14} /> SERVICE ADVISORS
              </button>
              <button
                onClick={onOpenAuditLogs}
                className="secondary-btn w-full h-10 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <ScrollText size={14} /> VIEW AUDIT LOG & EXPORT
              </button>
            </div>
          </div>

          {summary.recentRepairOrders.length > 0 && (
            <div className="ios-card p-4 mb-4">
              <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-3">Recent Shop Activity</div>
              <div className="space-y-2">
                {summary.recentRepairOrders.map((ro) => {
                  const isOpening = openingROId === ro.id;
                  const isBusy = openingROId !== null;
                  return (
                    <button
                      key={ro.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => onOpenRO(ro.id)}
                      className={`w-full text-left bg-[#1c1c1e] rounded-lg px-3 py-2 transition-colors touch-manipulation ${
                        isOpening
                          ? 'ring-2 ring-[#0a84ff]/60 cursor-wait'
                          : isBusy
                            ? 'opacity-60 cursor-not-allowed'
                            : 'active:bg-[#2c2c2e] hover:bg-[#252528] cursor-pointer'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{ro.roNumber}</span>
                        {isOpening ? (
                          <span className="text-[10px] text-[#0a84ff]">Loading…</span>
                        ) : (
                          ro.hasStories && <span className="text-[10px] text-[#30d158]">✓ story</span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#8e8e93]">
                        {[ro.year, ro.make, ro.model].filter(Boolean).join(' ')} · {ro.technicianName}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}

      <ScanROSection
        pendingROImages={pendingROImages}
        isProcessingOCR={isProcessingOCR}
        ocrProgress={ocrProgress}
        scanStatusMessage={scanStatusMessage}
        onScanRO={onScanRO}
        onAddFromGallery={onAddFromGallery}
        onProcessScan={onProcessScan}
        onClearPendingScan={onClearPendingScan}
        onCancelScan={onCancelScan}
        onCreateManualRO={onCreateManualRO}
        scanButtonLabel="SCAN RO"
        compact
      />

      <div className="mb-3">
        <input
          type="text"
          placeholder="Search repair orders (RO#, model, VIN)..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-xl px-4 py-2.5 text-sm placeholder-[#8e8e93]"
        />
      </div>

      {children}
    </div>
  );
}