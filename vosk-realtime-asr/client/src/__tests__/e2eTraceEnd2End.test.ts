/**
 * Module B — E2E: 跨进程 trace 上下文传递 (组件级, 不依赖真实 Jaeger)
 *
 * 验证 trace 上下文在客户端 WebSocketClient → 模拟服务端接收 auth.traceparent → 服务端 logger 的完整链路
 * 不启动真实后端, 而是用 mock socket.io + 直接构造 auth payload 模拟服务端提取.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  auth: undefined as any,
};

vi.mock('socket.io-client', () => ({
  io: (_url: string, opts: any) => {
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

beforeEach(() => {
  mockSocket.connected = false;
  mockSocket.on.mockReset();
  mockSocket.emit.mockReset();
  mockSocket.disconnect.mockReset();
  mockSocket.auth = undefined;
  mockSocket.on.mockImplementation(() => mockSocket);

  trace.disable();
  testExporter = new InMemorySpanExporter();
  testProvider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(testExporter)],
  });
  trace.setGlobalTracerProvider(testProvider);
  context.setGlobalContextManager(new StackContextManager());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

afterEach(async () => {
  await testProvider.shutdown();
  testExporter.reset();
  trace.disable();
});

describe('E2E: 跨进程 trace 上下文传递', () => {
  it('客户端发送 ws.connect 时 auth.traceparent 与当前 active span 共享 trace_id', async () => {
    const { WebSocketClient } = await import('../WebSocketClient');
    const tracer = trace.getTracer('voice-portfolio-e2e');

    // 1. 用户点击开始录音 (root span)
    const rootSpan = tracer.startSpan('user.click');
    const ctx = trace.setSpan(context.active(), rootSpan);

    const c = new WebSocketClient('http://mock-server');
    context.with(ctx, () => {
      // 2. 建立 WebSocket 连接 (auth 应携带 traceparent)
      c.connect();
      mockSocket.connected = true;

      // 3. 模拟开始录音 + 发送多个音频 chunk
      c.sendAudio(new ArrayBuffer(512));
      c.sendAudio(new ArrayBuffer(1024));
      c.sendAudio(new ArrayBuffer(2048));
    });
    rootSpan.end();

    // === 断言: 客户端 trace 数据完整 ===
    // 1. auth.traceparent 已注入且格式合法
    expect(mockSocket.auth).toBeDefined();
    expect(mockSocket.auth.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    // 2. trace_id 一致性: auth.traceparent 中的 trace_id 必须 == rootSpan.spanContext().traceId
    const authTraceId = mockSocket.auth.traceparent.split('-')[1];
    expect(authTraceId).toBe(rootSpan.spanContext().traceId);

    // 3. 3 个 ws.send_audio span 全部存在且属性正确
    const finishedSpans = testExporter.getFinishedSpans();
    const sendAudioSpans = finishedSpans.filter((s) => s.name === 'ws.send_audio');
    expect(sendAudioSpans).toHaveLength(3);
    expect(sendAudioSpans[0]?.attributes['chunk.bytes']).toBe(512);
    expect(sendAudioSpans[1]?.attributes['chunk.bytes']).toBe(1024);
    expect(sendAudioSpans[2]?.attributes['chunk.bytes']).toBe(2048);

    // 4. 所有 sendAudio span 与 rootSpan 共享 trace_id
    for (const sp of sendAudioSpans) {
      expect(sp.spanContext().traceId).toBe(rootSpan.spanContext().traceId);
    }
  });

  it('服务端模拟: 从 auth.traceparent 解析 trace_id', async () => {
    /**
     * 模拟 server 端 handle_connect 的核心逻辑:
     *   traceparent = auth['traceparent']
     *   trace_id = parse_traceparent(traceparent)
     *
     * 这里直接用 OTel 客户端 W3CTraceContextPropagator 反向解析, 验证 round-trip 一致.
     */
    const { WebSocketClient } = await import('../WebSocketClient');

    const tracer = trace.getTracer('voice-portfolio-e2e');
    const span = tracer.startSpan('user.click');
    const ctx = trace.setSpan(context.active(), span);

    const c = new WebSocketClient('http://mock-server');
    context.with(ctx, () => {
      c.connect();
    });
    span.end();

    // === 服务端侧: 反向解析 traceparent ===
    expect(mockSocket.auth.traceparent).toBeDefined();
    const serverCarrier = { traceparent: mockSocket.auth.traceparent };
    const serverCtx = propagation.extract(context.active(), serverCarrier);

    // 用一个空 span 测试, 它的 trace_id 应来自 serverCtx 的 baggage
    // 这里通过 inject 来 round-trip 验证:
    const serverOut: Record<string, string> = {};
    propagation.inject(serverCtx, serverOut);

    expect(serverOut.traceparent).toBeDefined();
    // 服务端后续的 span 应与客户端 root span 共享 trace_id
    const serverTraceId = serverOut.traceparent.split('-')[1];
    expect(serverTraceId).toBe(span.spanContext().traceId);
  });
});
