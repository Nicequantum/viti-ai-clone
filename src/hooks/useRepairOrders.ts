'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { preprocessImageForOCR, runMultiPassOCR, runOCR } from '@/services/ocr';
import type { AppView, ExtractedData, ImageAttachment, PendingImage, RepairLine, RepairOrder } from '@/types';
import { emptyExtractedData, mergeExtracted, parseDiagnosticText } from '@/utils/diagnosticParser';
import { getSuggestions } from '@/utils/mercedesKb';
import {
  createManualRepairOrder,
  createNewRepairLine,
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
  onOcrStart: (message?: string) => void;
  onOcrFinish: () => void;
  setOcrProgress: (p: number) => void;
  setScanStatusMessage: (message: string) => void;
}

export function useRepairOrders({
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
  const [loading, setLoading] = useState(true);
  const scanCancelledRef = useRef(false);
  const scanInFlightRef = useRef(false);
  const scanSessionRef = useRef(0);

  const refreshList = useCallback(async () => {
    const { repairOrders } = await api.listRepairOrders();
    setAllROs(repairOrders);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshList().catch(() => setLoading(false));
  }, [refreshList]);

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

  const persistRO = useCallback(
    async (ro: RepairOrder): Promise<RepairOrder> => {
      const isNew = !allROs.some((r) => r.id === ro.id) || ro.id.startsWith('ro-');
      if (isNew && ro.id.startsWith('ro-')) {
        const { repairOrder } = await api.createRepairOrder(ro);
        setAllROs((prev) => [repairOrder, ...prev.filter((r) => r.id !== ro.id)]);
        return repairOrder;
      }
      const { repairOrder } = await api.updateRepairOrder(ro.id, ro);
      setAllROs((prev) => prev.map((r) => (r.id === repairOrder.id ? repairOrder : r)));
      return repairOrder;
    },
    [allROs]
  );

  const saveRO = useCallback(
    async (ro: RepairOrder | null) => {
      if (ro) {
        try {
          const saved = await persistRO(ro);
          setCurrentRO(saved);
          setAllROs((prev) => {
            const idx = prev.findIndex((r) => r.id === saved.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = saved;
              return copy;
            }
            return [saved, ...prev];
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed to save repair order');
        }
      } else {
        setCurrentRO(null);
      }
    },
    [persistRO]
  );

  const getLatestRO = useCallback(
    (ro?: RepairOrder | null) => {
      const id = ro?.id || currentRO?.id;
      if (!id) return ro || currentRO;
      return allROs.find((r) => r.id === id) || ro || currentRO;
    },
    [allROs, currentRO]
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
          setView('home');
        }
        toast.success('Repair order deleted');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [currentRO]
  );

  const openRO = useCallback((ro: RepairOrder) => {
    setCurrentRO(ro);
    setCurrentLineId(null);
    setView('ro');
  }, []);

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
      setAllROs((prev) => [repairOrder, ...prev]);
      setCurrentRO(repairOrder);
      setView('ro');
      toast.success('Repair order created from scan');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
    }
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
        setAllROs((prev) => [repairOrder, ...prev]);
        setCurrentRO(repairOrder);
        setView('ro');
        toast.success('Repair order created from scan');
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
        return false;
      }
    },
    []
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
          console.warn('Server RO extraction failed or timed out', error);
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
        console.error('RO scan error', error);
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
        console.error('Scan file preparation failed', error);
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
      setAllROs((prev) => [repairOrder, ...prev]);
      setCurrentRO(repairOrder);
      setView('ro');
      toast.success('Manual repair order created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
    }
  }, []);

  const updateLine = useCallback(
    (lineId: string, updates: Partial<RepairLine>) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const updatedLines = latestRO.repairLines.map((line) => (line.id === lineId ? { ...line, ...updates } : line));
      const updated = { ...latestRO, repairLines: updatedLines };
      setCurrentRO(updated);
      setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      saveRO(updated);
    },
    [getLatestRO, saveRO]
  );

  const updateVehicle = useCallback(
    (updates: Partial<RepairOrder['vehicle']>) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const updated = { ...latestRO, vehicle: { ...latestRO.vehicle, ...updates } };
      setCurrentRO(updated);
      setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      saveRO(updated);
    },
    [getLatestRO, saveRO]
  );

  const updateCustomer = useCallback(
    (name: string) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const updated = { ...latestRO, customer: { ...latestRO.customer, name } };
      setCurrentRO(updated);
      setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      saveRO(updated);
    },
    [getLatestRO, saveRO]
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
    (newComplaints: string[], newLabels?: string[]) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const complaintLabels =
        newLabels && newLabels.length === newComplaints.length ? newLabels : latestRO.complaintLabels;
      const updatedLines = syncRepairLinesWithComplaints(
        latestRO.repairLines,
        newComplaints,
        complaintLabels
      );
      const updated = { ...latestRO, complaints: newComplaints, complaintLabels, repairLines: updatedLines };
      setCurrentRO(updated);
      setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      saveRO(updated);
    },
    [getLatestRO, saveRO]
  );

  const addComplaint = useCallback(() => {
    const latestRO = getLatestRO();
    if (!latestRO) return;
    const complaints = [...(latestRO.complaints || []), 'New concern - describe symptom'];
    const labels = [...(latestRO.complaintLabels || latestRO.complaints.map((_, i) => String.fromCharCode(65 + i)))];
    labels.push(nextComplaintLabel(labels, complaints.length - 1));
    updateComplaints(complaints, labels);
  }, [getLatestRO, nextComplaintLabel, updateComplaints]);

  const removeComplaint = useCallback(
    (index: number) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const complaints = (latestRO.complaints || []).filter((_, i) => i !== index);
      const labels = latestRO.complaintLabels?.filter((_, i) => i !== index);
      updateComplaints(complaints, labels);
    },
    [getLatestRO, updateComplaints]
  );

  const editComplaint = useCallback(
    (index: number, value: string) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const updated = [...(latestRO.complaints || [])];
      updated[index] = value;
      updateComplaints(updated);
    },
    [getLatestRO, updateComplaints]
  );

  const updateRONumber = useCallback(
    (roNumber: string) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const updated = { ...latestRO, roNumber: roNumber.trim() };
      setCurrentRO(updated);
      setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      saveRO(updated);
    },
    [getLatestRO, saveRO]
  );

  const decodeVinForRO = useCallback(async () => {
    const latestRO = getLatestRO();
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
  }, [getLatestRO, updateVehicle]);

  const addRepairLine = useCallback(async () => {
    const latestRO = getLatestRO();
    if (!latestRO) return;
    const newLine = createNewRepairLine(latestRO.repairLines.length + 1);
    const updated = { ...latestRO, repairLines: [...latestRO.repairLines, newLine] };
    const saved = await persistRO(updated);
    setCurrentRO(saved);
    setCurrentLineId(saved.repairLines[saved.repairLines.length - 1].id);
    setView('line');
  }, [getLatestRO, persistRO]);

  const applySmartDefaultsToLine = useCallback(
    (lineId: string) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      const line = latestRO.repairLines.find((l) => l.id === lineId);
      if (!line) return;
      const sugg = getSuggestions(latestRO);
      let notes = (line.technicianNotes || '').trim();
      const addBlock = `\n\n[Reference only — not performed unless documented]\n[Smart defaults for ${sugg.bandNote}]\nCommon issues at this mileage: ${sugg.issues.join(' • ')}\nTypical spec references: ${sugg.tests.map((t) => `${t.label}: ${t.spec}${t.note ? ' (' + t.note + ')' : ''}`).join('; ')}`;
      if (!notes.includes('Smart defaults')) notes = (notes + addBlock).trim();
      updateLine(lineId, { technicianNotes: notes });
      toast.success('Reference notes added');
    },
    [getLatestRO, updateLine]
  );

  const processXentryImages = useCallback(
    async (files: File[], existingImages: ImageAttachment[], existingOcr: string[], existingExtracted: ExtractedData) => {
      let updatedExtracted = existingExtracted;
      let updatedOcrTexts = existingOcr;
      const newImgs: ImageAttachment[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setOcrProgress(Math.round((i / files.length) * 25));
        const attachment = await uploadFileAsAttachment(file, 'ximg');
        newImgs.push(attachment);
        try {
          setOcrProgress(Math.round(25 + (i / files.length) * 20));
          const pre = await preprocessImageForOCR(file, 'fast');
          const text = await runOCR(pre, (p) =>
            setOcrProgress(Math.round(45 + ((i + p / 100) / files.length) * 55))
          );
          const diag = parseDiagnosticText(text);
          updatedExtracted = mergeExtracted(updatedExtracted, diag);
          updatedOcrTexts = [...updatedOcrTexts, text];
        } catch (err) {
          console.warn('Xentry OCR failed for one image', err);
        }
      }

      return { newImgs, updatedExtracted, updatedOcrTexts, allImages: [...existingImages, ...newImgs] };
    },
    [setOcrProgress]
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
        onOcrStart();
        const latestRO = getLatestRO();
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
          await saveRO(updated);
          const updatedLine = updatedLines.find((l) => l.id === lineId);
          if (updatedLine && (!updatedLine.technicianNotes || updatedLine.technicianNotes.trim().length < 5)) {
            setTimeout(() => applySmartDefaultsToLine(lineId), 60);
          }
          toast.success(`${files.length} diagnostic photo(s) analyzed`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to upload photos');
        } finally {
          onOcrFinish();
        }
      };
      input.click();
    },
    [currentRO, getLatestRO, processXentryImages, saveRO, onOcrStart, onOcrFinish, applySmartDefaultsToLine]
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
      onOcrStart();
      const latestRO = getLatestRO();
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
        await saveRO({
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
  }, [currentRO, getLatestRO, processXentryImages, saveRO, onOcrStart, onOcrFinish]);

  const generateStory = useCallback(
    async (lineId: string) => {
      const latestRO = getLatestRO();
      if (!latestRO) return;
      setIsGenerating(true);
      try {
        const { warrantyStory } = await api.generateStory(latestRO.id, lineId);
        const updatedLines = latestRO.repairLines.map((l) => (l.id === lineId ? { ...l, warrantyStory } : l));
        const updated = { ...latestRO, repairLines: updatedLines };
        setCurrentRO(updated);
        setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        toast.success('Warranty story generated');
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Story generation failed');
      } finally {
        setIsGenerating(false);
      }
    },
    [getLatestRO]
  );

  const currentLine = currentRO?.repairLines.find((l) => l.id === currentLineId);

  const filteredROs = allROs
    .filter(
      (ro) =>
        ro.roNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (ro.vehicle.make && ro.vehicle.make.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (ro.vehicle.model && ro.vehicle.model.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (ro.vehicle.year && ro.vehicle.year.includes(searchTerm)) ||
        (ro.vehicle.vin && ro.vehicle.vin.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => ((b.createdAt || '0') > (a.createdAt || '0') ? 1 : -1));

  return {
    view,
    setView,
    currentRO,
    setCurrentRO,
    currentLineId,
    setCurrentLineId,
    currentLine,
    allROs,
    loading,
    refreshList,
    searchTerm,
    setSearchTerm,
    pendingROImages,
    setPendingROImages,
    isGenerating,
    filteredROs,
    getLatestRO,
    deleteRO,
    openRO,
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
    applySmartDefaultsToLine,
    addXentryPhotos,
    addROXentryPhotos,
    generateStory,
  };
}