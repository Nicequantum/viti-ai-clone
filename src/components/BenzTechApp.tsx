'use client';

import { AppFooter } from '@/components/AppFooter';
import { AppHeader } from '@/components/AppHeader';
import { MaintenanceBanner } from '@/components/MaintenanceBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ConsentModal } from '@/components/ConsentModal';
import { HomeView } from '@/components/HomeView';
import { LineView } from '@/components/LineView';
import { LoginView } from '@/components/LoginView';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { LoadErrorScreen } from '@/components/LoadErrorScreen';
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
    session,
    onOcrStart: ocr.startOcr,
    onOcrFinish: ocr.finishOcr,
    setOcrProgress: ocr.setOcrProgress,
    setScanStatusMessage: ocr.setScanStatusMessage,
  });
  const [consentLoading, setConsentLoading] = useState(false);

  if (sessionLoading) {
    return <LoadingScreen label="Starting Merlin" sublabel="Verifying your session..." />;
  }

  if (!session) {
    return <LoginView onLogin={login} />;
  }

  if (ro.loading && !ro.listError) {
    return <LoadingScreen label="Loading repair orders" sublabel="Syncing dealership data..." />;
  }

  if (ro.listError) {
    return (
      <LoadErrorScreen
        title="Could not load repair orders"
        message={ro.listError}
        onRetry={() => void ro.retryListLoad()}
        retrying={ro.listRetrying}
      />
    );
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
        <div className="benz-section-title mb-2.5 px-1">Previous Repair Orders</div>
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

  const wideLayout = ro.view === 'home' && isManager;

  return (
    <div className={`app-container${wideLayout ? ' benz-app-wide' : ''}`}>
      <OfflineBanner />
      <MaintenanceBanner />
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
          onDeleteROXentryImage={(imageId) => void ro.deleteROXentryImage(imageId)}
          onAddRepairLine={ro.addRepairLine}
          onOpenLine={ro.navigateToLine}
          onDeleteRO={() => ro.deleteRO(ro.currentRO!.id)}
        />
      )}

      {ro.view === 'line' && ro.currentRO && ro.currentLine && (
        <LineView
          ro={ro.currentRO}
          line={ro.currentLine}
          technicianName={session.name}
          isProcessingOCR={ocr.isProcessingOCR}
          ocrProgress={ocr.ocrProgress}
          isGenerating={ro.isGeneratingForLine}
          isReviewing={ro.isReviewingForLine}
          storyQuality={ro.storyQualityForLine}
          storyReview={ro.storyReviewForLine}
          storyQualityStale={ro.storyQualityStaleForLine}
          lastGeneratedStoryText={ro.lastGeneratedStoryForLine}
          onBack={() => ro.setView('ro')}
          onUpdateLine={(updates) => ro.updateLine(ro.currentLine!.id, updates)}
          onAddXentryPhotos={() => ro.addXentryPhotos(ro.currentLine!.id)}
          onDeleteXentryImage={(imageId) => void ro.deleteLineXentryImage(ro.currentLine!.id, imageId)}
          onApplySmartDefaults={() => ro.applySmartDefaultsToLine(ro.currentLine!.id)}
          onGenerateStory={() => ro.generateStory(ro.currentLine!.id)}
          onReviewStory={() => ro.reviewStory(ro.currentLine!.id)}
          onApplyCustomerPayTemplate={(templateId) =>
            ro.applyCustomerPayTemplate(ro.currentLine!.id, templateId)
          }
          onClearCustomerPayMode={() => ro.clearCustomerPayMode(ro.currentLine!.id)}
          onAcknowledgeStoryBaseline={(text) => ro.acknowledgeStoryBaseline(ro.currentLine!.id, text)}
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

      <AppFooter />
    </div>
  );
}