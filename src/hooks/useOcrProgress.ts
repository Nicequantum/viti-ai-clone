import { useCallback, useState } from 'react';

export function useOcrProgress() {
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [scanStatusMessage, setScanStatusMessage] = useState('');

  const startOcr = useCallback((message = 'Preparing scan…') => {
    setIsProcessingOCR(true);
    setOcrProgress(0);
    setScanStatusMessage(message);
  }, []);

  const finishOcr = useCallback(() => {
    setIsProcessingOCR(false);
    setOcrProgress(0);
    setScanStatusMessage('');
  }, []);

  return {
    isProcessingOCR,
    ocrProgress,
    scanStatusMessage,
    setOcrProgress,
    setScanStatusMessage,
    startOcr,
    finishOcr,
  };
}