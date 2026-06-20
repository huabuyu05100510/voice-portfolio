/**
 * useWebSocket
 * ------------
 * 封装 WebSocketClient + 顶层状态 (wsState / sessionId / error / status)。
 * 不暴露回调集合 (那是 ws client 自己的事), 只把"语义状态"传给消费者。
 *
 * Author: Claude Opus 4.8
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketClient, WebSocketState } from '../WebSocketClient';
import type { TranscriptionResult, SessionMetrics } from '../types';

export type ConnectionStatus = 'idle' | 'ready' | 'error';

export interface UseWebSocketReturn {
  /** ws client 引用, 供外部 emit/startRecording 等命令式调用 */
  client: WebSocketClient | null;
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
   * 之所以提供 register 接口, 是因为 useRecorder / useTranscription
   * 在不同 mount 期需要订阅同一个 client; 用稳定回调避免竞态
   */
  onTranscription: (cb: (r: TranscriptionResult) => void) => void;
  onLatency: (cb: (ms: number) => void) => void;
  onSessionStatus: (cb: (m: SessionMetrics) => void) => void;
}

export const useWebSocket = (url: string): UseWebSocketReturn => {
  const [wsState, setWsState] = useState<WebSocketState>('disconnected');
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<WebSocketClient | null>(null);
  // 用 ref 存回调集合, 让 consumer 可以注册 / 注销, 不会因为 React rerender 丢失
  const transcriptionCbRef = useRef<((r: TranscriptionResult) => void) | null>(null);
  const latencyCbRef = useRef<((ms: number) => void) | null>(null);
  const sessionStatusCbRef = useRef<((m: SessionMetrics) => void) | null>(null);

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

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
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

  return {
    client: clientRef.current,
    wsState,
    connectionStatus,
    sessionId,
    error,
    onTranscription,
    onLatency,
    onSessionStatus,
  };
};