/**
 * useSeedTts — SeedTTS 2.0 (语音合成 2.0) 后端代理 hook
 *
 * 链路:
 *   useSeedTts.synthesize({text, voice, speed, pitch, audio_format})
 *     → POST /api/tts/synthesize (同源, vite proxy → Flask)
 *     → server/tts.py → 火山引擎 语音合成 2.0
 *     → 200 audio/mpeg bytes → 包装成 Blob → URL.createObjectURL
 *
 * 设计原则:
 * - 凭证永不下发: 全部走服务端代理 (见 server/tts.py)
 * - ObjectURL 生命周期: 切换/卸载时 revoke, 防止内存泄漏
 * - AbortController: cancel() 中断未完成请求
 * - 失败不抛: 业务错误返回 {ok:false, error, status}, 由 UI 渲染
 *
 * Author: voice-portfolio TTS 2.0 agent (2026-06-27)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const BASE = (import.meta as any).env?.VITE_TTS_BASE || '/api/tts';

export interface TtsVoice {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'child' | 'unknown' | string;
  sample_rate: number;
}

export interface TtsSynthesizeOptions {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  audioFormat?: 'mp3' | 'pcm' | 'wav' | 'ogg' | 'opus';
  sampleRate?: number;
}

export type TtsStatus = 'idle' | 'synthesizing' | 'ready' | 'error';

export interface TtsState {
  status: TtsStatus;
  audioUrl: string | null;
  /** 最近一次响应的 audio bytes (供下载 / 上传复用) */
  audioBlob: Blob | null;
  error: string | null;
  /** 最近一次合成耗时 (ms) */
  latencyMs: number | null;
  /** 最近一次 HTTP status code (非 2xx 也带回) */
  lastStatus: number | null;
}

export interface TtsSynthesizeResult {
  ok: boolean;
  status?: number;
  audio?: Blob;
  error?: string;
}

