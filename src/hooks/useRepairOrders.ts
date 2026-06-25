'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { isRepairOrderActiveToday } from '@/lib/dealershipDayBoundary';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import { runDiagnosticOCR, runMultiPassOCR } from '@/services/ocr';
import type {
  AppView,
  ExtractedData,
  ImageAttachment,
  PendingImage,
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


import { useROPersistence } from '@/hooks/repairOrders/useROPersistence';
import { useROStoryWorkflow } from '@/hooks/repairOrders/useROStoryWorkflow';
import {
  createManualRepairOrder,
  createNewRepairLine,
  ensureComplaintIds,
  syncRepairLinesWithComplaints,
} from '@/utils/repairOrderFactory';
import {
  extractComplaints,
  extractCustomerName,
  extractRoNumberFromText,
  extractVehicleDetails,
  finalizeLabeledComplaints,
  mergeROExtractions,
  parseStructuredROText,
  sanitizeComplaints,
  sanitizeVehicle,
} from '@/utils/roExtractor';
import { normalizeScanFiles } from '@/utils/scanFileHelpers';
import {
  classifyScanPages,
  combineRepairOrderPages,
  combineVmiPages,
} from '@/utils/scanDocumentClassifier';
import { extractVmiWarrantyInfo, mergeVehicleWarrantyInfo } from '@/utils/vmiExtractor';
import { uploadFileAsAttachment, uploadFilesAsAttachments } from '@/utils/uploadHelpers';

interface UseRepairOrdersOptions {
  session: TechnicianSession | null;
  onOcrStart: (message?: string) => void;
  onOcrFinish: () => void;
  setOcrProgress: (p: number) => void;
  setScanStatusMessage: (message: string) => void;
}

const PREVIOUS_PAGE_SIZE = 25;
const SEARCH_PAGE_SIZE = 50;

function mergeRepairOrders(...lists: RepairOrder[][]): RepairOrder[] {
  const map = new Map<string, RepairOrder>();
  for (const list of lists) {
    for (const ro of list) {
      map.set(ro.id, ro);
    }
  }
  return Array.from(map.values());
}

function matchesROSearch(ro: RepairOrder, term: string): boolean {
  const q = term.toLowerCase();
  return (
    ro.roNumber.toLowerCase().includes(q) ||
    (ro.vehicle.make?.toLowerCase().includes(q) ?? false) ||
    (ro.vehicle.model?.toLowerCase().includes(q) ?? false) ||
    (ro.vehicle.year?.includes(q) ?? false) ||
    (ro.vehicle.vin?.toLowerCase().includes(q) ?? false)
  );
}

function sortRepairOrdersNewestFirst(orders: RepairOrder[]): RepairOrder[] {
  return [...orders].sort((a, b) => ((b.updatedAt || b.createdAt || '0') > (a.updatedAt || a.createdAt || '0') ? 1 : -1));
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
  const [allROs, setAllROs] = useState<RepairOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingROImages, setPendingROImages] = useState<PendingImage[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listRetrying, setListRetrying] = useState(false);
  const [todayStartIso, setTodayStartIso] = useState<string | null>(null);
  const [previousROs, setPreviousROs] = useState<RepairOrder[]>([]);
  const [previousExpanded, setPreviousExpanded] = useState(false);
  const [previousLoading, setPreviousLoading] = useState(false);
  const [previousLoadingMore, setPreviousLoadingMore] = useState(false);
  const [previousCursor, setPreviousCursor] = useState<string | null>(null);
  const [previousHasMore, setPreviousHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const previousLoadedRef = useRef(false);
  const [openingROId, setOpeningROId] = useState<string | null>(null);
  const scanCancelledRef = useRef(false);
  const scanInFlightRef = useRef(false);
  const scanSessionRef = useRef(0);
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

  const normalizeRepairOrder = useCallback((repairOrder: RepairOrder): RepairOrder => {
    return {
      ...repairOrder,
      repairLines: repairOrder.repairLines.map((line) => ({
        ...line,
        extractedData: normalizeExtractedData(line.extractedData),
      })),
    };
  }, []);

  const refreshList = useCallback(async () => {
    if (!session) {
      setAllROs([]);
      setPreviousROs([]);
      setListError(null);
      setLoading(false);
      setListRetrying(false);
      previousLoadedRef.current = false;
      setPreviousExpanded(false);
      return;
    }

    setListError(null);
    try {
      const { repairOrders, todayStart } = await api.listRepairOrders({ scope: 'today' });
      const normalized = repairOrders.map(normalizeRepairOrder);
      setAllROs(normalized);
      if (todayStart) setTodayStartIso(todayStart);
      setPreviousROs([]);
      setPreviousCursor(null);
      setPreviousHasMore(false);
      previousLoadedRef.current = false;
      setPreviousExpanded(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAllROs([]);
        setListError(null);
        return;
      }
      setListError('Could not load repair orders. Check your connection and try again.');
      throw error;
    } finally {
      setLoading(false);
      setListRetrying(false);
    }
  }, [normalizeRepairOrder, session]);

  /** Lazy-load older repair orders — only when the Previous section is opened. */
  const loadPreviousPage = useCallback(
    async (append: boolean) => {
      if (!session) return;
      if (append) setPreviousLoadingMore(true);
      else setPreviousLoading(true);

      try {
        const { repairOrders, nextCursor, hasMore, todayStart } = await api.listRepairOrders({
          scope: 'previous',
          limit: PREVIOUS_PAGE_SIZE,
          cursor: append ? previousCursor ?? undefined : undefined,
        });
        const normalized = repairOrders.map(normalizeRepairOrder);
        setPreviousROs((prev) => (append ? mergeRepairOrders(prev, normalized) : normalized));
        setAllROs((prev) => mergeRepairOrders(prev, normalized));
        setPreviousCursor(nextCursor ?? null);
        setPreviousHasMore(Boolean(hasMore));
        if (todayStart) setTodayStartIso(todayStart);
        previousLoadedRef.current = true;
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) {
          toast.error('Could not load previous repair orders — try again.');
        }
      } finally {
        setPreviousLoading(false);
        setPreviousLoadingMore(false);
      }
    },
    [normalizeRepairOrder, previousCursor, session]
  );

  const togglePreviousExpanded = useCallback(() => {
    setPreviousExpanded((expanded) => {
      const next = !expanded;
      if (next && !previousLoadedRef.current) {
        void loadPreviousPage(false);
      }
      return next;
    });
  }, [loadPreviousPage]);

  const loadMorePrevious = useCallback(() => {
    if (previousLoading || previousLoadingMore || !previousHasMore) return;
    void loadPreviousPage(true);
  }, [loadPreviousPage, previousHasMore, previousLoading, previousLoadingMore]);

  const retryListLoad = useCallback(async () => {
    setListRetrying(true);
    setLoading(true);
    try {
      await refreshList();
    } catch {
      toast.error('Still unable to load repair orders — check Wi‑Fi or ask your manager.');
    }
  }, [refreshList]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      setListError(null);
      setAllROs([]);
      setPreviousROs([]);
      return;
    }

    setLoading(true);
    refreshList().catch(() => {
      toast.error('Could not load repair orders — check your connection');
    });
  }, [session, refreshList]);

  // Server search for historical ROs; client filter adds VIN matches from loaded rows.
  useEffect(() => {
    const q = searchTerm.trim();
    if (!session || !q) {
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timer = setTimeout(() => {
      api
        .listRepairOrders({ q, limit: SEARCH_PAGE_SIZE })
        .then(({ repairOrders, todayStart }) => {
          const normalized = repairOrders.map(normalizeRepairOrder);
          setAllROs((prev) => mergeRepairOrders(prev, normalized));
          if (todayStart) setTodayStartIso(todayStart);
        })
        .catch((error: unknown) => {
          if (!(error instanceof ApiError && error.status === 401)) {
            clientLog.warn('Repair order search failed', error);
          }
        })
        .finally(() => setSearchLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [normalizeRepairOrder, searchTerm, session]);

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

  const { flushPendingSave, applyROUpdate, saveROImmediate, persistRO } = useROPersistence(
    allROs,
    setAllROs,
    roRef,
    setCurrentRO
  );

  const navigateView = useCallback(
    (next: AppView) => {
      flushPendingSave();
      setView(next);
    },
    [flushPendingSave]
  );

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

  const createROFromText = useCallback(async (text: string) => {
    const parsed = parseStructuredROText(text);
    const roNumber = parsed.roNumber || extractRoNumberFromText(text);
    const vehicle = sanitizeVehicle(parsed.vehicle);
    const complaints = sanitizeComplaints(parsed.complaints);
    const custName = parsed.customerName || extractCustomerName(text);
    try {
      const { repairOrder } = await api.createRepairOrder({
        fromExtraction: true,
        roNumber,
        vehicle,
        customerName: custName,
        serviceAdvisorName: parsed.serviceAdvisorName,
        advisorExtractionSource: 'ocr_fallback',
        complaints,
        complaintLabels: parsed.complaintLabels,
      } as never);
      roRef.current = ensureComplaintIds(repairOrder);
      setAllROs((prev) => [repairOrder, ...prev]);
      setCurrentRO(repairOrder);
      navigateView('ro');
      toast.success('Repair order created from scan');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
    }
  }, [navigateView]);

  const createROFromExtracted = useCallback(
    async (extracted: {
      vehicle: RepairOrder['vehicle'];
      complaints: string[];
      complaintLabels?: string[];
      customerName: string;
      roNumber?: string;
      serviceAdvisorName?: string;
    }): Promise<boolean> => {
      try {
        const finalized = finalizeLabeledComplaints(
          extracted.complaints || [],
          extracted.complaintLabels
        );
        const complaints = finalized.complaints;
        const complaintLabels = finalized.labels;
        const { repairOrder } = await api.createRepairOrder({
          fromExtraction: true,
          roNumber: extracted.roNumber || `R-${Date.now().toString().slice(-6)}`,
          vehicle: sanitizeVehicle(extracted.vehicle),
          customerName: extracted.customerName,
          serviceAdvisorName: extracted.serviceAdvisorName,
          advisorExtractionSource: 'grok',
          complaints,
          complaintLabels,
        } as never);
        roRef.current = ensureComplaintIds(repairOrder);
        setAllROs((prev) => [repairOrder, ...prev]);
        setCurrentRO(repairOrder);
        navigateView('ro');
        toast.success('Repair order created from scan');
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
        return false;
      }
    },
    [navigateView]
  );

  const clearPendingPreviews = useCallback((images: PendingImage[]) => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
  }, []);

  const processScanImages = useCallback(
    async (images: PendingImage[]) => {
      if (images.length === 0) return;
      if (scanInFlightRef.current) {
        toast.message('Scan already in progress…');
        return;
      }

      const sessionId = ++scanSessionRef.current;
      const isActiveSession = () =>
        scanSessionRef.current === sessionId && !scanCancelledRef.current;

      scanCancelledRef.current = false;
      scanInFlightRef.current = true;
      onOcrStart('Uploading documents…');
      setPendingROImages(images);

      let createdSuccessfully = false;

      try {
        setOcrProgress(8);
        setScanStatusMessage(`Uploading ${images.length} page${images.length === 1 ? '' : 's'}…`);
        const attachments = await uploadFilesAsAttachments(
          images.map((img) => img.file),
          'roimg'
        );
        if (!isActiveSession()) return;

        const imagePathnames = attachments.map((a) => a.pathname);

        const runClientOcr = async () => {
          let combinedText = '';
          for (let i = 0; i < images.length; i++) {
            if (!isActiveSession()) return '';
            const img = images[i];
            setScanStatusMessage(
              `Reading page ${i + 1} of ${images.length} (multi-pass OCR for accuracy)…`
            );
            setOcrProgress(Math.round(30 + (i / images.length) * 15));
            const text = await runMultiPassOCR(img.file, (p) => {
              if (!isActiveSession()) return;
              setOcrProgress(Math.round(45 + (i / images.length) * 35 + (p / images.length) * 35));
            });
            combinedText += `\n\n=== PAGE ${i + 1} ===\n` + text;
          }
          return combinedText;
        };

        setOcrProgress(35);
        setScanStatusMessage('Starting on-device OCR and AI vision in parallel…');
        const ocrPromise = runClientOcr();
        const grokPromise = api.extractRO(imagePathnames).catch((error) => {
          clientLog.warn('Server RO extraction failed or timed out', error);
          return null;
        });

        setOcrProgress(42);
        setScanStatusMessage('AI vision extraction in progress (OCR continues in parallel)…');

        const [ocrText, grokExtracted] = await Promise.all([ocrPromise, grokPromise]);
        if (!isActiveSession()) return;

        if (!ocrText?.trim() && !grokExtracted) {
          throw new Error('Could not read the repair order. Try sharper photos or fewer pages.');
        }

        const classifiedPages = classifyScanPages(ocrText || '');
        const roOcrText =
          combineRepairOrderPages(classifiedPages) ||
          (classifiedPages.some((page) => page.kind === 'repair_order') ? '' : ocrText || '');
        const vmiOcrText = combineVmiPages(classifiedPages);
        const vmiWarranty = extractVmiWarrantyInfo(vmiOcrText);

        const ocrExtracted = roOcrText ? parseStructuredROText(roOcrText) : null;
        let extracted =
          grokExtracted && ocrExtracted
            ? mergeROExtractions(grokExtracted, ocrExtracted, roOcrText)
            : grokExtracted || ocrExtracted || parseStructuredROText(roOcrText || '');

        if (vmiWarranty && Object.keys(vmiWarranty).length > 0) {
          extracted = {
            ...extracted,
            vehicle: {
              ...extracted.vehicle,
              warrantyInfo: mergeVehicleWarrantyInfo(extracted.vehicle.warrantyInfo, vmiWarranty),
            },
          };
        }

        if (!isActiveSession()) return;
        setOcrProgress(88);
        setScanStatusMessage('Creating repair order…');
        createdSuccessfully = await createROFromExtracted(extracted);
        if (!createdSuccessfully) {
          throw new Error('Failed to create repair order from scan.');
        }

        if (!isActiveSession()) return;
        setOcrProgress(100);
        setScanStatusMessage('Scan complete');
        clearPendingPreviews(images);
        setPendingROImages([]);
      } catch (error) {
        if (!isActiveSession()) return;
        clientLog.error('RO scan error', error);
        toast.error(error instanceof Error ? error.message : 'Scan failed. Try fewer pages or sharper photos.');
        if (!createdSuccessfully) {
          setPendingROImages(images);
        } else {
          clearPendingPreviews(images);
          setPendingROImages([]);
        }
      } finally {
        if (scanSessionRef.current === sessionId) {
          scanInFlightRef.current = false;
          onOcrFinish();
        }
      }
    },
    [
      clearPendingPreviews,
      createROFromExtracted,
      onOcrStart,
      onOcrFinish,
      setOcrProgress,
      setScanStatusMessage,
    ]
  );

  const appendScanPages = useCallback(
    async (rawFiles: File[]) => {
      if (rawFiles.length === 0) return;

      try {
        const normalizedFiles = await normalizeScanFiles(rawFiles);
        if (normalizedFiles.length === 0) {
          toast.error('No supported images or PDFs were selected.');
          return;
        }

        const baseIndex = pendingROImages.length;
        const newImages: PendingImage[] = normalizedFiles.map((file, i) => ({
          id: 'roimg-' + Date.now() + '-' + i,
          previewUrl: URL.createObjectURL(file),
          name: file.name || `page-${baseIndex + i + 1}.jpg`,
          file,
        }));

        setPendingROImages((prev) => [...prev, ...newImages]);
        const total = baseIndex + newImages.length;
        toast.success(
          `Added ${newImages.length} page${newImages.length === 1 ? '' : 's'} (${total} total). Tap Process RO when ready.`
        );
      } catch (error) {
        clientLog.error('Scan file preparation failed', error);
        toast.error(error instanceof Error ? error.message : 'Could not prepare files for scan.');
      }
    },
    [pendingROImages.length]
  );

  const scanRO = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = false;
    input.onchange = async (e) => {
      const rawFiles = Array.from((e.target as HTMLInputElement).files || []);
      await appendScanPages(rawFiles);
    };
    input.click();
  }, [appendScanPages]);

  const addScanPagesFromGallery = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = true;
    input.onchange = async (e) => {
      const rawFiles = Array.from((e.target as HTMLInputElement).files || []);
      await appendScanPages(rawFiles);
    };
    input.click();
  }, [appendScanPages]);

  const processPendingScan = useCallback(async () => {
    if (scanInFlightRef.current) {
      toast.message('Scan already in progress…');
      return;
    }
    if (pendingROImages.length === 0) {
      toast.message('Add at least one page before processing.');
      return;
    }
    const snapshot = [...pendingROImages];
    await processScanImages(snapshot);
  }, [pendingROImages, processScanImages]);

  const clearPendingScan = useCallback(() => {
    clearPendingPreviews(pendingROImages);
    setPendingROImages([]);
    toast.message('Scan pages cleared');
  }, [clearPendingPreviews, pendingROImages]);

  const cancelScan = useCallback(() => {
    scanSessionRef.current += 1;
    scanCancelledRef.current = true;
    scanInFlightRef.current = false;
    clearPendingPreviews(pendingROImages);
    setPendingROImages([]);
    onOcrFinish();
    toast.message('Scan cancelled');
  }, [clearPendingPreviews, onOcrFinish, pendingROImages]);

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

  const nextComplaintLabel = useCallback((labels?: string[], count = 0) => {
    if (labels && labels.length > 0) {
      const lastCode = labels[labels.length - 1].toUpperCase().charCodeAt(0);
      if (lastCode >= 65 && lastCode < 90) {
        return String.fromCharCode(lastCode + 1);
      }
    }
    return String.fromCharCode(65 + count);
  }, []);

  const updateComplaints = useCallback(
    (newComplaints: string[], newLabels?: string[], newIds?: string[]) => {
      applyROUpdate((ro) => {
        const complaintLabels =
          newLabels && newLabels.length === newComplaints.length ? newLabels : ro.complaintLabels;
        const labelsForIds =
          complaintLabels ?? newComplaints.map((_, i) => String.fromCharCode(65 + i));
        const complaintIds =
          newIds && newIds.length === newComplaints.length
            ? newIds
            : labelsForIds.map((label, i) => ro.complaintIds?.[i] ?? `cmp-${ro.id}-${label}`);
        const updatedLines = syncRepairLinesWithComplaints(ro.repairLines, newComplaints, complaintLabels);
        return { ...ro, complaints: newComplaints, complaintLabels, complaintIds, repairLines: updatedLines };
      });
    },
    [applyROUpdate]
  );

  const addComplaint = useCallback(() => {
    const ro = roRef.current;
    if (!ro) return;
    const complaints = [...(ro.complaints || []), ''];
    const labels = [...(ro.complaintLabels || ro.complaints.map((_, i) => String.fromCharCode(65 + i)))];
    const ids = [...(ro.complaintIds || labels.map((l) => `cmp-${ro.id}-${l}`))];
    const nextLabel = nextComplaintLabel(labels, complaints.length - 1);
    labels.push(nextLabel);
    ids.push(`cmp-${ro.id}-${nextLabel}-${Date.now()}`);
    updateComplaints(complaints, labels, ids);
  }, [nextComplaintLabel, updateComplaints]);

  const removeComplaint = useCallback(
    (index: number) => {
      const ro = roRef.current;
      if (!ro) return;
      updateComplaints(
        (ro.complaints || []).filter((_, i) => i !== index),
        ro.complaintLabels?.filter((_, i) => i !== index),
        ro.complaintIds?.filter((_, i) => i !== index)
      );
    },
    [updateComplaints]
  );

  const editComplaint = useCallback(
    (index: number, value: string) => {
      applyROUpdate((ro) => {
        const updated = [...(ro.complaints || [])];
        updated[index] = value;
        const labels = ro.complaintLabels;
        const label = labels?.[index] || String.fromCharCode(65 + index);
        const concern = value || '';
        const prefix = `${label}. `;
        const autoDescription = concern
          ? `${prefix}${concern}`.slice(0, 72)
          : `${label}. (not extracted — tap to edit)`;

        let repairLines = ro.repairLines;
        if (repairLines.length >= updated.length) {
          repairLines = repairLines.map((line, lineIndex) => {
            if (lineIndex !== index) return line;
            const concernChanged = line.customerConcern !== concern;
            const descLooksAuto =
              !line.description ||
              line.description === 'Enter repair description' ||
              line.description === 'New repair item' ||
              line.description.startsWith(`${label}. `) ||
              line.description === line.customerConcern?.slice(0, 60) ||
              line.description === line.customerConcern?.slice(0, 72);
            return {
              ...line,
              lineNumber: index + 1,
              customerConcern: concern,
              description: concernChanged || descLooksAuto ? autoDescription : line.description,
            };
          });
          if (repairLines.length > updated.length) {
            repairLines = repairLines.slice(0, updated.length);
          }
        } else {
          repairLines = syncRepairLinesWithComplaints(repairLines, updated, labels);
        }

        return {
          ...ro,
          complaints: updated,
          complaintLabels: labels,
          complaintIds: ro.complaintIds,
          repairLines,
        };
      });
    },
    [applyROUpdate]
  );

  const updateRONumber = useCallback(
    (roNumber: string) => {
      applyROUpdate((ro) => ({ ...ro, roNumber: roNumber.trim() }));
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
      await saveROImmediate({ ...latestRO, repairLines: updatedLines });
      toast.success('Diagnostic photo deleted');
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

      await saveROImmediate({
        ...latestRO,
        xentryImages: result.nextImages,
        xentryOcrTexts: result.nextOcr,
        repairLines: updatedLines,
      });
      toast.success('Xentry photo deleted');
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
      { flushPendingSave, applyROUpdate, clearLineQualityState, invalidateReviewRequests }
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

  const todayROs = useMemo(() => {
    const active = todayStartIso
      ? allROs.filter((ro) => isRepairOrderActiveToday(ro.updatedAt, todayStartIso, ro.createdAt))
      : allROs;
    return sortRepairOrdersNewestFirst(active);
  }, [allROs, todayStartIso]);

  const searchROs = useMemo(() => {
    const q = searchTerm.trim();
    if (!q) return [];
    return sortRepairOrdersNewestFirst(allROs.filter((ro) => matchesROSearch(ro, q)));
  }, [allROs, searchTerm]);

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