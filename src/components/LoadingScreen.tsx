'use client';

interface LoadingScreenProps {
  label?: string;
  sublabel?: string;
}

export function LoadingScreen({ label = 'Loading Merlin', sublabel }: LoadingScreenProps) {
  return (
    <div className="app-container flex flex-col items-center justify-center min-h-dvh px-6 text-center">
      <div className="loading-spinner mb-6" aria-hidden="true" role="progressbar" aria-label={label} />
      <p className="text-sm text-benz-silver font-semibold tracking-tight animate-pulse">{label}</p>
      {sublabel && <p className="text-xs text-benz-secondary mt-2 max-w-xs leading-relaxed">{sublabel}</p>}
    </div>
  );
}