import { Camera, Plus, Trash2 } from 'lucide-react';
import type { RepairOrder } from '../types';

interface ROViewProps {
  ro: RepairOrder;
  isProcessingOCR: boolean;
  ocrProgress: number;
  onDone: () => void;
  onUpdateRONumber: (value: string) => void;
  onUpdateVehicle: (field: 'vin' | 'year' | 'make' | 'model' | 'engine' | 'mileageIn' | 'mileageOut', value: string) => void;
  onUpdateCustomer: (value: string) => void;
  onAddComplaint: () => void;
  onEditComplaint: (index: number, value: string) => void;
  onRemoveComplaint: (index: number) => void;
  onDecodeVin: () => void;
  onAddROXentryPhotos: () => void;
  onAddRepairLine: () => void;
  onOpenLine: (lineId: string) => void;
  onDeleteRO: () => void;
}

const letter = (i: number) => String.fromCharCode(65 + i);

export function ROView({
  ro,
  isProcessingOCR,
  ocrProgress,
  onDone,
  onUpdateRONumber,
  onUpdateVehicle,
  onUpdateCustomer,
  onAddComplaint,
  onEditComplaint,
  onRemoveComplaint,
  onDecodeVin,
  onAddROXentryPhotos,
  onAddRepairLine,
  onOpenLine,
  onDeleteRO,
}: ROViewProps) {
  return (
    <div className="px-5 pt-4 pb-8">
      <div className="flex justify-between items-center mb-3">
        <div>
          <div className="text-xl font-semibold">{ro.roNumber}</div>
          <div className="text-sm text-[#8e8e93]">Repair Order • Pre-populated from scan or manual entry</div>
          {(ro.serviceAdvisor?.displayName || ro.serviceAdvisorName) && (
            <div className="text-[10px] text-[#0a84ff] mt-1">
              Service Advisor: {ro.serviceAdvisor?.displayName || ro.serviceAdvisorName}
            </div>
          )}
        </div>
        <button onClick={onDone} className="text-[#0a84ff] text-sm">
          Done
        </button>
      </div>

      <div className="ios-card p-5 mb-6">
        <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-3">
          RO DETAILS (from first block of scan — RO# at top center, vehicle fields, all complaints from any page)
        </div>

        <div className="mb-3">
          <label className="text-[10px] text-[#8e8e93] block mb-0.5">RO NUMBER</label>
          <input
            value={ro.roNumber}
            onChange={(e) => onUpdateRONumber(e.target.value)}
            placeholder="RO-123456"
            className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm font-mono tracking-[1px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">YEAR</label>
            <input
              value={ro.vehicle.year}
              onChange={(e) => onUpdateVehicle('year', e.target.value)}
              placeholder="2023"
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">MAKE</label>
            <input
              value={ro.vehicle.make}
              onChange={(e) => onUpdateVehicle('make', e.target.value)}
              placeholder="Mercedes-Benz"
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">MODEL</label>
            <input
              value={ro.vehicle.model}
              onChange={(e) => onUpdateVehicle('model', e.target.value)}
              placeholder="GLE 450 4MATIC"
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">MILEAGE IN</label>
            <input
              value={ro.vehicle.mileageIn}
              onChange={(e) => onUpdateVehicle('mileageIn', e.target.value)}
              placeholder="48250"
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm"
            />
          </div>
        </div>

          <div className="mb-3">
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">VIN</label>
            <div className="flex gap-2">
              <input
                value={ro.vehicle.vin}
                onChange={(e) => onUpdateVehicle('vin', e.target.value.toUpperCase())}
                placeholder="W1Nxxxx..."
                maxLength={17}
                className="flex-1 bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm font-mono tracking-[1px]"
              />
              <button
                onClick={onDecodeVin}
                disabled={ro.vehicle.vin.length < 17}
                className="secondary-btn px-3 text-[10px] font-semibold whitespace-nowrap disabled:opacity-50"
              >
                DECODE VIN
              </button>
            </div>
            <p className="text-[9px] text-[#666] mt-1">NHTSA vPIC — auto-fills year, make, model, engine</p>
          </div>

          <div className="mb-3">
            <label className="text-[10px] text-[#8e8e93] block mb-0.5">ENGINE</label>
            <input
              value={ro.vehicle.engine || ''}
              onChange={(e) => onUpdateVehicle('engine', e.target.value)}
              placeholder="3.0L 6-cyl (from VIN decode)"
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm"
            />
          </div>

        <div className="mb-4">
          <label className="text-[10px] text-[#8e8e93] block mb-0.5">CUSTOMER NAME</label>
          <input
            value={ro.customer?.name || ''}
            onChange={(e) => onUpdateCustomer(e.target.value)}
            placeholder="John Smith"
            className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <div className="border-t border-[#38383a] pt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-widest text-[#8e8e93]">CUSTOMER COMPLAINTS (A, B, C, D... from any page)</div>
            <button onClick={onAddComplaint} className="text-[#0a84ff] text-xs flex items-center gap-1">
              <Plus size={14} /> ADD
            </button>
          </div>
          <p className="text-[9px] text-[#8e8e93] mb-2">Pre-populated from scan (first block + multi-page). Edit as needed.</p>

          {ro.complaints && ro.complaints.length > 0 ? (
            ro.complaints.map((c, idx) => (
              <div key={idx} className="flex gap-2 mb-2 items-start">
                <div className="mt-2 w-6 text-[#0a84ff] font-semibold text-sm shrink-0">{letter(idx)}.</div>
                <textarea
                  value={c}
                  onChange={(e) => onEditComplaint(idx, e.target.value)}
                  className="flex-1 bg-[#2c2c2e] border border-[#38383a] rounded-2xl px-3 py-2 text-sm min-h-[48px] resize-y"
                />
                <button onClick={() => onRemoveComplaint(idx)} className="mt-1 p-1.5 text-[#ff9f0a]" title="Remove complaint">
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="text-sm text-[#8e8e93] mb-2">No complaints extracted. Add or rescan.</div>
          )}
          <button onClick={onAddComplaint} className="text-xs text-[#0a84ff] mt-1">
            + Add another complaint
          </button>
        </div>
      </div>

      <div className="ios-card p-4 mb-6">
        <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-1">XENTRY / DIAGNOSTIC IMAGE SCANS (RO level)</div>
        <p className="text-[10px] text-[#8e8e93] mb-2 leading-snug">
          Upload or capture XENTRY Quick Test, fault codes, Guided Tests, wiring diagrams, continuity checks, measurements. OCR +
          smart parsing feeds the AI.
        </p>
        <button
          onClick={onAddROXentryPhotos}
          disabled={isProcessingOCR}
          className="secondary-btn w-full h-12 flex items-center justify-center gap-2 text-sm mb-2"
        >
          <Camera size={18} />
          {isProcessingOCR ? `ANALYZING... ${ocrProgress}%` : 'SCAN / ADD XENTRY PHOTOS (QT, CODES, GUIDED, WIRING...)'}
        </button>
        {ro.xentryImages && ro.xentryImages.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-2">
            {ro.xentryImages.map((img, idx) => (
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
        {ro.repairLines[0]?.extractedData &&
          (ro.repairLines[0].extractedData.codes.length > 0 ||
            ro.repairLines[0].extractedData.guidedTests.length > 0 ||
            ro.repairLines[0].extractedData.measurements.length > 0) && (
            <div className="text-[10px] bg-[#1c1c1e] p-2 rounded">
              <div className="font-semibold mb-0.5">Extracted:</div>
              {ro.repairLines[0].extractedData.codes.length > 0 && (
                <div>Codes: {ro.repairLines[0].extractedData.codes.join(', ')}</div>
              )}
              {ro.repairLines[0].extractedData.guidedTests.length > 0 && (
                <div>Guided: {ro.repairLines[0].extractedData.guidedTests.slice(0, 2).join(' | ')}</div>
              )}
              {ro.repairLines[0].extractedData.measurements.length > 0 && (
                <div>
                  Meas:{' '}
                  {ro.repairLines[0].extractedData.measurements
                    .slice(0, 1)
                    .map((m) => `${m.label}=${m.value}`)
                    .join('; ')}
                </div>
              )}
            </div>
          )}
      </div>

      <div className="flex items-center justify-between mb-3 px-1">
        <div className="text-sm font-semibold text-[#8e8e93]">REPAIR LINES (A/B/C map to lines)</div>
        <button onClick={onAddRepairLine} className="flex items-center gap-1 text-[#0a84ff] text-sm font-medium">
          <Plus size={16} /> ADD LINE
        </button>
      </div>

      <div className="space-y-2">
        {ro.repairLines.map((line) => (
          <div
            key={line.id}
            onClick={() => onOpenLine(line.id)}
            className="ios-card px-4 py-4 flex justify-between items-center active:bg-[#252528] cursor-pointer"
          >
            <div>
              <div className="font-medium">
                Line {line.lineNumber}: {line.description}
              </div>
              {line.customerConcern && (
                <div className="text-[10px] text-[#8e8e93] mt-0.5 truncate max-w-[240px]">{line.customerConcern}</div>
              )}
              {line.warrantyStory && <div className="text-xs text-[#30d158] mt-0.5">Story ready</div>}
            </div>
            <div className="text-[#8e8e93]">›</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-6">
        <button onClick={onDone} className="flex-1 text-sm text-[#8e8e93] py-2 border border-[#38383a] rounded">
          Back to List
        </button>
        <button onClick={onDeleteRO} className="flex-1 text-sm text-[#ff9f0a] py-2 border border-[#38383a] rounded">
          Delete RO
        </button>
      </div>
    </div>
  );
}