/**
 * WebSocketClient 单元测试 (Vitest)
 * 覆盖 socket 状态机 + 事件回调, 使用 mock socket 避免真实连接
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock socket.io-client
const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: () => mockSocket,
}));

import { WebSocketClient } from '../WebSocketClient';

beforeEach(() => {
  mockSocket.connected = false;
  mockSocket.on.mockReset();
  mockSocket.emit.mockReset();
  mockSocket.disconnect.mockReset();
  // 默认注册所有事件 handler
  mockSocket.on.mockImplementation(() => mockSocket);
});

describe('WebSocketClient', () => {
  it('默认状态为 disconnected', () => {
    const c = new WebSocketClient('http://localhost:5000');
    expect(c.getState()).toBe('disconnected');
  });

  it('connect 触发后切换为 connecting, 收到 connect 事件后变为 connected', () => {
    const c = new WebSocketClient('http://localhost:5000');
    c.connect();
    expect(c.getState()).toBe('connecting');

    // 找到 connect 事件 handler 并模拟调用
    const connectCall = mockSocket.on.mock.calls.find(([ev]) => ev === 'connect');
    expect(connectCall).toBeTruthy();
    connectCall![1]();
    expect(c.getState()).toBe('connected');
  });

  it('onTranscriptionResult 收到回调时被调用', () => {
    const c = new WebSocketClient('http://localhost:5000');
    const cb = vi.fn();
    c.onTranscriptionResult(cb);
    c.connect();

    const call = mockSocket.on.mock.calls.find(([ev]) => ev === 'transcription_result');
    expect(call).toBeTruthy();
    call![1]({
      text: '你好',
      is_final: true,
      full_text: '你好',
      latency_ms: 123,
      timestamp: '2026-06-20T00:00:00Z',
    });
    expect(cb).toHaveBeenCalledWith({
      text: '你好',
      isFinal: true,
      fullText: '你好',
      latency: 123,
      timestamp: '2026-06-20T00:00:00Z',
      words: [],
    });
  });

  it('onError 收到 error 事件时触发回调', () => {
    const c = new WebSocketClient('http://localhost:5000');
    const cb = vi.fn();
    c.onError(cb);
    c.connect();

    const call = mockSocket.on.mock.calls.find(([ev]) => ev === 'error');
    call![1]({ message: 'boom' });
    expect(cb).toHaveBeenCalledWith('boom');
  });

  it('sendAudio 在 connected 时才发送', () => {
    const c = new WebSocketClient('http://localhost:5000');
    c.connect();
    mockSocket.connected = false;
    c.sendAudio(new ArrayBuffer(8));
    expect(mockSocket.emit).not.toHaveBeenCalled();
    mockSocket.connected = true;
    c.sendAudio(new ArrayBuffer(8));
    expect(mockSocket.emit).toHaveBeenCalledWith('audio_data', expect.any(ArrayBuffer));
  });

  it('startRecording / stopRecording 转发为事件', () => {
    const c = new WebSocketClient('http://localhost:5000');
    c.connect();
    mockSocket.connected = true;
    c.startRecording();
    c.stopRecording();
    expect(mockSocket.emit).toHaveBeenCalledWith('start_recording');
    expect(mockSocket.emit).toHaveBeenCalledWith('stop_recording');
  });

  it('disconnect 调用 socket.disconnect 并清空 socket', () => {
    const c = new WebSocketClient('http://localhost:5000');
    c.connect();
    c.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(c.getState()).toBe('disconnecting');
  });
});
