'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, BookmarkPlus, Camera, Copy, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { StableInput } from '@/components/StableInput';
import { StableTextarea } from '@/components/StableTextarea';
import { SaveTemplateModal } from '@/components/SaveTemplateModal';
import { TemplateLibraryModal } from '@/components/TemplateLibraryModal';
import type { RepairLine, RepairOrder } from '@/types';
import { WARRANTY_STORY_MAX_CHARS, WARRANTY_STORY_WARN_CHARS } from '@/types';
import { getSuggestions } from '@/utils/mercedesKb';
import { copyFormattedStory, exportWarrantyStoryPdf } from '@/utils/pdfExport';

interface LineViewProps {
  ro: RepairOrder;
  line: RepairLine;
  isProcessingOCR: boolean;
  ocrProgress: number;
  isGenerating: boolean;
  lastGeneratedStoryText: string | null;
  onBack: () => void;
  onUpdateLine: (updates: Partial<RepairLine>) => void;
  onAddXentryPhotos: () => void;
  onApplySmartDefaults: () => void;
  onGenerateStory: () => void;
  onAcknowledgeStoryBaseline: (text: string) => void;
}

function complaintLabel(labels: string[] | undefined, index: number): string {
  return labels?.[index] || String.fromCharCode(65 + index);
}

function charCountColor(len: number): string {
  if (len > WARRANTY_STORY_MAX_CHARS) return 'text-[#ff3b30]';
  if (len > WARRANTY_STORY_WARN_CHARS) return 'text-[#ff9f0a]';
  return 'text-[#8e8e93]';
}

