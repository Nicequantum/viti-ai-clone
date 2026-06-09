'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Sparkles,
  Type,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { AdvisorDetail, AdvisorListItem } from '@/types';

interface ServiceAdvisorsViewProps {
  onBack: () => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function AdvisorDetailPanel({ advisor }: { advisor: AdvisorDetail }) {
  const profile = advisor.profile?.profileData;
  const formatting = profile?.formatting;
  const affinities = profile
    ? Object.entries(profile.vehicleAffinities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-4">
      <div className="ios-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{advisor.displayName}</div>
            <div className="text-xs text-[#8e8e93] mt-1">
              {advisor.roCount} linked RO{advisor.roCount === 1 ? '' : 's'} · First seen{' '}
              {formatDate(advisor.firstSeenAt)}
            </div>
          </div>
          <span className="status-pill bg-[#0a84ff]/15 text-[#0a84ff]">
            {advisor.profile?.observationCount ?? 0} obs
          </span>
        </div>
      </div>

      {formatting && (
        <div className="ios-card p-4">
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-3">Writing Style</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-[#1c1c1e] rounded-lg p-3">
              <div className="text-[10px] text-[#8e8e93] uppercase">Avg length</div>
              <div className="font-medium mt-1">{formatting.avgComplaintLength || '—'} chars</div>
            </div>
            <div className="bg-[#1c1c1e] rounded-lg p-3">
              <div className="text-[10px] text-[#8e8e93] uppercase">Complaints / RO</div>
              <div className="font-medium mt-1">{formatting.avgComplaintsPerRo || '—'}</div>
            </div>
            <div className="bg-[#1c1c1e] rounded-lg p-3">
              <div className="text-[10px] text-[#8e8e93] uppercase">Letter labels</div>
              <div className="font-medium mt-1">{formatting.usesLetterLabels ? 'Yes' : 'No'}</div>
            </div>
            <div className="bg-[#1c1c1e] rounded-lg p-3">
              <div className="text-[10px] text-[#8e8e93] uppercase">ALL CAPS</div>
              <div className="font-medium mt-1">{formatting.typicallyAllCaps ? 'Usually' : 'Mixed'}</div>
            </div>
          </div>
        </div>
      )}

      {profile && profile.commonPhrases.length > 0 && (
        <div className="ios-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#8e8e93] mb-3">
            <Type size={14} />
            Common Phrases
          </div>
          <div className="space-y-2">
            {profile.commonPhrases.slice(0, 8).map((phrase) => (
              <div key={phrase.text} className="flex justify-between gap-3 bg-[#1c1c1e] rounded-lg px-3 py-2">
                <span className="text-sm">{phrase.text}</span>
                <span className="text-[10px] text-[#8e8e93] shrink-0">{phrase.count}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {affinities.length > 0 && (
        <div className="ios-card p-4">
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-3">Vehicle Families</div>
          <div className="flex flex-wrap gap-2">
            {affinities.map(([family, weight]) => (
              <span
                key={family}
                className="status-pill bg-[#30d158]/10 text-[#30d158]"
              >
                {family} {Math.round(weight * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {advisor.recentObservations.length > 0 && (
        <div className="ios-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#8e8e93] mb-3">
            <ClipboardList size={14} />
            Recent Complaints
          </div>
          <div className="space-y-2">
            {advisor.recentObservations.map((obs) => (
              <div key={obs.id} className="bg-[#1c1c1e] rounded-lg px-3 py-2.5">
                <div className="flex justify-between items-center gap-2 mb-1">
                  <span className="text-[10px] text-[#0a84ff] font-semibold">
                    RO {obs.roNumber}
                    {obs.lineLabel ? ` · Line ${obs.lineLabel}` : ''}
                  </span>
                  <span className="text-[10px] text-[#8e8e93]">{formatDate(obs.observedAt)}</span>
                </div>
                <div className="text-sm leading-snug">{obs.complaint}</div>
                {obs.vehicle && (
                  <div className="text-[10px] text-[#8e8e93] mt-1">{obs.vehicle}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ios-card p-4 border border-[#0a84ff]/20">
        <div className="flex items-center gap-2 text-[#0a84ff] text-sm font-medium mb-2">
          <Sparkles size={16} />
          Active in story generation
        </div>
        <p className="text-xs text-[#8e8e93] leading-relaxed">
          When a technician generates a warranty story on an RO linked to this advisor, the AI uses this
          profile to match how the advisor phrases customer concerns — while keeping all diagnostic facts
          audit-safe.
        </p>
      </div>
    </div>
  );
}

export function ServiceAdvisorsView({ onBack }: ServiceAdvisorsViewProps) {
  const [advisors, setAdvisors] = useState<AdvisorListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdvisorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAdvisors = useCallback(async () => {
    setLoading(true);
    try {
      const { advisors: list } = await api.listAdvisors();
      setAdvisors(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load service advisors');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const { advisor } = await api.getAdvisor(id);
      setDetail(advisor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load advisor profile');
      setSelectedId(null);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdvisors();
  }, [loadAdvisors]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const selectedAdvisor = advisors.find((a) => a.id === selectedId);

  return (
    <div className="px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => {
            if (selectedId) {
              setSelectedId(null);
              return;
            }
            onBack();
          }}
          className="p-2 -ml-2 text-[#0a84ff] touch-target"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#0a84ff] font-semibold">
            Advisor Intelligence
          </div>
          <h1 className="text-xl font-semibold">
            {selectedAdvisor ? selectedAdvisor.displayName : 'Service Advisors'}
          </h1>
          <p className="text-xs text-[#8e8e93] mt-0.5">
            {selectedAdvisor
              ? 'Writing profile & captured complaints'
              : 'Learn how each advisor writes — so stories match their style'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="ios-card p-6 text-sm text-[#8e8e93]">Loading advisors...</div>
      ) : selectedId ? (
        detailLoading || !detail ? (
          <div className="ios-card p-6 text-sm text-[#8e8e93]">Loading profile...</div>
        ) : (
          <AdvisorDetailPanel advisor={detail} />
        )
      ) : advisors.length === 0 ? (
        <div className="ios-card p-6 text-center">
          <UserRound size={32} className="mx-auto text-[#8e8e93] mb-3" />
          <p className="text-sm text-[#8e8e93]">No service advisors captured yet.</p>
          <p className="text-xs text-[#8e8e93] mt-2 leading-relaxed">
            Scan repair orders that show a Service Advisor name in the header. Profiles build
            automatically in the background.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {advisors.map((advisor) => (
            <button
              key={advisor.id}
              onClick={() => setSelectedId(advisor.id)}
              className="ios-card w-full p-4 text-left active:bg-[#252528] flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{advisor.displayName}</div>
                <div className="text-[10px] text-[#8e8e93] mt-1">
                  {advisor.roCount} RO{advisor.roCount === 1 ? '' : 's'} · {advisor.observationCount}{' '}
                  complaint{advisor.observationCount === 1 ? '' : 's'}
                  {advisor.typicallyAllCaps ? ' · ALL CAPS' : ''}
                </div>
                <div className="text-[10px] text-[#8e8e93]">
                  Last seen {formatDate(advisor.lastSeenAt)}
                </div>
              </div>
              <ChevronRight size={18} className="text-[#8e8e93] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}