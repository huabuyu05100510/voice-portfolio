/**
 * Module B - WebSocketClient trace 改造单元测试 (Vitest)
 *
 * 验证:
 * - connect() 时 socket.io auth 注入 traceparent (W3C trace context)
 * - sendAudio 创建 span 含 chunk.bytes attribute
 *
 * 不依赖真实 Jaeger/OTel 导出器, 仅验证 trace 上下文传递逻辑正确.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock socket.io-client
const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
  auth: undefined as any,
};

vi.mock('socket.io-client', () => ({
  io: (_url: string, opts: any) => {
    // 捕获 auth 以便断言 traceparent 已注入
    mockSocket.auth = opts?.auth;
    return mockSocket;
  },
}));

import { trace, context, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  WebTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
} from '@opentelemetry/sdk-trace-web';

let testExporter: InMemorySpanExporter;
let testProvider: WebTracerProvider;

beforeEach(async () => {
  mockSocket.connected = false;
  mockSocket.on.mockReset();
  mockSocket.emit.mockReset();
  mockSocket.disconnect.mockReset();
  mockSocket.auth = undefined;
  mockSocket.on.mockImplementation(() => mockSocket);

  // 关键: 重置全局 OTel state (上一个测试可能已注册 provider)
  trace.disable();

  // 每个测试装一个 InMemorySpanExporter + SimpleSpanProcessor 抓 spans
  testExporter = new InMemorySpanExporter();
  testProvider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(testExporter)],
  });
  // 用 setGlobalTracerProvider 直接注册 (绕过 register() 的幂等检查)
  trace.setGlobalTracerProvider(testProvider);
  // StackContextManager 让 startActiveSpan / context.with 正确切换 active span
  context.setGlobalContextManager(new StackContextManager());
  // W3C TraceContext 默认 propagator (服务端依赖 traceparent header)
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

afterEach(async () => {
  await testProvider.shutdown();
  testExporter.reset();
  trace.disable();
});

describe('WebSocketClient trace', () => {
  it('connect() 时 socket.io auth 注入 traceparent (W3C trace context)', async () => {
    const tracer = trace.getTracer('voice-portfolio-test');
    // 顶部 import (避免 await import 跨越 microtask 丢失 StackContextManager 上下文)
    const { WebSocketClient } = await import('../WebSocketClient');
    const span = tracer.startSpan('test.root');
    const ctx = trace.setSpan(context.active(), span);
    const c = new WebSocketClient('http://localhost:5000');
    // context.with 同步包裹 connect, 让 propagation.inject 看到 active span
    context.with(ctx, () => {
      c.connect();
    });
    span.end();

    // 断言 auth 中携带 traceparent
    expect(mockSocket.auth).toBeDefined();
    expect(mockSocket.auth.traceparent).toBeDefined();
    expect(mockSocket.auth.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('sendAudio 创建 span 含 chunk.bytes attribute', async () => {
    const { WebSocketClient } = await import('../WebSocketClient');
    const c = new WebSocketClient('http://localhost:5000');
    c.connect();
    mockSocket.connected = true;

    const buf = new ArrayBuffer(2048);
    c.sendAudio(buf);

    const spans = testExporter.getFinishedSpans();
    const sendAudioSpan = spans.find((s) => s.name === 'ws.send_audio');
    expect(sendAudioSpan).toBeDefined();
    expect(sendAudioSpan?.attributes['chunk.bytes']).toBe(2048);
  });

  it('sendAudio 在 socket 未连接时仍创建 span (记录失败原因)', async () => {
    const { WebSocketClient } = await import('../WebSocketClient');
    const c = new WebSocketClient('http://localhost:5000');
    c.connect();
    // 不设置 mockSocket.connected = true

    c.sendAudio(new ArrayBuffer(128));

    const spans = testExporter.getFinishedSpans();
    const sendAudioSpan = spans.find((s) => s.name === 'ws.send_audio');
    expect(sendAudioSpan).toBeDefined();
    expect(sendAudioSpan?.attributes['chunk.bytes']).toBe(128);
    expect(sendAudioSpan?.attributes['ws.connected']).toBe(false);
  });
});