export interface UseSeedTtsReturn extends TtsState {
  synthesize: (opts: TtsSynthesizeOptions) => Promise<TtsSynthesizeResult>;
  cancel: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// 音色列表 — 模块级缓存 (避免重复请求)
// ---------------------------------------------------------------------------
let _voicesCache: TtsVoice[] | null = null;
let _voicesPromise: Promise<TtsVoice[]> | null = null;
let _voicesMeta: { degraded?: boolean; source?: string } | null = null;

export async function fetchVoices(force = false): Promise<TtsVoice[]> {
  if (!force && _voicesCache) return _voicesCache;
  if (!force && _voicesPromise) return _voicesPromise;
  _voicesPromise = (async () => {
    try {
      const r = await fetch(`${BASE}/voices`, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`voices http ${r.status}`);
      const j = await r.json();
      _voicesCache = Array.isArray(j.data) ? j.data : [];
      _voicesMeta = { degraded: j.degraded, source: j.source };
      return _voicesCache!;
    } catch (e) {
      // 兜底: 内置 4 个豆包经典音色
      _voicesCache = [
        { id: 'BV001_streaming', name: '磁性男声', gender: 'male',   sample_rate: 24000 },
        { id: 'BV002_streaming', name: '温柔女声', gender: 'female', sample_rate: 24000 },
        { id: 'BV003_streaming', name: '活力童声', gender: 'child',  sample_rate: 24000 },
        { id: 'BV004_streaming', name: '沉稳旁白', gender: 'male',   sample_rate: 24000 },
      ];
      _voicesMeta = { degraded: true, source: 'client_fallback' };
      return _voicesCache;
    } finally {
      _voicesPromise = null;
    }
  })();
  return _voicesPromise;
}

export function getVoicesMeta(): { degraded?: boolean; source?: string } | null {
  return _voicesMeta;
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------
export const useSeedTts = (): UseSeedTtsReturn => {
  const [state, setState] = useState<TtsState>({
    status: 'idle',
    audioUrl: null,
    audioBlob: null,
    error: null,
    latencyMs: null,
    lastStatus: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const lastBlobRef = useRef<Blob | null>(null);

  // 卸载时清理
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (lastUrlRef.current) {
        safeRevokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = null;
      }
      lastBlobRef.current = null;
    };
  }, []);

  const replaceAudioUrl = useCallback((newUrl: string | null, newBlob: Blob | null) => {
    if (lastUrlRef.current && lastUrlRef.current !== newUrl) {
      safeRevokeObjectURL(lastUrlRef.current);
    }
    lastUrlRef.current = newUrl;
    lastBlobRef.current = newBlob;
  }, []);

  const synthesize = useCallback(async (opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> => {
    if (!opts.text || !opts.text.trim()) {
      const msg = 'text 不能为空';
      setState(s => ({ ...s, status: 'error', error: msg }));
      return { ok: false, error: msg };
    }
    // 中断上一个未完成
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState(s => ({ ...s, status: 'synthesizing', error: null, lastStatus: null }));

    const start = performance.now();
    try {
      const r = await fetch(`${BASE}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg, */*' },
        body: JSON.stringify({
          text: opts.text,
          voice: opts.voice,
          speed: opts.speed ?? 1.0,
          pitch: opts.pitch ?? 1.0,
          volume: opts.volume ?? 1.0,
          audio_format: opts.audioFormat ?? 'mp3',
          sample_rate: opts.sampleRate ?? 24000,
        }),
        signal: ac.signal,
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!r.ok) {
        let detail = '';
        try {
          const j = await r.json();
          detail = j.error || '';
        } catch {}
        const errMsg = detail ? `HTTP ${r.status}: ${detail}` : `HTTP ${r.status}`;
        setState(s => ({
          ...s,
          status: 'error',
          error: errMsg,
          latencyMs,
          lastStatus: r.status,
        }));
        return { ok: false, status: r.status, error: errMsg };
      }
      const blob = await r.blob();
      // 强制 mime (服务端可能给 application/octet-stream)
      if (!blob.type || blob.type === 'application/octet-stream') {
        const newBlob = new Blob([blob], { type: mimeFor(opts.audioFormat || 'mp3') });
        return finishOk(newBlob, latencyMs, r.status);
      }
      return finishOk(blob, latencyMs, r.status);

      function finishOk(blob: Blob, latencyMs: number, status: number) {
        const url = safeCreateObjectURL(blob);
        replaceAudioUrl(url, blob);
        setState(s => ({
          ...s,
          status: 'ready',
          audioUrl: url,
          audioBlob: blob,
          error: null,
          latencyMs,
          lastStatus: status,
        }));
        return { ok: true, status, audio: blob };
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setState(s => ({ ...s, status: 'idle', error: null }));
        return { ok: false, error: 'aborted' };
      }
      const msg = e?.message || String(e);
      setState(s => ({
        ...s,
        status: 'error',
        error: msg,
        latencyMs: Math.round(performance.now() - start),
      }));
      return { ok: false, error: msg };
    }
  }, [replaceAudioUrl]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState({
      status: 'idle',
      audioUrl: null,
      audioBlob: null,
      error: null,
      latencyMs: null,
      lastStatus: null,
    });
    replaceAudioUrl(null, null);
  }, [cancel, replaceAudioUrl]);

  return { ...state, synthesize, cancel, reset };
};

function mimeFor(fmt: string): string {
  switch ((fmt || '').toLowerCase()) {
    case 'mp3':  return 'audio/mpeg';
    case 'pcm':  return 'audio/pcm';
    case 'wav':  return 'audio/wav';
    case 'ogg':
    case 'opus': return 'audio/ogg';
    default:     return 'application/octet-stream';
  }
}

// jsdom / 老浏览器兜底: createObjectURL/revokeObjectURL 不存在
let _objUrlCounter = 0;
function safeCreateObjectURL(blob: Blob): string {
  const fn = (URL as any)?.createObjectURL;
  if (typeof fn === 'function') return fn.call(URL, blob);
  // 兜底: 假 URL, 仅用于 jsdom 单测 (UI 不会真播)
  _objUrlCounter += 1;
  return `blob:test/${_objUrlCounter}`;
}
function safeRevokeObjectURL(url: string): void {
  const fn = (URL as any)?.revokeObjectURL;
  if (typeof fn === 'function') {
    try { fn.call(URL, url); } catch {}
  }
}
