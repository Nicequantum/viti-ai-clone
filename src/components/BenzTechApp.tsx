'use client';

import { AppHeader } from '@/components/AppHeader';
import { ConsentModal } from '@/components/ConsentModal';
import { HomeView } from '@/components/HomeView';
import { LineView } from '@/components/LineView';
import { LoginView } from '@/components/LoginView';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ManagerDashboard } from '@/components/ManagerDashboard';
import { ROView } from '@/components/ROView';
import { AuditLogView } from '@/components/AuditLogView';
import { ServiceAdvisorsView } from '@/components/ServiceAdvisorsView';
import { SettingsView } from '@/components/SettingsView';
import { useOcrProgress } from '@/hooks/useOcrProgress';
import { useRepairOrders } from '@/hooks/useRepairOrders';
import { useSession } from '@/hooks/useSession';
import { useState } from 'react';

export function BenzTechApp() {
  const { session, loading: sessionLoading, login, logout, acceptConsent } = useSession();
  const ocr = useOcrProgress();
  const ro = useRepairOrders({
    onOcrStart: ocr.startOcr,
    onOcrFinish: ocr.finishOcr,
    setOcrProgress: ocr.setOcrProgress,
    setScanStatusMessage: ocr.setScanStatusMessage,
  });
  const [consentLoading, setConsentLoading] = useState(false);

  if (sessionLoading) {
    return <LoadingScreen label="Starting Benz Tech" sublabel="Verifying your session..." />;
  }

  if (ro.loading) {
    return <LoadingScreen label="Loading repair orders" sublabel="Syncing dealership data..." />;
  }

  if (!session) {
    return <LoginView onLogin={login} />;
  }

  if (!session.consentAt) {
    return (
      <ConsentModal
        loading={consentLoading}
        onAccept={async () => {
          setConsentLoading(true);
          try {
            await acceptConsent();
          } finally {
            setConsentLoading(false);
          }
        }}
      />
    );
  }

  const goToSettings = () => ro.setView('settings');
  const isManager = session.role === 'manager';

  const roListSection =
    ro.filteredROs.length === 0 ? (
      <div className="text-center py-8 text-[#8e8e93]">
        <p className="text-sm">No repair orders match your search.</p>
        <p className="text-xs mt-1">Scan a repair order to get started.</p>
      </div>
    ) : (
      <div className="space-y-2">
        {ro.filteredROs.map((item) => (
          <div
            key={item.id}
            onClick={() => ro.openRO(item)}
            className="ios-card p-3 active:bg-[#252528] cursor-pointer flex justify-between items-center"
          >
            <div>
              <div className="font-semibold text-sm">{item.roNumber}</div>
              <div className="text-xs text-[#8e8e93]">
                {[item.vehicle.year, item.vehicle.make, item.vehicle.model].filter(Boolean).join(' ')} •{' '}
                {item.repairLines.length} lines
                {item.technicianName ? ` • ${item.technicianName}` : ''}
              </div>
              {item.complaints[0] && (
                <div className="text-[10px] text-[#8e8e93] mt-0.5">{item.complaints[0].slice(0, 72)}...</div>
              )}
            </div>
            <div className="text-right">
              {item.repairLines.some((l) => l.warrantyStory) && (
                <div className="text-[10px] text-[#30d158]">✓ stories</div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  ro.deleteRO(item.id);
                }}
                className="text-[10px] text-[#ff9f0a] mt-1"
              >
                DEL
              </button>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <div className="app-container">
      {ro.view !== 'home' && ro.view !== 'settings' && ro.view !== 'audit' && ro.view !== 'advisors' && (
        <AppHeader technicianName={session.name} onOpenSettings={goToSettings} />
      )}

      {ro.view === 'home' && isManager && (
        <ManagerDashboard
          session={session}
          allROs={ro.allROs}
          filteredROs={ro.filteredROs}
          searchTerm={ro.searchTerm}
          onSearchChange={ro.setSearchTerm}
          onOpenRO={ro.openRO}
          onOpenSettings={goToSettings}
          onOpenAuditLogs={() => ro.setView('audit')}
          onOpenServiceAdvisors={() => ro.setView('advisors')}
          pendingROImages={ro.pendingROImages}
          onScanRO={ro.scanRO}
          onAddFromGallery={ro.addScanPagesFromGallery}
          onProcessScan={ro.processPendingScan}
          onClearPendingScan={ro.clearPendingScan}
          onCancelScan={ro.cancelScan}
          onCreateManualRO={ro.createManualRO}
          isProcessingOCR={ocr.isProcessingOCR}
          ocrProgress={ocr.ocrProgress}
          scanStatusMessage={ocr.scanStatusMessage}
        >
          {roListSection}
        </ManagerDashboard>
      )}

      {ro.view === 'home' && !isManager && (
        <HomeView
          technicianName={session.name}
          filteredROs={ro.filteredROs}
          searchTerm={ro.searchTerm}
          onSearchChange={ro.setSearchTerm}
          pendingROImages={ro.pendingROImages}
          isProcessingOCR={ocr.isProcessingOCR}
          ocrProgress={ocr.ocrProgress}
          scanStatusMessage={ocr.scanStatusMessage}
          onScanRO={ro.scanRO}
          onAddFromGallery={ro.addScanPagesFromGallery}
          onProcessScan={ro.processPendingScan}
          onClearPendingScan={ro.clearPendingScan}
          onCancelScan={ro.cancelScan}
          onCreateManualRO={ro.createManualRO}
          onOpenRO={ro.openRO}
          onDeleteRO={ro.deleteRO}
          onOpenSettings={goToSettings}
        />
      )}

      {ro.view === 'ro' && ro.currentRO && (
        <ROView
          ro={ro.currentRO}
          isProcessingOCR={ocr.isProcessingOCR}
          ocrProgress={ocr.ocrProgress}
          onDone={() => ro.setView('home')}
          onUpdateRONumber={ro.updateRONumber}
          onUpdateVehicle={(field, value) => ro.updateVehicle({ [field]: value })}
          onUpdateCustomer={ro.updateCustomer}
          onAddComplaint={ro.addComplaint}
          onEditComplaint={ro.editComplaint}
          onRemoveComplaint={ro.removeComplaint}
          onDecodeVin={ro.decodeVinForRO}
          onAddROXentryPhotos={ro.addROXentryPhotos}
          onAddRepairLine={ro.addRepairLine}
          onOpenLine={ro.navigateToLine}
          onDeleteRO={() => ro.deleteRO(ro.currentRO!.id)}
        />
      )}

      {ro.view === 'line' && ro.currentRO && ro.currentLine && (
        <LineView
          ro={ro.currentRO}
          line={ro.currentLine}
          isProcessingOCR={ocr.isProcessingOCR}
          ocrProgress={ocr.ocrProgress}
          isGenerating={ro.isGenerating}
          onBack={() => ro.setView('ro')}
          onUpdateLine={(updates) => ro.updateLine(ro.currentLine!.id, updates)}
          onAddXentryPhotos={() => ro.addXentryPhotos(ro.currentLine!.id)}
          onApplySmartDefaults={() => ro.applySmartDefaultsToLine(ro.currentLine!.id)}
          onGenerateStory={() => ro.generateStory(ro.currentLine!.id)}
        />
      )}

      {ro.view === 'settings' && (
        <SettingsView
          session={session}
          onBack={() => ro.setView(ro.currentRO ? 'ro' : 'home')}
          onLogout={logout}
          onOpenAuditLogs={isManager ? () => ro.setView('audit') : undefined}
          onOpenServiceAdvisors={isManager ? () => ro.setView('advisors') : undefined}
        />
      )}

      {ro.view === 'audit' && (
        <AuditLogView session={session} onBack={() => ro.setView(isManager ? 'home' : 'settings')} />
      )}

      {ro.view === 'advisors' && isManager && (
        <ServiceAdvisorsView onBack={() => ro.setView('home')} />
      )}
    </div>
  );
}