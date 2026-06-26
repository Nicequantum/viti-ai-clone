'use client';

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { runMultiPassOCR } from '@/services/ocr';
import type { PendingImage, RepairOrder } from '@/types';
import {
  extractCustomerName,
  extractRoNumberFromText,
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
import { uploadFilesAsAttachments } from '@/utils/uploadHelpers';
import { ensureComplaintIds } from '@/utils/repairOrderFactory';

interface UseROScanOptions {
  roRef: MutableRefObject<RepairOrder | null>;
  setAllROs: Dispatch<SetStateAction<RepairOrder[]>>;
  setCurrentRO: Dispatch<SetStateAction<RepairOrder | null>>;
  /** Flush + cancel stale debounced saves before scan (prevents post-scan overwrite). */
  prepareForScan: () => Promise<void>;
  /** Open scanned RO without flushPendingSave — navigateView races with new RO state. */
  openScanResultView: () => void;
  onOcrStart: (message?: string) => void;
  onOcrFinish: () => void;
  setOcrProgress: (p: number) => void;
  setScanStatusMessage: (message: string) => void;
}

/** RO document scan pipeline: pending pages, OCR, Grok extraction, and RO creation. */
export function useROScan({
  roRef,
  setAllROs,
  setCurrentRO,
  prepareForScan,
  openScanResultView,
  onOcrStart,
  onOcrFinish,
  setOcrProgress,
  setScanStatusMessage,
}: UseROScanOptions) {
  const [pendingROImages, setPendingROImages] = useState<PendingImage[]>([]);
  const scanCancelledRef = useRef(false);
  const scanInFlightRef = useRef(false);
  const scanSessionRef = useRef(0);

  const clearPendingPreviews = useCallback((images: PendingImage[]) => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
  }, []);

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
        openScanResultView();
        toast.success('Repair order created from scan');
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
        return false;
      }
    },
    [openScanResultView, roRef, setAllROs, setCurrentRO]
  );

  const createROFromText = useCallback(
    async (text: string) => {
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
        openScanResultView();
        toast.success('Repair order created from scan');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
      }
    },
    [openScanResultView, roRef, setAllROs, setCurrentRO]
  );

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
      await prepareForScan();
      if (!isActiveSession()) return;

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
      onOcrFinish,
      onOcrStart,
      prepareForScan,
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

  return {
    pendingROImages,
    setPendingROImages,
    scanRO,
    addScanPagesFromGallery,
    processPendingScan,
    clearPendingScan,
    cancelScan,
    createROFromText,
  };
}