/**
 * useWebSocket
 * ------------
 * 封装 WebSocketClient + 顶层状态 (wsState / sessionId / error / status)。
 * 不暴露回调集合 (那是 ws client 自己的事), 只把"语义状态"传给消费者。
 *
 * Author: Claude Opus 4.8
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketClient, WebSocketState, TtsAudioPayload } from '../WebSocketClient';
import type { Socket } from 'socket.io-client';
import type { TranscriptionResult, SessionMetrics } from '../types';

export type ConnectionStatus = 'idle' | 'ready' | 'error';

export interface UseWebSocketReturn {
  /**
   * ws client ref — 始终返回稳定 ref, 避免 stale-closure 问题。
   * 在 useEffect 回调中通过 clientRef.current 访问，保证命令式调用时总是非 null。
   */
  clientRef: React.MutableRefObject<WebSocketClient | null>;
  /** socket 层连接状态 */
  wsState: WebSocketState;
  /** 语义层连接状态 (idle / ready / error) */
  connectionStatus: ConnectionStatus;
  /** 服务端分配的 session id */
  sessionId: string | null;
  /** 最近一次错误信息 */
  error: string | null;
  /**
   * 注册 "transcription_result 来啦" 回调
   */
  onTranscription: (cb: (r: TranscriptionResult) => void) => void;
  onLatency: (cb: (ms: number) => void) => void;
  onSessionStatus: (cb: (m: SessionMetrics) => void) => void;
  /** F7: 注册 recording_stopped 回调（服务端停止录音确认） */
  onRecordingStopped: (cb: (data: any) => void) => void;
  /** TTS: 注册音频片段到达回调 (TtsPlayer 用) */
  onTtsAudio: (cb: (p: TtsAudioPayload) => void) => void;
  /** 底层 Socket.IO socket 实例 (供同声传译 hook 直接订阅事件) */
  socket: Socket | null;
}

export const useWebSocket = (url: string): UseWebSocketReturn => {
  const [wsState, setWsState] = useState<WebSocketState>('disconnected');
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<WebSocketClient | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  // 用 ref 存回调集合, 让 consumer 可以注册 / 注销, 不会因为 React rerender 丢失
  const transcriptionCbRef = useRef<((r: TranscriptionResult) => void) | null>(null);
  const latencyCbRef = useRef<((ms: number) => void) | null>(null);
  const sessionStatusCbRef = useRef<((m: SessionMetrics) => void) | null>(null);
  const recordingStoppedCbRef = useRef<((data: any) => void) | null>(null);  // F7
  const ttsAudioCbRef = useRef<((p: TtsAudioPayload) => void) | null>(null);

  useEffect(() => {
    const client = new WebSocketClient(url);
    clientRef.current = client;

    client.onConnected((sid: string) => {
      setSessionId(sid);
      setWsState('connected');
      setConnectionStatus('ready');
      setError(null);
    });

    client.onDisconnected(() => {
      setSessionId(null);
      setWsState('disconnected');
      setConnectionStatus('idle');
    });

    client.onError((msg: string) => {
      setError(msg);
      setConnectionStatus('error');
      setWsState('error');
    });

    // 桥接到内部 ref, 永远拿最新回调 (避免 useCallback stale closure)
    client.onTranscriptionResult((result) => {
      transcriptionCbRef.current?.(result);
    });
    client.onLatencyRecorded((ms) => {
      latencyCbRef.current?.(ms);
    });
    client.onSessionStatus((m) => {
      sessionStatusCbRef.current?.(m);
    });
    // F7: recording_stopped 桥接
    client.onRecordingStopped((data) => {
      recordingStoppedCbRef.current?.(data);
    });
    // TTS 音频片段到达桥接
    client.onTtsAudio((p) => {
      ttsAudioCbRef.current?.(p);
    });

    client.connect();
    // socket 在 connect() 中同步创建, 存入 state 供 useSimultaneousInterpretation 订阅
    setSocket(client.getSocket());

    return () => {
      client.disconnect();
      clientRef.current = null;
      setSocket(null);
    };
  }, [url]);

  const onTranscription = useCallback(
    (cb: (r: TranscriptionResult) => void) => {
      transcriptionCbRef.current = cb;
    },
    [],
  );
  const onLatency = useCallback((cb: (ms: number) => void) => {
    latencyCbRef.current = cb;
  }, []);
  const onSessionStatus = useCallback((cb: (m: SessionMetrics) => void) => {
    sessionStatusCbRef.current = cb;
  }, []);
  const onRecordingStopped = useCallback((cb: (data: any) => void) => {
    recordingStoppedCbRef.current = cb;
  }, []);
  const onTtsAudio = useCallback((cb: (p: TtsAudioPayload) => void) => {
    ttsAudioCbRef.current = cb;
  }, []);

  return {
    clientRef,  // 返回 ref 而非 .current, 消除 stale closure
    wsState,
    connectionStatus,
    sessionId,
    error,
    onTranscription,
    onLatency,
    onSessionStatus,
    onRecordingStopped,
    onTtsAudio,
    socket,
  };
};