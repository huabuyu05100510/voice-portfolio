/**
 * 全局 error 捕获 (Module B)
 *
 * - window.error + unhandledrejection → 标记当前 active span 为 ERROR
 * - 记录 exception + status
 */
import { trace, SpanStatusCode } from '@opentelemetry/api';

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](
    JSON.stringify({ level, msg, module: 'errors', ...meta }),
  );
}

export function setupGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  // 防止重复注册
  if ((window as any).__otel_errors_setup__) return;
  (window as any).__otel_errors_setup__ = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    const span = trace.getActiveSpan();
    const err = e.error ?? e.message ?? 'unknown error';
    if (span) {
      try {
        span.recordException(err as Error);
      } catch {
        // recordException 需要 Error 实例, fallback 标记 message
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String((err as any)?.message ?? err) });
    }
    log('error', 'unhandled window.error', {
      message: (err as any)?.message ?? String(err),
      filename: e.filename,
      lineno: e.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const span = trace.getActiveSpan();
    const reason = e.reason;
    if (span) {
      try {
        span.recordException(reason instanceof Error ? reason : new Error(String(reason)));
      } catch {
        // ignore
      }
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String((reason as any)?.message ?? reason),
      });
    }
    log('error', 'unhandled promise rejection', {
      reason: String(reason),
    });
  });
}
