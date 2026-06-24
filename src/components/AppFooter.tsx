'use client';

import { useEffect, useState } from 'react';

interface StatusPayload {
  version?: string;
  promptVersion?: string;
  buildCommit?: string;
  buildDate?: string;
}

function formatBuildDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function AppFooter() {
  const [status, setStatus] = useState<StatusPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as StatusPayload;
        if (!cancelled) setStatus(data);
      } catch {
        // footer is non-critical
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const version = status?.version ?? process.env.NEXT_PUBLIC_APP_VERSION ?? '3.0.1';
  const commit = status?.buildCommit ?? process.env.NEXT_PUBLIC_BUILD_COMMIT ?? 'dev';
  const built = status?.buildDate ? formatBuildDate(status.buildDate) : null;

  return (
    <footer className="benz-app-footer" aria-label="Application version">
      <span>Merlin v{version}</span>
      <span className="benz-app-footer-sep" aria-hidden>
        ·
      </span>
      <span title="Git commit">{commit.slice(0, 7)}</span>
      {built && (
        <>
          <span className="benz-app-footer-sep" aria-hidden>
            ·
          </span>
          <span>Built {built}</span>
        </>
      )}
      {status?.promptVersion && (
        <>
          <span className="benz-app-footer-sep" aria-hidden>
            ·
          </span>
          <span>Prompt {status.promptVersion}</span>
        </>
      )}
    </footer>
  );
}