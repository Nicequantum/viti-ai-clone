'use client';

import { Loader2 } from 'lucide-react';
import type { RepairOrder } from '@/types';

interface RepairOrderListProps {
  repairOrders: RepairOrder[];
  openingROId: string | null;
  onOpenRO: (ro: RepairOrder) => void;
  onDeleteRO?: (id: string) => void;
  emptyMessage?: string;
  emptyHint?: string;
}

export function RepairOrderList({
  repairOrders,
  openingROId,
  onOpenRO,
  onDeleteRO,
  emptyMessage = 'No repair orders yet.',
  emptyHint,
}: RepairOrderListProps) {
  if (repairOrders.length === 0) {
    return (
      <div className="text-center py-10 text-[#8e8e93]">
        <p>{emptyMessage}</p>
        {emptyHint && <p className="text-xs mt-1">{emptyHint}</p>}
      </div>
    );
  }

  const isOpening = openingROId !== null;

  return (
    <div className="space-y-2">
      {repairOrders.map((ro) => {
        const isThisOpening = openingROId === ro.id;
        const vehicleSummary = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ');

        return (
          <div
            key={ro.id}
            role="button"
            tabIndex={isOpening && !isThisOpening ? -1 : 0}
            aria-busy={isThisOpening}
            aria-disabled={isOpening && !isThisOpening}
            onClick={() => {
              if (isOpening) return;
              onOpenRO(ro);
            }}
            onKeyDown={(e) => {
              if (isOpening) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenRO(ro);
              }
            }}
            className={`ios-card p-3 flex justify-between items-center transition-colors touch-manipulation select-none ${
              isThisOpening
                ? 'ring-2 ring-[#0a84ff]/60 bg-[#252528] cursor-wait'
                : isOpening
                  ? 'opacity-60 cursor-not-allowed'
                  : 'active:bg-[#252528] cursor-pointer hover:bg-[#252528]/60'
            }`}
          >
            <div className="min-w-0 flex-1 pr-2">
              <div className="font-semibold text-sm">{ro.roNumber}</div>
              <div className="text-xs text-[#8e8e93]">
                {vehicleSummary || 'Vehicle TBD'} • {ro.repairLines.length} line{ro.repairLines.length === 1 ? '' : 's'}
                {ro.technicianName ? ` • ${ro.technicianName}` : ''}
              </div>
              {ro.complaints[0] && (
                <div className="text-[10px] text-[#8e8e93] mt-0.5 truncate">
                  {ro.complaints[0].slice(0, 72)}
                  {ro.complaints[0].length > 72 ? '…' : ''}
                </div>
              )}
              {ro.createdAt && (
                <div className="text-[9px] text-[#666] mt-0.5">{new Date(ro.createdAt).toLocaleDateString()}</div>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1">
              {isThisOpening ? (
                <Loader2 size={18} className="text-[#0a84ff] animate-spin" aria-label="Loading repair order" />
              ) : (
                <>
                  {ro.repairLines.some((l) => l.warrantyStory) && (
                    <div className="text-[10px] text-[#30d158]">✓ stories</div>
                  )}
                  <div className="text-[#8e8e93] text-lg leading-none" aria-hidden="true">
                    ›
                  </div>
                </>
              )}
              {onDeleteRO && !isThisOpening && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isOpening) return;
                    onDeleteRO(ro.id);
                  }}
                  className="text-[10px] text-[#ff9f0a] mt-0.5"
                >
                  DEL
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}