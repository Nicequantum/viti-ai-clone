import { Settings } from 'lucide-react';
import { DealershipBranding } from '@/components/DealershipBranding';
import { RepairOrderList } from '@/components/RepairOrderList';
import { ScanROSection } from '@/components/ScanROSection';
import type { PendingImage, RepairOrder } from '../types';

interface HomeViewProps {
  technicianName?: string;
  filteredROs: RepairOrder[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
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
  openingROId: string | null;
  onOpenRO: (ro: RepairOrder) => void;
  onDeleteRO: (id: string) => void;
  onOpenSettings: () => void;
}

export function HomeView({
  technicianName,
  filteredROs,
  searchTerm,
  onSearchChange,
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
  openingROId,
  onOpenRO,
  onDeleteRO,
  onOpenSettings,
}: HomeViewProps) {
  return (
    <div className="relative min-h-dvh px-4 pt-2 pb-8">
      <button
        onClick={onOpenSettings}
        className="absolute top-4 right-4 p-2 text-[#8e8e93] z-10 touch-target"
        aria-label="Settings"
      >
        <Settings size={22} />
      </button>

      <div className="pt-12">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#0a84ff] to-[#0066cc] flex items-center justify-center mb-3 p-1">
            <img src="/icon-512.png" alt="Benz Tech - Mercedes-Benz" className="w-full h-full rounded-2xl" />
          </div>
          <DealershipBranding size="lg" className="mb-2" />
          <p className="text-[#8e8e93] text-sm text-center">{technicianName || 'Technician'}</p>
        </div>

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
        />

        <div className="mb-3">
          <input
            type="text"
            placeholder="Search past ROs (number, model, VIN)..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[#1c1c1e] border border-[#38383a] rounded-xl px-4 py-2.5 text-sm placeholder-[#8e8e93]"
          />
        </div>

        {filteredROs.length > 0 && (
          <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-2 px-1">Previous Repair Orders</div>
        )}

        <RepairOrderList
          repairOrders={filteredROs}
          openingROId={openingROId}
          onOpenRO={onOpenRO}
          onDeleteRO={onDeleteRO}
          emptyMessage="No repair orders yet."
          emptyHint="Tap Scan RO to capture or upload repair order pages."
        />
      </div>
    </div>
  );
}