'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import { runDiagnosticOCR } from '@/services/ocr';
import type {
  AppView,
  ExtractedData,
  ImageAttachment,
  RepairLine,
  RepairOrder,
  StoryQualityResult,
  StoryReviewResult,
  TechnicianSession,
} from '@/types';
import {
  emptyExtractedData,
  formatExtractionAsOcrText,
  mergeExtracted,
  normalizeExtractedData,
  parseDiagnosticExtraction,
  rebuildExtractedFromOcrTexts,
} from '@/utils/diagnosticParser';


import { useROComplaints } from '@/hooks/repairOrders/useROComplaints';
import { useROList } from '@/hooks/repairOrders/useROList';
import { useROPersistence } from '@/hooks/repairOrders/useROPersistence';
import { useROScan } from '@/hooks/repairOrders/useROScan';
import { useROSearch } from '@/hooks/repairOrders/useROSearch';
import { useROStoryWorkflow } from '@/hooks/repairOrders/useROStoryWorkflow';
import {
  createManualRepairOrder,
  createNewRepairLine,
  ensureComplaintIds,
} from '@/utils/repairOrderFactory';
import { uploadFileAsAttachment } from '@/utils/uploadHelpers';

interface UseRepairOrdersOptions {
  session: TechnicianSession | null;
  onOcrStart: (message?: string) => void;
  onOcrFinish: () => void;
  setOcrProgress: (p: number) => void;
  setScanStatusMessage: (message: string) => void;
}

