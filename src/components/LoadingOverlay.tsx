'use client';

interface LoadingOverlayProps {
  visible: boolean;
  message: string;
}

export function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-6">
      <div className="ios-card p-6 w-full max-w-sm text-center">
        <div className="loading-spinner mx-auto mb-4" aria-hidden="true" />
        <div className="text-sm font-medium">{message}</div>
      </div>
    </div>
  );
}