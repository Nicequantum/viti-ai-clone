'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Something went wrong' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Merlin error boundary:', error, info);
    toast.error('An unexpected error occurred. You can try again.');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-container benz-page py-10 text-center">
          <div className="benz-card-elevated p-7">
            <div className="text-lg font-semibold mb-2 tracking-tight">Merlin hit a snag</div>
            <p className="text-sm text-benz-secondary mb-2 leading-relaxed">
              Something unexpected happened on this screen. Your typed notes are still on the repair order.
            </p>
            <p className="text-xs text-benz-muted mb-5">{this.state.message}</p>
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="primary-btn px-6 h-11 text-sm touch-target"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}