export function useRepairOrders({
  session,
  onOcrStart,
  onOcrFinish,
  setOcrProgress,
  setScanStatusMessage,
}: UseRepairOrdersOptions) {
  const [view, setView] = useState<AppView>('home');
  const [currentRO, setCurrentRO] = useState<RepairOrder | null>(null);
  const [currentLineId, setCurrentLineId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingLineId, setGeneratingLineId] = useState<string | null>(null);
  const [lastGeneratedStoryByLine, setLastGeneratedStoryByLine] = useState<Record<string, string>>({});
  const [cdkSanitizedByLine, setCdkSanitizedByLine] = useState<Record<string, boolean>>({});
  const [storyQualityByLine, setStoryQualityByLine] = useState<Record<string, StoryQualityResult>>({});
  const [storyReviewByLine, setStoryReviewByLine] = useState<Record<string, StoryReviewResult>>({});
  const [isScoring, setIsScoring] = useState(false);
  const [scoringLineId, setScoringLineId] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewingLineId, setReviewingLineId] = useState<string | null>(null);
  const [openingROId, setOpeningROId] = useState<string | null>(null);
  const roRef = useRef<RepairOrder | null>(null);
  const openingROInFlightRef = useRef<string | null>(null);
  const generateStorySeqRef = useRef(0);
  const storyGenerationInFlightRef = useRef(false);
  const scoreStorySeqRef = useRef(0);
  const storyScoringInFlightRef = useRef(false);
  const reviewStorySeqRef = useRef(0);
  const storyReviewInFlightRef = useRef(false);

  useEffect(() => {
    roRef.current = currentRO;
  }, [currentRO]);

  const {
    allROs,
    setAllROs,
    loading,
    listError,
    listRetrying,
    retryListLoad,
    refreshList,
    setTodayStartIso,
    previousROs,
    previousExpanded,
    togglePreviousExpanded,
    previousLoading,
    previousLoadingMore,
    previousHasMore,
    loadMorePrevious,
    todayROs,
  } = useROList(session);

  const { flushPendingSave, cancelPendingSave, applyROUpdate, saveROImmediate, persistRO } =
    useROPersistence(allROs, setAllROs, roRef, setCurrentRO);

  const prepareForScan = useCallback(async () => {
    await flushPendingSave();
    cancelPendingSave();
  }, [cancelPendingSave, flushPendingSave]);

  const openScanResultView = useCallback(() => {
    setView('ro');
  }, []);

  const navigateView = useCallback(
    (next: AppView) => {
      flushPendingSave();
      setView(next);
    },
    [flushPendingSave]
  );

  const { searchTerm, setSearchTerm, searchLoading, searchROs } = useROSearch({
    session,
    allROs,
    setAllROs,
    setTodayStartIso,
  });

  const {
    pendingROImages,
    setPendingROImages,
    scanRO,
    addScanPagesFromGallery,
    processPendingScan,
    clearPendingScan,
    cancelScan,
  } = useROScan({
    roRef,
    setAllROs,
    setCurrentRO,
    prepareForScan,
    openScanResultView,
    onOcrStart,
    onOcrFinish,
    setOcrProgress,
    setScanStatusMessage,
  });

  const { addComplaint, removeComplaint, editComplaint, updateRONumber } = useROComplaints({
    roRef,
    applyROUpdate,
  });

  /** Prevent blank screen when view points at RO/line but selection was cleared mid-scan. */
  useEffect(() => {
    if (view === 'ro' && !currentRO) {
      setView('home');
      return;
    }
    if (view === 'line') {
      const lineExists =
        !!currentRO && !!currentLineId && currentRO.repairLines.some((line) => line.id === currentLineId);
      if (!lineExists) {
        setView(currentRO ? 'ro' : 'home');
      }
    }
  }, [view, currentRO, currentLineId]);

  const deleteRO = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this RO and all its data?')) return;
      try {
        await api.deleteRepairOrder(id);
        setAllROs((prev) => prev.filter((r) => r.id !== id));
        if (currentRO?.id === id) {
          setCurrentRO(null);
          setCurrentLineId(null);
          setLastGeneratedStoryByLine({});
          setStoryQualityByLine({});
          setStoryReviewByLine({});
          generateStorySeqRef.current += 1;
          scoreStorySeqRef.current += 1;
          reviewStorySeqRef.current += 1;
          storyGenerationInFlightRef.current = false;
          storyScoringInFlightRef.current = false;
          storyReviewInFlightRef.current = false;
          setIsGenerating(false);
          setGeneratingLineId(null);
          setIsScoring(false);
          setScoringLineId(null);
          setIsReviewing(false);
          setReviewingLineId(null);
          setView('home');
        }
        toast.success('Repair order deleted');
      } catch (e) {
        console.error('[Merlin] Delete repair order failed', e);
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [currentRO]
  );

  const openROById = useCallback(
    async (id: string) => {
      if (openingROInFlightRef.current === id) return;
      openingROInFlightRef.current = id;
      setOpeningROId(id);
      flushPendingSave();
      try {
        const { repairOrder } = await api.getRepairOrder(id);
        const normalized = ensureComplaintIds(repairOrder);
        roRef.current = normalized;
        setCurrentRO(normalized);
        setCurrentLineId(null);
        setLastGeneratedStoryByLine({});
        setStoryQualityByLine({});
        setStoryReviewByLine({});
        generateStorySeqRef.current += 1;
        scoreStorySeqRef.current += 1;
        reviewStorySeqRef.current += 1;
        storyGenerationInFlightRef.current = false;
        storyScoringInFlightRef.current = false;
        storyReviewInFlightRef.current = false;
        setIsGenerating(false);
        setGeneratingLineId(null);
        setIsScoring(false);
        setScoringLineId(null);
        setIsReviewing(false);
        setReviewingLineId(null);
        setAllROs((prev) => {
          const idx = prev.findIndex((r) => r.id === normalized.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = normalized;
            return copy;
          }
          return [normalized, ...prev];
        });
        navigateView('ro');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load repair order');
      } finally {
        if (openingROInFlightRef.current === id) {
          openingROInFlightRef.current = null;
        }
        setOpeningROId((current) => (current === id ? null : current));
      }
    },
    [flushPendingSave, navigateView]
  );

  const openRO = useCallback(
    (target: RepairOrder | string) => {
      const id = typeof target === 'string' ? target : target.id;
      void openROById(id);
    },
    [openROById]
  );

  const createManualRO = useCallback(async () => {
    try {
      const draft = createManualRepairOrder();
      const { repairOrder } = await api.createRepairOrder(draft);
      const withIds = ensureComplaintIds(
        draft.complaintIds && draft.complaintIds.length === repairOrder.complaints.length
          ? { ...repairOrder, complaintIds: draft.complaintIds }
          : repairOrder
      );
      roRef.current = withIds;
      setAllROs((prev) => [withIds, ...prev]);
      setCurrentRO(withIds);
      navigateView('ro');
      toast.success('Manual repair order created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
    }
  }, [navigateView]);

  const updateLine = useCallback(
    (lineId: string, updates: Partial<RepairLine>) => {
      let nextUpdates = updates;
      if (updates.warrantyStory !== undefined) {
        const { text, wasModified } = sanitizeForCDKWithMeta(updates.warrantyStory);
        nextUpdates = { ...updates, warrantyStory: text };
        if (wasModified) {
          setCdkSanitizedByLine((prev) => ({ ...prev, [lineId]: true }));
        }
      }
      applyROUpdate((ro) => ({
        ...ro,
        repairLines: ro.repairLines.map((line) =>
          line.id === lineId ? { ...line, ...nextUpdates } : line
        ),
      }));
    },
    [applyROUpdate]
  );

  const updateVehicle = useCallback(
    (updates: Partial<RepairOrder['vehicle']>) => {
      const normalized = { ...updates };
      if (normalized.vin !== undefined) normalized.vin = normalized.vin.toUpperCase();
      applyROUpdate((ro) => ({ ...ro, vehicle: { ...ro.vehicle, ...normalized } }));
    },
    [applyROUpdate]
  );

  const updateCustomer = useCallback(
    (name: string) => {
      applyROUpdate((ro) => ({ ...ro, customer: { ...ro.customer, name } }));
    },
    [applyROUpdate]
  );

  const decodeVinForRO = useCallback(async () => {
    flushPendingSave();
    const latestRO = roRef.current;
    if (!latestRO?.vehicle.vin || latestRO.vehicle.vin.length < 17) {
      toast.error('Enter a valid 17-character VIN first');
      return;
    }
    try {
      const result = await api.decodeVin(latestRO.vehicle.vin);
      if (!result.valid) {
        toast.error('VIN could not be decoded — verify and try again');
        return;
      }
      updateVehicle({
        year: result.year || latestRO.vehicle.year,
        make: result.make || latestRO.vehicle.make,
        model: result.model || latestRO.vehicle.model,
        engine: result.engine || latestRO.vehicle.engine,
      });
      toast.success('Vehicle details filled from NHTSA VIN decode');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'VIN decode failed');
    }
  }, [flushPendingSave, updateVehicle]);

  const addRepairLine = useCallback(async () => {
    flushPendingSave();
    const latestRO = roRef.current;
    if (!latestRO) return;
    const newLine = createNewRepairLine(latestRO.repairLines.length + 1);
    const updated = { ...latestRO, repairLines: [...latestRO.repairLines, newLine] };
    const saved = ensureComplaintIds(await persistRO(updated));
    roRef.current = saved;
    setCurrentRO(saved);
    setAllROs((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    setCurrentLineId(saved.repairLines[saved.repairLines.length - 1].id);
    navigateView('line');
  }, [flushPendingSave, navigateView, persistRO]);

  const analyzeXentryImage = useCallback(
    async (file: File, attachment: ImageAttachment, onProgress: (p: number) => void) => {
      let extracted: Partial<ExtractedData> = {};
      let text = '';

      onProgress(10);
      try {
        const grokData = await api.extractDiagnostics(attachment.pathname);
        extracted = mergeExtracted(emptyExtractedData(), grokData);
        text = formatExtractionAsOcrText(grokData);
        onProgress(50);
      } catch (err) {
        clientLog.warn('Grok diagnostic extraction failed, falling back to OCR', err);
      }

      try {
        const ocrText = await runDiagnosticOCR(file, (p) => onProgress(text ? 50 + Math.round(p * 0.45) : Math.round(p * 0.9)));
        if (ocrText.trim()) {
          const ocrExtracted = parseDiagnosticExtraction(ocrText);
          extracted = mergeExtracted(mergeExtracted(emptyExtractedData(), extracted), ocrExtracted);
          text = text ? `${text}\n\n[OCR SUPPLEMENT]\n${ocrText}` : ocrText;
        }
      } catch (err) {
        clientLog.warn('Diagnostic OCR failed for one image', err);
      }

      if (!text.trim()) {
        text = '[No diagnostic text extracted from image]';
      }

      return { text, extracted };
    },
    []
  );

  const processXentryImages = useCallback(
    async (files: File[], existingImages: ImageAttachment[], existingOcr: string[], existingExtracted: ExtractedData) => {
      let updatedExtracted = normalizeExtractedData(existingExtracted);
      let updatedOcrTexts = existingOcr;
      const newImgs: ImageAttachment[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setOcrProgress(Math.round((i / files.length) * 20));
        const attachment = await uploadFileAsAttachment(file, 'ximg');
        newImgs.push(attachment);
        try {
          const result = await analyzeXentryImage(file, attachment, (p) =>
            setOcrProgress(Math.round(20 + ((i + p / 100) / files.length) * 80))
          );
          updatedExtracted = mergeExtracted(updatedExtracted, result.extracted);
          updatedOcrTexts = [...updatedOcrTexts, result.text];
        } catch (err) {
          clientLog.warn('Xentry analysis failed for one image', err);
          updatedOcrTexts = [...updatedOcrTexts, '[Analysis failed for this image]'];
        }
      }

      return { newImgs, updatedExtracted, updatedOcrTexts, allImages: [...existingImages, ...newImgs] };
    },
    [analyzeXentryImage, setOcrProgress]
  );

  const removeImageAtIndex = useCallback((images: ImageAttachment[], ocrTexts: string[], imageId: string) => {
    const index = images.findIndex((img) => img.id === imageId);
    if (index < 0) return null;
    const nextImages = images.filter((img) => img.id !== imageId);
    const nextOcr = ocrTexts.filter((_, i) => i !== index);
    return { nextImages, nextOcr, rebuilt: rebuildExtractedFromOcrTexts(nextOcr) };
  }, []);

  const deleteLineXentryImage = useCallback(
    async (lineId: string, imageId: string) => {
      if (!window.confirm('Delete this diagnostic photo? Extracted data will be updated.')) return;
      const latestRO = roRef.current;
      if (!latestRO) return;
      const line = latestRO.repairLines.find((l) => l.id === lineId);
      if (!line) return;

      const result = removeImageAtIndex(line.xentryImages || [], line.xentryOcrTexts || [], imageId);
      if (!result) return;

      const updatedLines = latestRO.repairLines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              xentryImages: result.nextImages,
              xentryOcrTexts: result.nextOcr,
              extractedData: result.rebuilt,
            }
          : l
      );
      try {
        await saveROImmediate({ ...latestRO, repairLines: updatedLines });
        toast.success('Diagnostic photo deleted');
      } catch (error: unknown) {
        console.error('[Merlin] Delete diagnostic photo failed', error);
        toast.error(error instanceof Error ? error.message : 'Failed to delete diagnostic photo');
      }
    },
    [removeImageAtIndex, saveROImmediate]
  );

  const deleteROXentryImage = useCallback(
    async (imageId: string) => {
      if (!window.confirm('Delete this Xentry photo? Extracted data will be updated.')) return;
      const latestRO = roRef.current;
      if (!latestRO) return;

      const result = removeImageAtIndex(latestRO.xentryImages || [], latestRO.xentryOcrTexts || [], imageId);
      if (!result) return;

      const updatedLines = latestRO.repairLines.map((l, idx) => {
        if (idx !== 0) return l;
        const lineImages = l.xentryImages || [];
        if (!lineImages.some((img) => img.id === imageId)) return l;
        const lineResult = removeImageAtIndex(lineImages, l.xentryOcrTexts || [], imageId);
        if (!lineResult) return l;
        return {
          ...l,
          xentryImages: lineResult.nextImages,
          xentryOcrTexts: lineResult.nextOcr,
          extractedData: lineResult.rebuilt,
        };
      });

      try {
        await saveROImmediate({
          ...latestRO,
          xentryImages: result.nextImages,
          xentryOcrTexts: result.nextOcr,
          repairLines: updatedLines,
        });
        toast.success('Xentry photo deleted');
      } catch (error: unknown) {
        console.error('[Merlin] Delete Xentry photo failed', error);
        toast.error(error instanceof Error ? error.message : 'Failed to delete Xentry photo');
      }
    },
    [removeImageAtIndex, saveROImmediate]
  );

  const addXentryPhotos = useCallback(
    (lineId: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.setAttribute('capture', 'environment');
      input.onchange = async (e) => {
        const files = Array.from((e.target as HTMLInputElement).files || []);
        if (files.length === 0 || !currentRO) return;
        flushPendingSave();
        onOcrStart();
        const latestRO = roRef.current;
        const lineForExtract = latestRO?.repairLines.find((l) => l.id === lineId);
        if (!latestRO || !lineForExtract) {
          onOcrFinish();
          return;
        }
        try {
          const result = await processXentryImages(
            files,
            lineForExtract.xentryImages || [],
            lineForExtract.xentryOcrTexts || [],
            lineForExtract.extractedData || emptyExtractedData()
          );
          const updatedLines = latestRO.repairLines.map((l) =>
            l.id === lineId
              ? { ...l, xentryImages: result.allImages, xentryOcrTexts: result.updatedOcrTexts, extractedData: result.updatedExtracted }
              : l
          );
          const updated = { ...latestRO, repairLines: updatedLines };
          await saveROImmediate(updated);
          toast.success(`${files.length} diagnostic photo(s) analyzed`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to upload photos');
        } finally {
          onOcrFinish();
        }
      };
      input.click();
    },
    [currentRO, flushPendingSave, processXentryImages, saveROImmediate, onOcrStart, onOcrFinish]
  );

  const addROXentryPhotos = useCallback(() => {
    if (!currentRO) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.setAttribute('capture', 'environment');
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length === 0 || !currentRO) return;
      flushPendingSave();
      onOcrStart();
      const latestRO = roRef.current;
      if (!latestRO) {
        onOcrFinish();
        return;
      }
      try {
        const firstLine = latestRO.repairLines[0];
        const result = await processXentryImages(
          files,
          latestRO.xentryImages || [],
          latestRO.xentryOcrTexts || [],
          firstLine?.extractedData || emptyExtractedData()
        );
        let updatedLines = latestRO.repairLines;
        if (firstLine) {
          updatedLines = latestRO.repairLines.map((l, idx) =>
            idx === 0
              ? {
                  ...l,
                  xentryImages: [...(l.xentryImages || []), ...result.newImgs],
                  xentryOcrTexts: result.updatedOcrTexts,
                  extractedData: result.updatedExtracted,
                }
              : l
          );
        }
        await saveROImmediate({
          ...latestRO,
          xentryImages: result.allImages,
          xentryOcrTexts: result.updatedOcrTexts,
          repairLines: updatedLines,
        });
        toast.success(`${files.length} Xentry photo(s) analyzed`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to upload photos');
      } finally {
        onOcrFinish();
      }
    };
    input.click();
  }, [currentRO, flushPendingSave, processXentryImages, saveROImmediate, onOcrStart, onOcrFinish]);

  const invalidateReviewRequests = useCallback(() => {
    reviewStorySeqRef.current += 1;
    storyReviewInFlightRef.current = false;
    setIsReviewing(false);
    setReviewingLineId(null);
  }, []);

  const invalidateScoreRequests = useCallback(() => {
    scoreStorySeqRef.current += 1;
    storyScoringInFlightRef.current = false;
    setIsScoring(false);
    setScoringLineId(null);
  }, []);

  const clearLineQualityState = useCallback((lineId: string) => {
    setStoryQualityByLine((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setStoryReviewByLine((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const { applyCustomerPayTemplate, clearCustomerPayMode, generateStory, scoreStory, reviewStory } =
    useROStoryWorkflow(
      {
        roRef,
        generateStorySeqRef,
        scoreStorySeqRef,
        reviewStorySeqRef,
        storyGenerationInFlightRef,
        storyScoringInFlightRef,
        storyReviewInFlightRef,
      },
      {
        setIsGenerating,
        setGeneratingLineId,
        setIsScoring,
        setScoringLineId,
        setIsReviewing,
        setReviewingLineId,
        setLastGeneratedStoryByLine,
        setStoryQualityByLine,
        setStoryReviewByLine,
        setCdkSanitizedByLine,
      },
      { flushPendingSave, applyROUpdate, clearLineQualityState, invalidateReviewRequests, invalidateScoreRequests }
    );

  const acknowledgeStoryBaseline = useCallback((lineId: string, text: string) => {
    setLastGeneratedStoryByLine((prev) => ({ ...prev, [lineId]: text }));
  }, []);

  const clearCdkSanitizedNotice = useCallback((lineId: string) => {
    setCdkSanitizedByLine((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const currentLine = currentRO?.repairLines.find((l) => l.id === currentLineId);
  const lastGeneratedStoryForLine =
    currentLineId && lastGeneratedStoryByLine[currentLineId]
      ? lastGeneratedStoryByLine[currentLineId]
      : null;
  const cdkSanitizedForLine = Boolean(currentLineId && cdkSanitizedByLine[currentLineId]);

  const isGeneratingForLine = isGenerating && generatingLineId === currentLineId;
  const isScoringForLine = isScoring && scoringLineId === currentLineId;
  const isReviewingForLine = isReviewing && reviewingLineId === currentLineId;
  const storyQualityForLine = (() => {
    if (!currentLineId || isGeneratingForLine || isScoringForLine || isReviewingForLine) return null;
    const quality = storyQualityByLine[currentLineId];
    if (!quality) return null;
    const storyText = currentLine?.warrantyStory?.trim() ?? '';
    if (!storyText) return null;
    if (quality.scoredAgainstStory?.trim() !== storyText) return null;
    return quality;
  })();

  const storyReviewForLine = (() => {
    if (!currentLineId || isGeneratingForLine || isScoringForLine || isReviewingForLine) return null;
    if (!storyQualityForLine) return null;
    return storyReviewByLine[currentLineId] ?? null;
  })();

  const storyQualityStaleForLine = (() => {
    if (!currentLineId || isGeneratingForLine || isScoringForLine || isReviewingForLine) return false;
    const quality = storyQualityByLine[currentLineId];
    const storyText = currentLine?.warrantyStory?.trim() ?? '';
    if (!quality || !storyText) return false;
    return quality.scoredAgainstStory?.trim() !== storyText;
  })();

  /** @deprecated Use todayROs / searchROs — kept for any legacy callers. */
  const filteredROs = searchTerm.trim() ? searchROs : todayROs;

  const navigateToLine = useCallback(
    (lineId: string) => {
      flushPendingSave();
      setCurrentLineId(lineId);
      navigateView('line');
    },
    [flushPendingSave, navigateView]
  );

  return {
    view,
    setView: navigateView,
    currentRO,
    setCurrentRO,
    currentLineId,
    setCurrentLineId,
    currentLine,
    allROs,
    loading,
    listError,
    listRetrying,
    retryListLoad,
    refreshList,
    searchTerm,
    setSearchTerm,
    pendingROImages,
    setPendingROImages,
    isGenerating,
    isGeneratingForLine,
    isScoringForLine,
    isReviewingForLine,
    storyQualityForLine,
    storyReviewForLine,
    storyQualityStaleForLine,
    lastGeneratedStoryForLine,
    cdkSanitizedForLine,
    clearCdkSanitizedNotice,
    openingROId,
    filteredROs,
    todayROs,
    searchROs,
    searchLoading,
    previousROs,
    previousExpanded,
    togglePreviousExpanded,
    previousLoading,
    previousLoadingMore,
    previousHasMore,
    loadMorePrevious,
    flushPendingSave,
    navigateToLine,
    deleteRO,
    openRO,
    openROById,
    scanRO,
    addScanPagesFromGallery,
    processPendingScan,
    clearPendingScan,
    cancelScan,
    createManualRO,
    updateLine,
    updateVehicle,
    updateCustomer,
    addComplaint,
    removeComplaint,
    editComplaint,
    updateRONumber,
    decodeVinForRO,
    addRepairLine,
    addXentryPhotos,
    addROXentryPhotos,
    deleteLineXentryImage,
    deleteROXentryImage,
    applyCustomerPayTemplate,
    clearCustomerPayMode,
    generateStory,
    scoreStory,
    reviewStory,
    acknowledgeStoryBaseline,
  };
}