export function LineView({
  ro,
  line,
  isProcessingOCR,
  ocrProgress,
  isGenerating,
  lastGeneratedStoryText,
  onBack,
  onUpdateLine,
  onAddXentryPhotos,
  onApplySmartDefaults,
  onGenerateStory,
  onAcknowledgeStoryBaseline,
}: LineViewProps) {
  const vehicleSummary = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
  const mileageStr = ro.vehicle.mileageIn ? `${ro.vehicle.mileageIn} mi` : '';
  const suggestions = getSuggestions(ro);
  const storyLen = line.warrantyStory?.length ?? 0;
  const advisorName = ro.serviceAdvisor?.displayName || ro.serviceAdvisorName;
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

  const canSaveAsTemplate = useMemo(() => {
    if (!lastGeneratedStoryText || !line.warrantyStory?.trim()) return false;
    return line.warrantyStory.trim() !== lastGeneratedStoryText.trim();
  }, [lastGeneratedStoryText, line.warrantyStory]);

  const defaultTemplateTitle = useMemo(() => {
    const base = line.description?.trim() || 'Warranty Story';
    return base.length > 80 ? `${base.slice(0, 77)}…` : base;
  }, [line.description]);

  const handleInsertTemplate = (content: string, title: string) => {
    const existing = line.warrantyStory?.trim();
    const next = existing ? `${existing}\n\n---\n${title}\n\n${content}` : content;
    onUpdateLine({ warrantyStory: next });
    toast.success(`Inserted "${title}" into story`);
  };

  const handleCopy = async () => {
    if (!line.warrantyStory) return;
    try {
      await copyFormattedStory(ro, line);
      toast.success('Copied with RO header formatting');
    } catch {
      toast.error('Clipboard copy failed');
    }
  };

  const handlePdf = () => {
    if (!line.warrantyStory) return;
    try {
      exportWarrantyStoryPdf(ro, line);
      toast.success('PDF downloaded');
    } catch {
      toast.error('PDF export failed');
    }
  };

  return (
    <div className="px-5 pt-4 pb-10">
      <button onClick={onBack} className="flex items-center text-[#0a84ff] mb-4">
        <ArrowLeft size={18} className="mr-1" /> Back to RO
      </button>

      <div className="ios-card p-3 mb-4 text-xs">
        <div className="font-semibold mb-0.5">
          {vehicleSummary} {mileageStr ? `• ${mileageStr}` : ''}{' '}
          {ro.vehicle.vin ? `• VIN ${ro.vehicle.vin.slice(0, 10)}...` : ''}
        </div>
        {ro.vehicle.engine && <div className="text-[#8e8e93]">Engine: {ro.vehicle.engine}</div>}
        {ro.complaints && ro.complaints.length > 0 && (
          <div className="mt-1.5 text-[10px] text-[#8e8e93]">
            Complaints:{' '}
            {ro.complaints
              .map((c, i) => `${complaintLabel(ro.complaintLabels, i)}. ${c.slice(0, 42)}${c.length > 42 ? '…' : ''}`)
              .join('  ')}
          </div>
        )}
      </div>

      <div className="mb-5">
        <div className="text-sm text-[#8e8e93]">LINE {line.lineNumber}</div>
        <StableInput
          fieldKey={`${line.id}-description`}
          value={line.description}
          onChange={(v) => onUpdateLine({ description: v })}
          showVoice
          className="text-xl font-semibold bg-transparent w-full focus:outline-none border-none"
        />
      </div>

      <div className="space-y-5">
        <div>
          <label className="text-xs uppercase tracking-widest text-[#8e8e93] block mb-1.5">CUSTOMER CONCERN (prefilled from scan)</label>
          <StableTextarea
            fieldKey={`${line.id}-concern`}
            value={line.customerConcern}
            onChange={(v) => onUpdateLine({ customerConcern: v })}
            className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-2xl p-3.5 text-sm min-h-[80px]"
            placeholder="Customer stated..."
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-widest text-[#8e8e93] block mb-1.5">TECHNICIAN NOTES + FINDINGS</label>
          <StableTextarea
            fieldKey={`${line.id}-notes`}
            value={line.technicianNotes}
            onChange={(v) => onUpdateLine({ technicianNotes: v })}
            className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-2xl p-3.5 text-sm min-h-[100px]"
            placeholder="Document actual test results, findings, and repair steps performed..."
          />
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-1.5">DIAGNOSTIC EVIDENCE PHOTOS</div>
          <button
            onClick={onAddXentryPhotos}
            disabled={isProcessingOCR}
            className="secondary-btn w-full h-12 flex items-center justify-center gap-2 text-sm mb-2 disabled:opacity-60"
          >
            {isProcessingOCR ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
            {isProcessingOCR ? `ANALYZING PHOTOS... ${ocrProgress}%` : 'ADD XENTRY TESTS / FAULT CODES / GUIDED / WIRING / CONTINUITY'}
          </button>
          <p className="text-[10px] text-[#8e8e93] -mt-1 mb-2">Photos analyzed with OCR. Only extracted data is used in warranty stories.</p>

          {line.xentryImages && line.xentryImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-2">
              {line.xentryImages.map((img, idx) => (
                <img
                  key={idx}
                  src={img.url}
                  className="w-full h-16 object-cover rounded border border-[#38383a]"
                  alt={img.name}
                  onClick={() => window.open(img.url)}
                />
              ))}
            </div>
          )}
          {line.extractedData &&
            (line.extractedData.codes.length || line.extractedData.guidedTests.length || line.extractedData.measurements.length) > 0 && (
              <div className="text-[10px] bg-[#1c1c1e] p-2 rounded mb-2">
                <div className="font-semibold mb-1">Extracted from photos:</div>
                {line.extractedData.codes.length > 0 && <div>Codes: {line.extractedData.codes.join(', ')}</div>}
                {line.extractedData.guidedTests.length > 0 && (
                  <div>Guided: {line.extractedData.guidedTests.slice(0, 2).join(' | ')}</div>
                )}
                {line.extractedData.measurements.length > 0 && (
                  <div>
                    Meas: {line.extractedData.measurements[0].label}={line.extractedData.measurements[0].value}
                  </div>
                )}
              </div>
            )}
        </div>

        <div className="ios-card p-3 mb-1">
          <div className="flex justify-between items-center mb-1">
            <div className="text-xs uppercase tracking-widest text-[#8e8e93]">REFERENCE: COMMON ISSUES &amp; TYPICAL SPECS</div>
            <button onClick={onApplySmartDefaults} className="text-[10px] px-2 py-0.5 bg-[#2c2c2e] rounded text-[#0a84ff]">
              ADD TO NOTES
            </button>
          </div>
          <div className="text-[10px] text-[#8e8e93]">
            {suggestions.bandNote} — {suggestions.issues.slice(0, 2).join(', ')}... Typical:{' '}
            {suggestions.tests.slice(0, 2).map((t) => t.label).join(' / ')}
          </div>
          <div className="text-[9px] mt-1 text-[#666]">
            Reference only — not used as performed work unless you document actual results in notes or OCR.
          </div>
        </div>

        {advisorName && (
          <div className="ios-card p-3 mb-2 border border-[#0a84ff]/20">
            <div className="flex items-center gap-2 text-[#0a84ff] text-xs font-medium">
              <Sparkles size={14} />
              Advisor Intelligence active
            </div>
            <p className="text-[10px] text-[#8e8e93] mt-1 leading-relaxed">
              Story generation will match {advisorName}&apos;s complaint phrasing style for this RO.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowTemplateLibrary(true)}
            disabled={isGenerating}
            className="secondary-btn w-full h-12 flex items-center justify-center gap-2 text-sm disabled:opacity-60"
          >
            <BookOpen size={18} />
            TEMPLATE LIBRARY
          </button>

          <div className={`grid gap-2 ${canSaveAsTemplate ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <button
              onClick={onGenerateStory}
              disabled={isGenerating}
              className="primary-btn w-full h-14 text-base flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  GENERATING WITH GROK…
                </>
              ) : (
                'GENERATE WARRANTY STORY'
              )}
            </button>

            {canSaveAsTemplate && lastGeneratedStoryText && (
              <button
                type="button"
                onClick={() => setShowSaveTemplate(true)}
                disabled={isGenerating}
                className="secondary-btn w-full h-14 text-sm flex items-center justify-center gap-2 border-[#30d158]/40 text-[#30d158] disabled:opacity-60"
              >
                <BookmarkPlus size={18} />
                SAVE AS NEW TEMPLATE
              </button>
            )}
          </div>

          <p className="text-[10px] text-[#8e8e93] text-center leading-snug">
            Generate with Grok, edit the story, then save it to grow your dealership knowledge base.
          </p>
        </div>

        {line.warrantyStory && (
          <div className="story-card p-5 mt-2">
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs uppercase tracking-[1px] text-[#8e8e93]">WARRANTY STORY — 3 C&apos;s • AUDIT-SAFE</div>
              <div className={`text-[10px] font-mono ${charCountColor(storyLen)}`}>
                {storyLen} / {WARRANTY_STORY_MAX_CHARS}
              </div>
            </div>
            {storyLen > WARRANTY_STORY_MAX_CHARS && (
              <div className="text-[10px] text-[#ff3b30] mb-2">Exceeds recommended DMS character limit — edit before submission.</div>
            )}
            <StableTextarea
              fieldKey={`${line.id}-story`}
              value={line.warrantyStory}
              onChange={(v) => onUpdateLine({ warrantyStory: v })}
              className="w-full bg-[#1c1c1e] border border-[#38383a] rounded p-3 text-[14.5px] leading-relaxed mb-3 min-h-[200px] resize-y"
              placeholder="Edit warranty story before DMS submission..."
            />
            <div className="flex gap-2 flex-wrap">
              {canSaveAsTemplate && (
                <button
                  type="button"
                  onClick={() => setShowSaveTemplate(true)}
                  className="flex-1 min-w-[160px] secondary-btn h-11 flex items-center justify-center gap-2 text-sm border-[#30d158]/30 text-[#30d158]"
                >
                  <BookmarkPlus size={16} /> SAVE TEMPLATE
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowTemplateLibrary(true)}
                className="flex-1 min-w-[120px] secondary-btn h-11 flex items-center justify-center gap-2 text-sm"
              >
                <BookOpen size={16} /> TEMPLATES
              </button>
              <button onClick={handleCopy} className="flex-1 min-w-[120px] secondary-btn h-11 flex items-center justify-center gap-2 text-sm">
                <Copy size={16} /> COPY
              </button>
              <button onClick={handlePdf} className="flex-1 min-w-[120px] secondary-btn h-11 flex items-center justify-center gap-2 text-sm">
                <Download size={16} /> PDF
              </button>
              <button
                onClick={onGenerateStory}
                disabled={isGenerating}
                className="secondary-btn h-11 px-5 flex items-center gap-2 text-sm disabled:opacity-60"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                REGEN
              </button>
            </div>
          </div>
        )}
      </div>

      <TemplateLibraryModal
        key={libraryRefreshKey}
        open={showTemplateLibrary}
        onClose={() => setShowTemplateLibrary(false)}
        onInsert={handleInsertTemplate}
      />

      {lastGeneratedStoryText && (
        <SaveTemplateModal
          open={showSaveTemplate}
          onClose={() => setShowSaveTemplate(false)}
          onSaved={(_title, savedText) => {
            onAcknowledgeStoryBaseline(savedText);
            setLibraryRefreshKey((k) => k + 1);
          }}
          defaultTitle={defaultTemplateTitle}
          defaultCategory="warranty"
          storyText={line.warrantyStory || ''}
          generatedText={lastGeneratedStoryText}
          lineDescription={line.description}
          vehicleMake={ro.vehicle.make}
          vehicleModel={ro.vehicle.model}
          codes={line.extractedData?.codes}
          repairOrderId={ro.id}
          lineId={line.id}
        />
      )}
    </div>
  );
}