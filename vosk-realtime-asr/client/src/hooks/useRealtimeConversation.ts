/**
 * useRealtimeConversation
 * -----------------------
 * 端到端实时语音交互的 React hook.
 *
 * 职责:
 *  - 管理 WebSocket 生命周期 (/api/realtime 代理到火山引擎 Realtime Voice)
 *  - 采集麦克风 PCM 16kHz → 编码为 base64 → 发送 input_audio_buffer.append
 *  - 接收服务端 JSON 事件 → dispatch reducer action
 *  - AI 音频 delta → AudioContext 队列播放 (支持打断)
 *  - 用户输入 → VAD 自动检测 / 手按 PTT 两种模式 (本期: server_vad 自动)
 *
 * 设计原则:
 *  - 与 conversationReducer 配合 (state 由 reducer 管理)
 *  - 不持有业务 UI 状态; 仅暴露状态 + 控制句柄
 *  - 错误/断开/重连统一由 hook 处理, 业务侧只关心 dispatch
 *
 * Model: MiniMax-M3 (Sprint 13)
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  conversationReducer,
  initialConversationState,
  type ConversationAction,
  type ConversationState,
} from '../state/conversationReducer';

/** 默认实时语音交互 WebSocket URL（走 Vite 代理 /api/realtime） */
export function defaultRealtimeWsUrl(): string {
  const base = import.meta.env.VITE_REALTIME_WS_URL ?? '';
  if (base) return base;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/realtime`;
}

export type RealtimeTransport = 'websocket' | 'auto';

export interface UseRealtimeConversationOptions {
  /** WebSocket URL, e.g. ws://localhost:5001/api/realtime 或 http://localhost:5001/api/realtime (自动转 ws) */
  url: string;
  /** 自动连接 (默认 true, 若 false 则调用 connect() 才连接) */
  autoConnect?: boolean;
  /** 麦克风采样率 (默认 16000) */
  sampleRate?: number;
  /** 是否启用自动麦克风采集 (默认 true; false 时业务侧手动喂 PCM via sendAudio) */
  autoCapture?: boolean;
  /** 每次发送的 PCM 字节数 (默认 3200 = 100ms @ 16kHz int16) */
  chunkBytes?: number;
}

export interface UseRealtimeConversationReturn {
  state: ConversationState;
  /** 手动建立连接 */
  connect: () => void;
  /** 主动断开 (清空 streaming) */
  disconnect: () => void;
  /** 重置对话历史 (不清连接) */
  clear: () => void;
  /** 手动发送一段 PCM 16kHz int16 (autoCapture=false 时使用) */
  sendAudio: (pcm: Int16Array) => void;
  /** 立即停止 AI 音频播放 (barge-in 客户端保险栓) */
  stopPlayback: () => void;
  /** 内部 action 注入 (供测试) */
  dispatch: (a: ConversationAction) => void;
}

export function useRealtimeConversation(
  options: UseRealtimeConversationOptions,
): UseRealtimeConversationReturn {
  const {
    url,
    autoConnect = true,
    sampleRate = 16000,
    autoCapture = true,
    chunkBytes = 3200,
  } = options;

  const [state, baseDispatch] = useReducer(conversationReducer, initialConversationState);
  const dispatchRef = useRef(baseDispatch);
  dispatchRef.current = baseDispatch;
  const dispatch = useCallback((a: ConversationAction) => dispatchRef.current(a), []);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const chunkBufferRef = useRef<Int16Array[]>([]);
  const closedRef = useRef<boolean>(false);

  // ------------------------------------------------------------------
  // AI audio playback queue
  // ------------------------------------------------------------------
  const stopPlayback = useCallback(() => {
    try {
      if (currentSourceRef.current) {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
        currentSourceRef.current = null;
      }
    } catch {
      // ignore
    }
    audioBufferQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  const enqueueAudioBuffer = useCallback((pcmBytes: ArrayBuffer | Int16Array) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const int16 =
      pcmBytes instanceof Int16Array
        ? pcmBytes
        : new Int16Array(pcmBytes as ArrayBuffer);
    if (int16.length === 0) return;
    // 16-bit PCM mono @ 16kHz
    const buffer = ctx.createBuffer(1, int16.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;
    audioBufferQueueRef.current.push(buffer);
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      playNext();
    }
    function playNext() {
      const next = audioBufferQueueRef.current.shift();
      if (!next) {
        isPlayingRef.current = false;
        return;
      }
      try {
        const src = ctx.createBufferSource();
        src.buffer = next;
        src.connect(ctx.destination);
        src.onended = () => {
          currentSourceRef.current = null;
          playNext();
        };
        currentSourceRef.current = src;
        src.start();
      } catch {
        isPlayingRef.current = false;
      }
    }
  }, [sampleRate]);

  // ------------------------------------------------------------------
  // Microphone capture (16kHz mono int16)
  // ------------------------------------------------------------------
  const startCapture = useCallback(async () => {
    if (!autoCapture) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = proc;
      source.connect(proc);
      proc.connect(ctx.destination); // 必须连, 否则 onprocess 不触发
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) {
          const s = Math.max(-1, Math.min(1, ch[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // 累计到 chunkBytes 大小再发送 (避免每帧都打 WS)
        chunkBufferRef.current.push(int16);
        let total = 0;
        for (const arr of chunkBufferRef.current) total += arr.byteLength;
        if (total >= chunkBytes) {
          const merged = mergeChunks(chunkBufferRef.current);
          chunkBufferRef.current = [];
          sendPcmToWs(merged);
        }
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'CONNECT_FAIL', error: `麦克风权限失败: ${err}` });
    }
  }, [autoCapture, sampleRate, chunkBytes, dispatch]);

  const stopCapture = useCallback(() => {
    try {
      processorRef.current?.disconnect();
    } catch { /* ignore */ }
    processorRef.current = null;
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    mediaStreamRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, []);

  // ------------------------------------------------------------------
  // WebSocket lifecycle
  // ------------------------------------------------------------------
  const normalizeUrl = useCallback((u: string) => {
    if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
    if (u.startsWith('http://')) return `ws://${u.slice('http://'.length)}/api/realtime`;
    if (u.startsWith('https://')) return `wss://${u.slice('https://'.length)}/api/realtime`;
    return u;
  }, []);

  function sendPcmToWs(pcm: Int16Array) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    // 服务端 encode_audio_chunk 期望 raw PCM bytes, 内部 base64 编码
    ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio_bytes_b64: bytesToBase64(bytes),
    }));
  }

  const sendAudio = useCallback((pcm: Int16Array) => {
    sendPcmToWs(pcm);
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current && wsRef.current?.readyState === WebSocket.OPEN) return;
    closedRef.current = false;
    const wsUrl = normalizeUrl(url);
    dispatch({ type: 'CONNECT_START' });
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        startedAtRef.current = ts;
        dispatch({ type: 'CONNECT_OPEN', timestamp: ts });
        // 发送 session.update (默认 config)
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            model: 'Doubao_scene_SLM_Doubao_realtime_voice_model',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: { type: 'server_vad', silence_duration_ms: 400, threshold: 0.5 },
          },
        }));
        void startCapture();
      };
      ws.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (!raw) return;
        handleServerEvent(raw);
      };
      ws.onerror = () => {
        dispatch({ type: 'CONNECT_FAIL', error: 'WebSocket 错误' });
      };
      ws.onclose = () => {
        stopCapture();
        stopPlayback();
        wsRef.current = null;
        if (state.status !== 'idle') {
          dispatch({ type: 'DISCONNECT' });
        }
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'CONNECT_FAIL', error: err });
    }
  }, [url, normalizeUrl, dispatch, startCapture, stopCapture, stopPlayback, state.status]);

  const disconnect = useCallback(() => {
    closedRef.current = true;
    try {
      wsRef.current?.close();
    } catch { /* ignore */ }
    wsRef.current = null;
    stopCapture();
    stopPlayback();
    dispatch({ type: 'DISCONNECT' });
  }, [dispatch, stopCapture, stopPlayback]);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, [dispatch]);

  // ------------------------------------------------------------------
  // Server event → reducer actions
  // ------------------------------------------------------------------
  function handleServerEvent(raw: string) {
    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      return;
    }
    const t = obj.type as string;
    const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (t === 'input_audio_buffer.speech_started') {
      // barge-in: 立即停止播放 + commit streaming
      stopPlayback();
      dispatch({ type: 'BARGE_IN', timestamp: ts, responseId: state.streamingResponseId });
      return;
    }

    if (t === 'conversation.item.input_audio_transcription.completed') {
      const transcript = obj.transcript as string;
      dispatch({ type: 'USER_MESSAGE', text: transcript, timestamp: ts });
      return;
    }

    if (t === 'response.audio.delta') {
      const audioB64 = obj.audio || obj.delta;
      if (typeof audioB64 === 'string' && audioB64) {
        const bytes = base64ToBytes(audioB64);
        enqueueAudioBuffer(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));
        dispatch({ type: 'AI_AUDIO_CHUNK', bytes: bytes.byteLength, responseId: obj.response_id || state.streamingResponseId || 'unknown' });
      }
      return;
    }

    if (t === 'response.audio_transcript.delta') {
      dispatch({
        type: 'AI_TEXT_DELTA',
        text: obj.delta as string,
        responseId: (obj.response_id as string) || 'unknown',
      });
      return;
    }

    if (t === 'response.audio_transcript.done') {
      dispatch({
        type: 'AI_TEXT_DONE',
        fullText: obj.transcript as string,
        responseId: (obj.response_id as string) || 'unknown',
        timestamp: ts,
      });
      return;
    }

    if (t === 'response.done') {
      const responseId = obj.response?.id || state.streamingResponseId || 'unknown';
      const latencyMs =
        startedAtRef.current != null
          ? ts - startedAtRef.current
          : undefined;
      dispatch({ type: 'TURN_DONE', responseId, timestamp: ts, latencyMs });
      // reset start marker for next turn
      startedAtRef.current = ts;
      return;
    }

    if (t === 'error') {
      dispatch({ type: 'CONNECT_FAIL', error: (obj.message as string) || '服务端错误' });
      return;
    }
  }

  // ------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------
  // Task 13.6: 用 connectRef 避免 stale closure + [autoConnect] deps
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    if (autoConnect) {
      connectRef.current();
    }
    return () => {
      closedRef.current = true;
      try { wsRef.current?.close(); } catch { /* ignore */ }
      stopCapture();
      stopPlayback();
    };
  }, [autoConnect]);

  return useMemo(
    () => ({ state, connect, disconnect, clear, sendAudio, stopPlayback, dispatch }),
    [state, connect, disconnect, clear, sendAudio, stopPlayback, dispatch],
  );
}

// ============================================================================
// Helpers
// ============================================================================
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
  }
  // Node fallback
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function mergeChunks(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}