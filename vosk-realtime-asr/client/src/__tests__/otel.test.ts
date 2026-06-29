/**
 * Module B - OTel init 单元测试 (Vitest)
 *
 * 验证:
 * - setObservabilityEnabled(true) + initObservability() 后 trace.getTracer 可用
 * - setObservabilityEnabled(false) + initObservability() 是 no-op
 * - 重复 initObservability() 不会重复初始化
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('observability/otel', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('setObservabilityEnabled(true) + initObservability() 后 trace.getTracer 可用', async () => {
    const mod = await import('../observability/otel');
    mod.setObservabilityEnabled(true);
    mod.initObservability();
    const { trace } = await import('@opentelemetry/api');
    const tracer = trace.getTracer('voice-portfolio-test');
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('setObservabilityEnabled(false) + initObservability() 是 no-op (provider 仍 null)', async () => {
    const mod = await import('../observability/otel');
    mod.setObservabilityEnabled(false);
    mod.initObservability();
    expect(mod.getObservabilityProvider()).toBeNull();
    expect(mod.isObservabilityEnabled()).toBe(false);
  });

  it('重复 initObservability() 不会重复初始化 (幂等)', async () => {
    const mod = await import('../observability/otel');
    mod.setObservabilityEnabled(true);
    mod.initObservability();
    const first = mod.getObservabilityProvider();
    mod.initObservability();
    const second = mod.getObservabilityProvider();
    expect(second).toBe(first);
  });
});
