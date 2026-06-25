'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Loader2,
  Shield,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';
import type { StoryQualityResult, StoryReviewResult } from '@/types';

interface StoryQualityPanelProps {
  quality: StoryQualityResult;
  review?: StoryReviewResult | null;
  panelKey: string;
}

interface StoryQualityLoadingProps {
  mode: 'generating' | 'scoring' | 'reviewing';
  statusMessage?: string;
  progress?: number;
}

interface StoryQualityStaleProps {
  onAudit?: () => void;
}

const GRADE_LABELS: Record<StoryQualityResult['grade'], string> = {
  excellent: 'MI 2.0 Ready',
  strong: 'Strong — Minor Polish',
  'needs-work': 'Needs Work',
  'at-risk': 'At Risk',
};

const FIELD_LABELS: Record<string, string> = {
  technicianNotes: 'Technician Notes',
  customerConcern: 'Customer Concern',
  diagnostic: 'Diagnostic Evidence',
  workflow: 'Workflow Steps',
};

function scoreTier(score: number): 'excellent' | 'strong' | 'needs-work' | 'at-risk' {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'needs-work';
  return 'at-risk';
}

function scoreRingClass(score: number): string {
  const tier = scoreTier(score);
  return `benz-score-${tier}`;
}

export function StoryQualityLoadingPanel({ mode, statusMessage, progress = 0 }: StoryQualityLoadingProps) {
  const title =
    mode === 'generating' ? 'Generating Story' : mode === 'scoring' ? 'MI Quality Audit' : 'AI Review Coaching';
  const label =
    statusMessage ??
    (mode === 'generating'
      ? 'Writing your warranty narrative…'
      : mode === 'scoring'
        ? 'Scoring story against MI 2.0 audit criteria…'
        : 'Generating detailed coaching feedback…');

  return (
    <div className="benz-card p-4">
      <div className="flex items-center gap-3.5">
        <Loader2 size={22} className="animate-spin text-benz-blue shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="benz-section-title">{title}</div>
          <p className="text-sm text-benz-silver mt-1">{label}</p>
        </div>
      </div>
      {mode === 'generating' && progress > 0 && (
        <div className="benz-gen-progress mt-3" aria-hidden>
          <div className="benz-gen-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function StoryQualityStaleBanner({ onAudit }: StoryQualityStaleProps) {
  return (
    <div className="benz-card p-4 benz-alert-warn flex items-start gap-3">
      <AlertTriangle size={20} className="text-benz-amber shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-widest font-semibold text-benz-amber">Score Outdated</div>
        <p className="text-sm text-benz-silver mt-1 leading-snug">
          This story was edited after the last audit. Run Audit Story to refresh the MI quality score.
        </p>
        {onAudit && (
          <button type="button" onClick={onAudit} className="mt-2.5 text-xs benz-link font-medium">
            Audit Story →
          </button>
        )}
      </div>
    </div>
  );
}

export function StoryQualityPanel({ quality, review, panelKey }: StoryQualityPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showReviewDetail, setShowReviewDetail] = useState(!!review);

  useEffect(() => {
    setExpanded(true);
    setShowReviewDetail(!!review);
  }, [panelKey, review]);

  const ringClass = scoreRingClass(quality.score);

  return (
    <div className="benz-card p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3.5 text-left"
      >
        <div
          className={`shrink-0 w-14 h-14 rounded-2xl border flex flex-col items-center justify-center ${ringClass}`}
        >
          <span className="text-xl font-bold leading-none">{quality.score}</span>
          <span className="text-xs text-benz-secondary mt-0.5">/ 100</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Shield size={14} className="text-benz-blue" />
            <span className="benz-section-title">MI 2.0 Quality Score</span>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${ringClass}`}>
              {GRADE_LABELS[quality.grade]}
            </span>
          </div>
          <p className="text-sm text-benz-silver mt-1.5 leading-snug">{quality.summary}</p>
        </div>
        {expanded ? (
          <ChevronUp size={18} className="text-benz-secondary shrink-0 mt-1" />
        ) : (
          <ChevronDown size={18} className="text-benz-secondary shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 benz-divider pt-4">
          {quality.technicianDetails.length > 0 && (
            <div className="benz-alert-info rounded-xl p-3.5 border">
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-blue mb-2 flex items-center gap-1.5">
                <Wrench size={12} /> Add Technician Details
              </div>
              <p className="text-xs text-benz-secondary mb-3 leading-snug">
                MI 4.3 flagged these specific gaps. Add the missing details to your notes or story before submission.
              </p>
              <ul className="space-y-3">
                {quality.technicianDetails.map((detail, index) => (
                  <li key={`${detail.missing}-${index}`} className="text-xs leading-relaxed">
                    <div className="flex items-start gap-2">
                      <ClipboardList size={14} className="text-benz-blue shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-benz-amber">{detail.missing}</div>
                        <div className="text-benz-silver mt-0.5">{detail.prompt}</div>
                        <div className="text-xs text-benz-muted mt-1">
                          Add to: {FIELD_LABELS[detail.field] || detail.field}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.strengths.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-green mb-2 flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Strengths
              </div>
              <ul className="space-y-1.5">
                {quality.strengths.map((item) => (
                  <li key={item} className="text-xs text-benz-silver leading-relaxed pl-3 border-l-2 border-benz-green/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.improvements.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-amber mb-2 flex items-center gap-1.5">
                <Target size={12} /> Improve for MI 2.0
              </div>
              <ul className="space-y-1.5">
                {quality.improvements.map((item) => (
                  <li key={item} className="text-xs text-benz-silver leading-relaxed pl-3 border-l-2 border-benz-amber/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.auditRisks.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-red mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} /> Audit Risks
              </div>
              <ul className="space-y-1.5">
                {quality.auditRisks.map((item) => (
                  <li key={item} className="text-xs text-benz-red/90 leading-relaxed pl-3 border-l-2 border-benz-red/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review && (
            <div>
              <button
                type="button"
                onClick={() => setShowReviewDetail((v) => !v)}
                className="text-xs uppercase tracking-wider font-semibold text-benz-blue flex items-center gap-1.5 mb-2"
              >
                <Sparkles size={12} />
                AI Review Coaching {showReviewDetail ? '▾' : '▸'}
              </button>
              {showReviewDetail && (
                <div className="space-y-3 benz-list-row p-3.5">
                  {review.priorityActions.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-benz-blue mb-1.5">Priority actions</div>
                      <ol className="list-decimal list-inside space-y-1">
                        {review.priorityActions.map((action) => (
                          <li key={action} className="text-xs text-benz-silver leading-relaxed">
                            {action}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <ReviewSection title="Structure (3 C's)" text={review.feedback.structure} />
                  <ReviewSection title="Technical Detail" text={review.feedback.technicalDetail} />
                  <ReviewSection title="Clarity" text={review.feedback.clarity} />
                  <ReviewSection title="Workflow" text={review.feedback.workflow} />
                  <ReviewSection title="Fabrication Risk" text={review.feedback.fabricationRisk} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewSection({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-benz-secondary mb-0.5">{title}</div>
      <p className="text-xs text-benz-silver leading-relaxed">{text}</p>
    </div>
  );
}