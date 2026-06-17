'use client';

import { AppHeader } from '@/components/AppHeader';
import { ConsentModal } from '@/components/ConsentModal';
import { HomeView } from '@/components/HomeView';
import { LineView } from '@/components/LineView';
import { LoginView } from '@/components/LoginView';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ManagerDashboard } from '@/components/ManagerDashboard';
import { RepairOrderList } from '@/components/RepairOrderList';
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

  const roListSection = (
    <>
      {ro.filteredROs.length > 0 && (
        <div className="text-xs uppercase tracking-widest text-[#8e8e93] mb-2 px-1">Previous Repair Orders</div>
      )}
      <RepairOrderList
        repairOrders={ro.filteredROs}
        openingROId={ro.openingROId}
        onOpenRO={ro.openRO}
        onDeleteRO={ro.deleteRO}
        emptyMessage="No repair orders match your search."
        emptyHint="Scan a repair order to get started."
      />
    </>
  );

  const openingRoNumber =
    ro.openingROId &&
    (ro.allROs.find((item) => item.id === ro.openingROId)?.roNumber || 'repair order');

  return (
    <div className="app-container">
      <LoadingOverlay
        visible={!!ro.openingROId}
        message={openingRoNumber ? `Loading ${openingRoNumber}…` : 'Loading repair order…'}
      />

      {ro.view !== 'home' && ro.view !== 'settings' && ro.view !== 'audit' && ro.view !== 'advisors' && (
        <AppHeader technicianName={session.name} onOpenSettings={goToSettings} />
      )}

      {ro.view === 'home' && isManager && (
        <ManagerDashboard
          session={session}
          searchTerm={ro.searchTerm}
          onSearchChange={ro.setSearchTerm}
          openingROId={ro.openingROId}
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
          openingROId={ro.openingROId}
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