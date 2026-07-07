'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary:${this.props.fallbackLabel || 'unknown'}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-[#0a0e14] text-gray-400">
          <div className="text-center p-6">
            <div className="text-2xl mb-2 text-red-400">⚠</div>
            <p className="text-sm font-mono mb-1">{this.props.fallbackLabel || 'Component'} crashed</p>
            <p className="text-xs text-gray-600 mb-3 max-w-xs">{this.state.error}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset?.();
              }}
              className="text-xs text-[#40E0D0] hover:text-white px-3 py-1 rounded border border-[#40E0D0]/30 hover:bg-[#40E0D0]/10"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
