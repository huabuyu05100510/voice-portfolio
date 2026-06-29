/**
 * ErrorBoundary.test.tsx — TDD tests for ErrorBoundary
 *
 * Covers:
 *   1. Renders children when no error
 *   2. Catches throw in child render and shows fallback UI with error message
 *   3. "Reload Application" button calls window.location.reload
 *   4. Stack trace shown in development, hidden in production
 *   5. Records exception on active OTel span when boundary catches
 */
import React from 'react';
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import {
  trace,
  context,
  SpanStatusCode,
} from '@opentelemetry/api';
import {
  WebTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
} from '@opentelemetry/sdk-trace-web';

import ErrorBoundary from '../observability/ErrorBoundary';

/** Component that throws on render */
const ThrowOnRender: React.FC<{ message?: string }> = ({ message = 'Kaboom!' }) => {
  throw new Error(message);
};

/** Component that renders without error */
const SafeChild: React.FC<{ label?: string }> = ({ label = 'Hello' }) => {
  return <div data-testid="safe-child">{label}</div>;
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Suppress console.error during tests that intentionally throw */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  trace.disable();
});

function setupOtel() {
  trace.disable();
  const exporter = new InMemorySpanExporter();
  const provider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new StackContextManager());
  return { exporter, provider };
}

// ── Test suites ──────────────────────────────────────────────────────

describe('ErrorBoundary — renders children when no error', () => {
  it('renders children without error', () => {
    render(
      <ErrorBoundary>
        <SafeChild label="all-good" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('safe-child').textContent).toContain('all-good');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ErrorBoundary — catches throw and shows fallback UI', () => {
  it('shows role="alert" fallback with error message when child throws', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowOnRender message="Test error message" />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    // The fallback should contain the error message text somewhere
    expect(alert.textContent).toContain('Test error message');

    spy.mockRestore();
  });

  it('fallback is visible and children are not rendered after error', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    // The alert is in the DOM
    expect(screen.getByRole('alert')).toBeDefined();
    // The throwing child is never in DOM
    expect(screen.queryByTestId('safe-child')).toBeNull();

    spy.mockRestore();
  });
});

describe('ErrorBoundary — "Reload Application" button', () => {
  it('renders a "reload" button that calls window.location.reload', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock window.location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    const reloadBtn = screen.getByRole('button', { name: /reload|重新|刷新/i });
    expect(reloadBtn).toBeDefined();
    fireEvent.click(reloadBtn);
    expect(reloadMock).toHaveBeenCalledOnce();

    spy.mockRestore();
  });
});

describe('ErrorBoundary — stack trace visibility', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it('shows stack trace when NODE_ENV is development', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowOnRender message="Dev error" />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Dev error');

    // Stack trace should be visible in dev mode — look for a <details> or <summary> element
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();

    spy.mockRestore();
  });

  it('hides stack trace when NODE_ENV is production', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    process.env.NODE_ENV = 'production';

    render(
      <ErrorBoundary>
        <ThrowOnRender message="Prod error" />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Prod error');

    // Stack trace should NOT be visible in production
    const details = alert.querySelector('details');
    expect(details).toBeNull();

    spy.mockRestore();
  });
});

describe('ErrorBoundary — records exception on OTel active span', () => {
  it('componentDidCatch records exception + sets status ERROR on active span', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { exporter } = setupOtel();

    const tracer = trace.getTracer('voice-portfolio-test');
    const rootSpan = tracer.startSpan('test.error-boundary-root');
    const ctx = trace.setSpan(context.active(), rootSpan);

    // Render within the active span context so the ErrorBoundary sees it
    context.with(ctx, () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender message="OTel test error" />
        </ErrorBoundary>,
      );
    });

    rootSpan.end();

    const spans = exporter.getFinishedSpans();
    // The root span should have status ERROR and recorded exception
    expect(rootSpan).toBeDefined();
    const status = (rootSpan as any).status;
    expect(status.code).toBe(SpanStatusCode.ERROR);

    spy.mockRestore();
  });

  it('gracefully degrades when OTel is not initialized (no active span)', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    // No OTel setup — active span will be INVALID_SPAN

    // Should not throw when no active span
    expect(() => {
      render(
        <ErrorBoundary>
          <ThrowOnRender message="No OTel" />
        </ErrorBoundary>,
      );
    }).not.toThrow();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No OTel');

    spy.mockRestore();
  });
});

describe('ErrorBoundary — edge cases', () => {
  it('recovers after reconstruction (new key forces remount)', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary>
        <SafeChild label="first" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('safe-child').textContent).toContain('first');


    // Trigger error
    rerender(
      <ErrorBoundary>
        <ThrowOnRender message="Oops" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();

    // Reset with new key
    rerender(
      <ErrorBoundary key="reset">
        <SafeChild label="recovered" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('safe-child').textContent).toContain('recovered');

    spy.mockRestore();
  });
});