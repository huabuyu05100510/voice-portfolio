/**
 * TDD: useRealtimeConversation hook
 *
 * 注: 本测试不模拟真实麦克风/WebSocketMediaStream, 通过 autoConnect=false
 * + 手动 sendAudio/dispatch 的方式验证 hook 的可测试切面.
 *
 * Model: MiniMax-M3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRealtimeConversation } from '../hooks/useRealtimeConversation';

// Polyfill AudioContext for jsdom
class MockAudioBuffer {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  _data: Float32Array;
  constructor(_opts: { length: number; sampleRate: number; numberOfChannels: number }) {
    this.length = _opts.length;
    this.sampleRate = _opts.sampleRate;
    this.numberOfChannels = _opts.numberOfChannels;
    this._data = new Float32Array(this.length);
  }
  getChannelData(_ch: number) {
    return this._data;
  }
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connected = false;
  started = false;
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  start() { this.started = true; }
  stop() { this.started = false; }
}

class MockAudioContext {
  state = 'running';
  destination = {};
  currentTime = 0;
  createBuffer(_ch: number, length: number, sampleRate: number) {
    return new MockAudioBuffer({ length, sampleRate, numberOfChannels: _ch });
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode();
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createScriptProcessor() {
    return {
      connect: () => {},
      disconnect: () => {},
      onaudioprocess: null as any,
    };
  }
  async close() { this.state = 'closed'; }
}

// Polyfill WebSocket minimal
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(url: string) { this.url = url; }
  send(data: string) { this.sent.push(data); }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  // helpers for tests
  _open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  _receive(obj: any) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  _fail() {
    this.onerror?.();
    this.onclose?.();
  }
}

let mockWss: MockWebSocket[] = [];

beforeEach(() => {
  mockWss = [];
  (globalThis as any).AudioContext = MockAudioContext;
  (globalThis as any).WebSocket = function (url: string) {
    const ws = new MockWebSocket(url);
    mockWss.push(ws);
    return ws as any;
  } as any;
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).performance = { now: () => Date.now() };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// autoConnect=false 路径: 直接 dispatch 验证状态
// ----------------------------------------------------------------------------
describe('useRealtimeConversation / dispatch path', () => {
  it('初始 state 是 idle', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost/api/realtime', autoConnect: false }),
    );
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.messages).toEqual([]);
  });

  it('dispatch USER_MESSAGE → state.messages 收到 user 消息', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost/api/realtime', autoConnect: false }),
    );
    act(() => {
      result.current.dispatch({
        type: 'USER_MESSAGE',
        text: '你好',
        timestamp: 100,
      });
    });
    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0].text).toBe('你好');
  });

  it('dispatch AI_TEXT_DELTA → streamingText 累加', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost/api/realtime', autoConnect: false }),
    );
    act(() => {
      result.current.dispatch({ type: 'AI_TEXT_DELTA', text: '你', responseId: 'r1' });
      result.current.dispatch({ type: 'AI_TEXT_DELTA', text: '好', responseId: 'r1' });
    });
    expect(result.current.state.streamingText).toBe('你好');
  });

  it('dispatch BARGE_IN → commit streaming + 计数', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost/api/realtime', autoConnect: false }),
    );
    act(() => {
      result.current.dispatch({ type: 'AI_TEXT_DELTA', text: '回答中', responseId: 'r1' });
      result.current.dispatch({ type: 'BARGE_IN', timestamp: 100 });
    });
    const msg = result.current.state.messages.find((m) => m.id === 'r1');
    expect(msg?.interrupted).toBe(true);
    expect(result.current.state.metrics.bargeIn.count).toBe(1);
  });

  it('clear() → state 重置', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost/api/realtime', autoConnect: false }),
    );
    act(() => {
      result.current.dispatch({ type: 'USER_MESSAGE', text: 'x', timestamp: 1 });
    });
    act(() => result.current.clear());
    expect(result.current.state.messages).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// connect / WebSocket 路径
// ----------------------------------------------------------------------------
describe('useRealtimeConversation / WebSocket path', () => {
  it('connect() 创建 WebSocket, 状态 → connecting → listening (onopen)', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    expect(mockWss).toHaveLength(1);
    expect(result.current.state.status).toBe('connecting');
    act(() => mockWss[0]._open());
    expect(result.current.state.status).toBe('listening');
  });

  it('connect() 成功后发送 session.update', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    const sessionUpdate = mockWss[0].sent.find((s) => s.includes('session.update'));
    expect(sessionUpdate).toBeDefined();
    const parsed = JSON.parse(sessionUpdate!);
    expect(parsed.type).toBe('session.update');
    expect(parsed.session.turn_detection.type).toBe('server_vad');
  });

  it('sendAudio 通过 ws 发送 input_audio_buffer.append', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    const pcm = new Int16Array([1, 2, 3, 4]);
    act(() => result.current.sendAudio(pcm));
    const append = mockWss[0].sent.find((s) => s.includes('input_audio_buffer.append'));
    expect(append).toBeDefined();
    const parsed = JSON.parse(append!);
    expect(typeof parsed.audio_bytes_b64).toBe('string');
    expect(parsed.audio_bytes_b64.length).toBeGreaterThan(0);
  });

  it('收到 speech_started → 触发 BARGE_IN (state.bargeIn.count++)', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    act(() => {
      result.current.dispatch({ type: 'AI_TEXT_DELTA', text: '说', responseId: 'r1' });
    });
    act(() => mockWss[0]._receive({ type: 'input_audio_buffer.speech_started', audio_start_ms: 100 }));
    expect(result.current.state.metrics.bargeIn.count).toBe(1);
  });

  it('收到 input_audio_transcription.completed → USER_MESSAGE', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    act(() => mockWss[0]._receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '今天天气',
      item_id: 'item1',
    }));
    expect(result.current.state.messages.some((m) => m.text === '今天天气')).toBe(true);
  });

  it('收到 response.done → TURN_DONE + aiMessages++', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    act(() => mockWss[0]._receive({
      type: 'response.done',
      response: { id: 'r1', usage: { total_tokens: 50 } },
    }));
    expect(result.current.state.metrics.aiMessages).toBe(1);
    expect(result.current.state.metrics.latency.turns).toBe(1);
  });

  it('disconnect() 关闭 ws 并 dispatch DISCONNECT', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    act(() => result.current.disconnect());
    expect(result.current.state.status).toBe('idle');
    expect(mockWss[0].readyState).toBe(MockWebSocket.CLOSED);
  });
});

// ----------------------------------------------------------------------------
// Task 13.6: stale closure regression
// ----------------------------------------------------------------------------
describe('useRealtimeConversation / autoConnect effect', () => {
  it('autoConnect=true → connect is called exactly once on mount', () => {
    const { result, rerender } = renderHook(
      (opts) =>
        useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: true, autoCapture: false }),
      { initialProps: {} },
    );
    // Mount should trigger exactly one WebSocket creation
    expect(mockWss).toHaveLength(1);
    expect(mockWss[0].url).toContain('ws://localhost:5001/api/realtime');

    // Re-render should NOT create another WebSocket
    act(() => { rerender({}); });
    expect(mockWss).toHaveLength(1);
  });

  it('autoConnect=false → connect is NOT called on mount', () => {
    renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false }),
    );
    expect(mockWss).toHaveLength(0);
  });

  it('stale closure: changing url after mount does NOT trigger reconnect from the autoConnect effect', () => {
    // Simulate: mount with autoConnect=true and initial url
    const { rerender } = renderHook(
      ({ url }) =>
        useRealtimeConversation({ url, autoConnect: true, autoCapture: false }),
      { initialProps: { url: 'ws://localhost:5001/api/realtime' } },
    );

    // Mount created exactly 1 WebSocket
    expect(mockWss).toHaveLength(1);
    expect(mockWss[0].url).toContain('ws://localhost:5001/api/realtime');

    // Change url via re-render (this should NOT retrigger the autoConnect effect)
    // The effect is gated on [autoConnect], not [url], so it must not fire again
    act(() => {
      mockWss = []; // reset tracker to detect any new WS creation
    });
    act(() => {
      rerender({ url: 'ws://localhost:9999/other-url' });
    });

    // No new WebSocket should have been created by the autoConnect effect
    expect(mockWss).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// AI audio playback
// ----------------------------------------------------------------------------
describe('useRealtimeConversation / audio playback', () => {
  it('收到 audio.delta → 内部入队播放 (不抛)', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    // 先发 text delta, 让 reducer 创建 response_id='r1' 的消息
    act(() => mockWss[0]._receive({ type: 'response.audio_transcript.delta', delta: '你', response_id: 'r1' }));
    const pcmBytes = new Uint8Array(640); // 320 samples int16 → 640 bytes
    const b64 = btoa(String.fromCharCode.apply(null, Array.from(pcmBytes)));
    expect(() => {
      act(() => mockWss[0]._receive({ type: 'response.audio.delta', delta: b64, response_id: 'r1' }));
    }).not.toThrow();
    const msg = result.current.state.messages.find((m) => m.id === 'r1');
    expect(msg?.audioBytes).toBe(640);
  });

  it('stopPlayback 清空队列 (打断后 AI 不再发声)', () => {
    const { result } = renderHook(() =>
      useRealtimeConversation({ url: 'ws://localhost:5001/api/realtime', autoConnect: false, autoCapture: false }),
    );
    act(() => result.current.connect());
    act(() => mockWss[0]._open());
    act(() => result.current.stopPlayback());
    // 应该不抛
    expect(result.current.state.status).toBe('listening'); // status 不被 stopPlayback 影响
  });
});

// Polyfill btoa in jsdom if missing
if (typeof btoa === 'undefined') {
  (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}