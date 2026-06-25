'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import type { RepairOrder, StoryQualityResult, StoryReviewResult } from '@/types';

interface StoryWorkflowRefs {
  roRef: React.MutableRefObject<RepairOrder | null>;
  generateStorySeqRef: React.MutableRefObject<number>;
  reviewStorySeqRef: React.MutableRefObject<number>;
  storyGenerationInFlightRef: React.MutableRefObject<boolean>;
  storyReviewInFlightRef: React.MutableRefObject<boolean>;
}

interface StoryWorkflowSetters {
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  setGeneratingLineId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsReviewing: React.Dispatch<React.SetStateAction<boolean>>;
  setReviewingLineId: React.Dispatch<React.SetStateAction<string | null>>;
  setLastGeneratedStoryByLine: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStoryQualityByLine: React.Dispatch<React.SetStateAction<Record<string, StoryQualityResult>>>;
  setStoryReviewByLine: React.Dispatch<React.SetStateAction<Record<string, StoryReviewResult>>>;
  setCdkSanitizedByLine: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

/** M21: story generation, review, and Customer Pay template workflow. */
export function useROStoryWorkflow(
  refs: StoryWorkflowRefs,
  setters: StoryWorkflowSetters,
  deps: {
    flushPendingSave: () => Promise<void>;
    applyROUpdate: (
      updater: (ro: RepairOrder) => RepairOrder,
      options?: { immediate?: boolean }
    ) => RepairOrder | null;
    clearLineQualityState: (lineId: string) => void;
    invalidateReviewRequests: () => void;
  }
) {
  const applyCustomerPayTemplate = useCallback(
    async (lineId: string, templateId: string) => {
      await deps.flushPendingSave();
      const latestRO = refs.roRef.current;
      if (!latestRO) return;
      const roId = latestRO.id;
      const line = latestRO.repairLines.find((l) => l.id === lineId);
      if (!line) {
        toast.error('Repair line not found — refresh the RO and try again');
        return;
      }

      deps.clearLineQualityState(lineId);
      deps.invalidateReviewRequests();

      try {
        const result = await api.applyCustomerPayTemplate(roId, lineId, templateId);
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId ? { ...l, warrantyStory: result.warrantyStory, isCustomerPay: true } : l
            ),
          }),
          { immediate: true }
        );
        if (result.cdkSanitized) {
          setters.setCdkSanitizedByLine((prev) => ({ ...prev, [lineId]: true }));
        }
        if (!result.idempotent) {
          toast.success(`"${result.templateTitle}" applied — Customer Pay instant story`);
        }
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Failed to apply Customer Pay template');
      }
    },
    [deps, refs.roRef]
  );

  const clearCustomerPayMode = useCallback(
    async (lineId: string) => {
      await deps.flushPendingSave();
      const latestRO = refs.roRef.current;
      if (!latestRO) return;
      try {
        await api.clearCustomerPayMode(latestRO.id, lineId);
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId ? { ...l, isCustomerPay: false, clearCustomerPay: true } : l
            ),
          }),
          { immediate: true }
        );
        toast.success('Customer Pay mode cleared — warranty AI generation is available');
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Failed to clear Customer Pay mode');
      }
    },
    [deps, refs.roRef]
  );

  const generateStory = useCallback(
    async (lineId: string) => {
      console.log('Generate Story clicked', { lineId });

      if (refs.storyGenerationInFlightRef.current) {
        toast.message('Story generation already in progress…');
        return;
      }

      const seq = ++refs.generateStorySeqRef.current;
      refs.storyGenerationInFlightRef.current = true;
      setters.setGeneratingLineId(lineId);
      setters.setIsGenerating(true);

      try {
        if (refs.storyReviewInFlightRef.current) deps.invalidateReviewRequests();
        await deps.flushPendingSave();

        const latestRO = refs.roRef.current;
        if (!latestRO) {
          toast.error('Repair order not loaded — go back and reopen the line');
          return;
        }

        const targetLine = latestRO.repairLines.find((line) => line.id === lineId);
        if (!targetLine) {
          toast.error('Repair line not found — refresh the RO and try again');
          return;
        }
        if (isCustomerPayRepairLine(targetLine)) {
          toast.error('Clear Customer Pay mode first to generate a warranty story with AI.');
          return;
        }

        deps.clearLineQualityState(lineId);
        deps.invalidateReviewRequests();
        const { warrantyStory, quality, cdkSanitized } = await api.generateStory(latestRO.id, lineId);
        if (seq !== refs.generateStorySeqRef.current) return;
        setters.setLastGeneratedStoryByLine((prev) => ({ ...prev, [lineId]: warrantyStory }));
        if (cdkSanitized) {
          setters.setCdkSanitizedByLine((prev) => ({ ...prev, [lineId]: true }));
        } else {
          setters.setCdkSanitizedByLine((prev) => {
            const next = { ...prev };
            delete next[lineId];
            return next;
          });
        }
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) => (l.id === lineId ? { ...l, warrantyStory } : l)),
          }),
          { immediate: true }
        );
        if (quality) {
          const baseline = (quality.scoredAgainstStory ?? warrantyStory).trim();
          if (baseline === warrantyStory.trim()) {
            setters.setStoryQualityByLine((prev) => ({
              ...prev,
              [lineId]: { ...quality, scoredAgainstStory: baseline },
            }));
          }
        }
        if (cdkSanitized) {
          toast.message('Story cleaned for CDK compatibility');
        }
        toast.success(
          quality
            ? `Warranty story generated — MI 4.3 score: ${quality.score}/100`
            : 'Warranty story generated'
        );
      } catch (error: unknown) {
        if (seq === refs.generateStorySeqRef.current) {
          toast.error(error instanceof Error ? error.message : 'Story generation failed');
        }
      } finally {
        if (seq === refs.generateStorySeqRef.current) {
          refs.storyGenerationInFlightRef.current = false;
          setters.setIsGenerating(false);
          setters.setGeneratingLineId(null);
        }
      }
    },
    [deps, refs, setters]
  );

  const reviewStory = useCallback(
    async (lineId: string) => {
      if (refs.storyReviewInFlightRef.current) return;
      if (refs.storyGenerationInFlightRef.current) {
        toast.error('Wait for story generation to finish before reviewing');
        return;
      }
      await deps.flushPendingSave();
      const latestRO = refs.roRef.current;
      const targetLine = latestRO?.repairLines.find((l) => l.id === lineId);
      if (isCustomerPayRepairLine(targetLine)) {
        toast.message('Customer Pay stories skip AI review — edit the text if needed.');
        return;
      }
      if (!latestRO) return;
      const roId = latestRO.id;
      const storyText = targetLine?.warrantyStory?.trim();
      if (!storyText) {
        toast.error('Write or generate a warranty story before reviewing');
        return;
      }

      deps.clearLineQualityState(lineId);
      const seq = ++refs.reviewStorySeqRef.current;
      refs.storyReviewInFlightRef.current = true;
      setters.setReviewingLineId(lineId);
      setters.setIsReviewing(true);
      try {
        const { review } = await api.reviewStory(roId, lineId, storyText);
        if (seq !== refs.reviewStorySeqRef.current) return;

        const activeRO = refs.roRef.current;
        if (!activeRO || activeRO.id !== roId) {
          toast.success('Review complete — reopen the repair line to view feedback');
          return;
        }

        const activeLine = activeRO.repairLines.find((l) => l.id === lineId);
        const currentStory = activeLine?.warrantyStory?.trim() ?? '';
        if (!currentStory || currentStory !== storyText) return;

        if (review.scoredAgainstStory?.trim() !== storyText) {
          review.scoredAgainstStory = storyText;
        }

        setters.setStoryReviewByLine((prev) => ({ ...prev, [lineId]: review }));
        setters.setStoryQualityByLine((prev) => ({ ...prev, [lineId]: review }));
        toast.success(`MI 4.3 review complete — ${review.score}/100 (${review.grade})`);
      } catch (error: unknown) {
        if (seq === refs.reviewStorySeqRef.current) {
          toast.error(error instanceof Error ? error.message : 'Story review failed');
        }
      } finally {
        if (seq === refs.reviewStorySeqRef.current) {
          refs.storyReviewInFlightRef.current = false;
          setters.setIsReviewing(false);
          setters.setReviewingLineId(null);
        }
      }
    },
    [deps, refs, setters]
  );

  return { applyCustomerPayTemplate, clearCustomerPayMode, generateStory, reviewStory };
}