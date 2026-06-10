import { Camera, FolderOpen, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { PendingImage } from '@/types';

interface ScanROSectionProps {
  pendingROImages: PendingImage[];
  isProcessingOCR: boolean;
  ocrProgress: number;
  scanStatusMessage: string;
  onScanRO: () => void;
  onAddFromGallery: () => void;
  onProcessScan: () => void;
  onClearPendingScan: () => void;
  onCancelScan: () => void;
  onCreateManualRO: () => void;
  scanButtonLabel?: string;
  compact?: boolean;
}

export function ScanROSection({
  pendingROImages,
  isProcessingOCR,
  ocrProgress,
  scanStatusMessage,
  onScanRO,
  onAddFromGallery,
  onProcessScan,
  onClearPendingScan,
  onCancelScan,
  onCreateManualRO,
  scanButtonLabel = 'SCAN RO',
  compact = false,
}: ScanROSectionProps) {
  const buttonHeight = compact ? 'h-11' : 'h-12';
  const buttonText = compact ? 'text-xs' : 'text-sm';
  const hasPending = pendingROImages.length > 0;

  return (
    <div className="mb-4">
      {!isProcessingOCR && (
        <div className="flex gap-2 mb-2">
          <button
            onClick={onScanRO}
            className={`primary-btn flex-1 ${buttonHeight} flex items-center justify-center gap-2 ${buttonText} font-semibold`}
          >
            <Camera size={compact ? 16 : 18} />
            {hasPending ? 'ADD PAGE' : scanButtonLabel}
          </button>
          <button
            onClick={onAddFromGallery}
            className={`secondary-btn flex-1 ${buttonHeight} flex items-center justify-center gap-2 ${buttonText} font-semibold`}
          >
            <FolderOpen size={compact ? 16 : 18} />
            GALLERY
          </button>
          <button
            onClick={onCreateManualRO}
            className={`secondary-btn flex-1 ${buttonHeight} flex items-center justify-center gap-2 ${buttonText} font-semibold`}
          >
            <Plus size={compact ? 16 : 18} />
            {compact ? 'MANUAL' : 'MANUAL RO'}
          </button>
        </div>
      )}

      {isProcessingOCR && (
        <div className="flex gap-2 mb-2">
          <button
            disabled
            className={`primary-btn flex-1 ${buttonHeight} flex items-center justify-center gap-2 ${buttonText} font-semibold opacity-60`}
          >
            <Loader2 size={compact ? 16 : 18} className="animate-spin" />
            SCANNING… {ocrProgress}%
          </button>
        </div>
      )}

      {hasPending && !isProcessingOCR && (
        <div className="flex gap-2 mb-2">
          <button
            onClick={onProcessScan}
            disabled={isProcessingOCR}
            className={`primary-btn flex-[2] ${buttonHeight} flex items-center justify-center gap-2 ${buttonText} font-semibold`}
          >
            <Sparkles size={compact ? 16 : 18} />
            PROCESS RO ({pendingROImages.length} PAGE{pendingROImages.length === 1 ? '' : 'S'})
          </button>
          <button
            onClick={onClearPendingScan}
            className={`secondary-btn flex-1 ${buttonHeight} flex items-center justify-center gap-2 ${buttonText} font-semibold`}
          >
            <Trash2 size={compact ? 16 : 18} />
            CLEAR
          </button>
        </div>
      )}

      {isProcessingOCR && (
        <div className="ios-card p-3 mb-2">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs uppercase tracking-widest text-[#8e8e93]">Scan in progress</div>
            <button onClick={onCancelScan} className="text-[10px] text-[#ff9f0a] font-semibold">
              CANCEL
            </button>
          </div>
          <div className="h-1.5 bg-[#2c2c2e] rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-[#0a84ff] transition-all duration-300 ease-out"
              style={{ width: `${Math.max(ocrProgress, 4)}%` }}
            />
          </div>
          <p className="text-xs text-[#8e8e93]">{scanStatusMessage || 'Processing documents…'}</p>
        </div>
      )}

      {hasPending && (
        <div className="ios-card p-3 mb-2">
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-2">
            {isProcessingOCR
              ? `PROCESSING ${pendingROImages.length} PAGE${pendingROImages.length === 1 ? '' : 'S'}`
              : `READY — ${pendingROImages.length} PAGE${pendingROImages.length === 1 ? '' : 'S'} CAPTURED`}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {pendingROImages.map((img) => (
              <div key={img.id} className="relative">
                <img
                  src={img.previewUrl}
                  className="w-full h-16 object-cover rounded border border-[#38383a]"
                  alt={img.name}
                />
                {isProcessingOCR && (
                  <div className="absolute inset-0 bg-black/40 rounded flex items-center justify-center">
                    <Loader2 size={14} className="animate-spin text-white" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isProcessingOCR && !hasPending && (
        <p className="text-center text-[10px] text-[#8e8e93] -mt-1 mb-1">
          Tap {scanButtonLabel} to capture each RO page (usually 3–5). Use flash or even lighting and avoid hand shadows
          on faded or colored paper. Add from Gallery for PDFs or batch photos. Tap Process RO when all pages are
          captured.
        </p>
      )}
    </div>
  );
}