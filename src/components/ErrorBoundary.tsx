'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback: ReactNode;
  /** Changing this key resets the boundary. */
  resetKey?: unknown;
  onError?: (error: unknown, info: ErrorInfo) => void;
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
  resetKey: unknown;
}

/** Contains failures from plugin views, renderers, and the lazily loaded globe so the rest stays usable. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: undefined, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error ?? new Error('Unknown render error') };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { error: undefined, resetKey: props.resetKey };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (this.state.error !== undefined) return this.props.fallback;
    return this.props.children;
  }
}
