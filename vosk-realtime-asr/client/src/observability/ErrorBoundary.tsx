/**
 * ErrorBoundary — React class-based error boundary (Task 13.1)
 *
 * Catches unhandled render errors in the React tree:
 * - Displays a fallback UI with error details
 * - Records exception on the active OTel span (via @opentelemetry/api)
 * - Shows collapsible stack trace in development only
 * - Provides "Reload Application" recovery action
 * - Styled with design tokens (CSS variables from design/tokens.ts)
 *
 * Graceful degradation: if OTel is not initialized, only console.error is logged.
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import { trace, SpanStatusCode } from '@opentelemetry/api';

/* ============================================================================
 * Types
 * ========================================================================== */

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional custom fallback renderer */
  fallback?: (error: Error) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/* ============================================================================
 * Styles
 * ========================================================================== */

/** Inline styles scoped to the fallback UI, using CSS variables from design tokens */
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: 'var(--space-8, 32px)',
    backgroundColor: 'var(--bg-0, #0a0a14)',
    color: 'var(--text-2, #c5c5d0)',
    fontFamily:
      "'Inter', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  },
  banner: {
    maxWidth: '560px',
    width: '100%',
    padding: 'var(--space-8, 32px)',
    backgroundColor: 'var(--bg-1, #13131f)',
    border: '1px solid var(--danger-500, #ef4444)',
    borderRadius: 'var(--radius-lg, 14px)',
    boxShadow: 'var(--shadow-3, 0 10px 20px rgba(0,0,0,0.22))',
    textAlign: 'center' as const,
  },
  icon: {
    fontSize: '48px',
    lineHeight: '1',
    marginBottom: 'var(--space-4, 16px)',
    userSelect: 'none' as const,
  },
  title: {
    fontSize: 'var(--heading-lg, 22px)',
    fontWeight: 600,
    color: 'var(--text-1, #f5f5f7)',
    marginBottom: 'var(--space-3, 12px)',
  },
  message: {
    fontSize: 'var(--body-lg, 16px)',
    color: 'var(--danger-500, #ef4444)',
    fontWeight: 500,
    marginBottom: 'var(--space-4, 16px)',
    wordBreak: 'break-word' as const,
  },
  details: {
    marginTop: 'var(--space-4, 16px)',
    width: '100%',
    textAlign: 'left' as const,
  },
  summary: {
    cursor: 'pointer',
    fontSize: 'var(--body-sm, 13px)',
    color: 'var(--text-3, #8b8b99)',
    padding: 'var(--space-2, 8px)',
    borderRadius: 'var(--radius-sm, 6px)',
    transition: 'background-color var(--duration-fast, 120ms)',
    userSelect: 'none' as const,
  },
  stackTrace: {
    marginTop: 'var(--space-2, 8px)',
    padding: 'var(--space-3, 12px) var(--space-4, 16px)',
    backgroundColor: 'var(--bg-3, #050510)',
    borderRadius: 'var(--radius-md, 10px)',
    fontFamily:
      "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace",
    fontSize: 'var(--caption, 12px)',
    color: 'var(--text-3, #8b8b99)',
    lineHeight: '1.6',
    overflowX: 'auto',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    maxHeight: '320px',
    overflowY: 'auto' as const,
  },
  actions: {
    marginTop: 'var(--space-6, 24px)',
    display: 'flex',
    gap: 'var(--space-3, 12px)',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
  },
  reloadButton: {
    padding: 'var(--space-3, 12px) var(--space-6, 24px)',
    fontSize: 'var(--body, 14px)',
    fontWeight: 600,
    color: 'var(--text-on-brand, #0a0a14)',
    backgroundColor: 'var(--brand-500, #00d4ff)',
    border: 'none',
    borderRadius: 'var(--radius-md, 10px)',
    cursor: 'pointer',
    transition: 'background-color var(--duration-fast, 120ms)',
    outline: 'none',
  },
  hint: {
    marginTop: 'var(--space-4, 16px)',
    fontSize: 'var(--body-sm, 13px)',
    color: 'var(--text-4, #5a5a68)',
  },
};

/* ============================================================================
 * Helpers
 * ========================================================================== */

function isDev(): boolean {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    return true;
  }
  return false;
}

/**
 * Attempt to record the error on the active OTel span.
 * Gracefully degrades if OTel SDK is not initialized.
 */
function recordOnActiveSpan(error: Error): void {
  try {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan || !activeSpan.isRecording?.()) {
      return; // No active span or span already ended — nothing to record on
    }
    activeSpan.recordException(error);
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  } catch (otelErr) {
    // OTel SDK threw (e.g., not initialized) — fall through to console
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Failed to record exception on OTel span:', otelErr);
  }
}

/* ============================================================================
 * Component
 * ========================================================================== */

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: React.ErrorInfo): void {
    // 1. Always log to console for debugging
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught render error:', error);

    // 2. Record on active OTel span (graceful degradation)
    recordOnActiveSpan(error);
  }

  private handleReload = (): void => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  /* ------------------------------------------------------------------------
   * Render helpers
   * ---------------------------------------------------------------------- */

  private renderFallback(): React.ReactNode {
    const { error } = this.state;
    if (!error) return null;

    // If a custom fallback is provided, use it
    if (this.props.fallback) {
      return this.props.fallback(error);
    }

    const dev = isDev();
    const stack = error.stack ?? null;

    return (
      <div style={styles.container}>
        <div role="alert" style={styles.banner}>
          <div style={styles.icon} aria-hidden="true">
            X
          </div>
          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.message}>{error.message || 'An unexpected error occurred'}</p>

          {dev && stack && (
            <details style={styles.details}>
              <summary style={styles.summary}>
                Stack trace (development only)
              </summary>
              <pre style={styles.stackTrace}>{stack}</pre>
            </details>
          )}

          <div style={styles.actions}>
            <button
              type="button"
              onClick={this.handleReload}
              style={styles.reloadButton}
              aria-label="Reload Application"
            >
              Reload Application
            </button>
          </div>
        </div>

        <p style={styles.hint}>
          If the problem persists, please check the browser console for details.
        </p>
      </div>
    );
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.renderFallback();
    }
    return this.props.children;
  }
}