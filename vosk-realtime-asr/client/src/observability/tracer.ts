/**
 * Tracer 工具 — 封装常用 span 操作 (Module B)
 *
 * - getTracer(): 拿 voice-portfolio-client tracer
 * - withSpan(name, fn): 起 span, fn 返回 Promise, 自动 end + 异常捕获
 */
import { trace, Span, SpanStatusCode } from '@opentelemetry/api';

const TRACER_NAME = 'voice-portfolio-client';
const TRACER_VERSION = '1.0.0';

export function getTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

/**
 * 在新 span 内执行 fn. span 自动 end. fn 抛异常会标 span 错误状态.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer();
  return await tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) {
          span.setAttribute(k, v);
        }
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err?.message ?? err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
