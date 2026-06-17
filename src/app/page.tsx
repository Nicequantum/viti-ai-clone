import { BenzTechApp } from '@/components/BenzTechApp';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function HomePage() {
  return (
    <ErrorBoundary>
      <BenzTechApp />
    </ErrorBoundary>
  );
}