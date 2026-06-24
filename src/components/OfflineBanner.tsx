'use client';

import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="benz-offline-banner" role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden />
      <span>No network — typed notes are safe. Reconnect to generate stories or sync scans.</span>
    </div>
  );
}