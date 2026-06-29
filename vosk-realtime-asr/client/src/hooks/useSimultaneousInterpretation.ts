/**
 * useSimultaneousInterpretation
 * ------------------------------
 * 同声传译 2.0 React hook
 *
 * 职责:
 *   - 订阅 socket 的 translation_result / translation_error / disconnect / connect
 *   - 对接 transcription final → 自动 emit translate_text (生成 rowId)
 *   - 维护 language pair 状态 (source / target)
 *   - 网络断开时自动 fallback 到 source-only (用户只看到原始字幕)
 *   - 通过 translationReducer (pure) 管理所有状态变化
 *
 * 用法:
 *   const { state, onSourceFinal, setLangPair, clearCache } =
 *     useSimultaneousInterpretation({ socket });
 *
 * Author: MiniMax-M3
 */
import { useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  translationReducer,
  initialTranslationState,
  type TranslationState,
} from '../state/translationReducer';
import type { TranscriptionResult } from '../types';
import type { Socket } from 'socket.io-client';

const TRACER_NAME = 'voice-portfolio-client';
const TRACER_VERSION = '1.0.0';

interface TranslationResultPayload {
  text: string;
  source_text?: string;
  source_language: string;
  target_language: string;
  latency_ms?: number;
  cached?: boolean;
  is_final?: boolean;
  timestamp?: string;
}

interface TranslationErrorPayload {
  message?: string;
  code?: string;
}

export interface UseSimultaneousInterpretationOptions {
  socket: Socket | null;
  /** 默认 source 语言 (默认 'zh') */
  defaultSourceLang?: string;
  /** 默认 target 语言 (默认 'en') */
  defaultTargetLang?: string;
  /** 启用翻译 (false = 仅字幕, 节省 token) */
  enabled?: boolean;
}

export interface UseSimultaneousInterpretationReturn {
  state: TranslationState;
  /** 接收 source partial (灰色实时字幕) — 不发翻译请求 */
  onSourcePartial: (text: string) => void;
  /** 接收 source final — 触发 translate_text emit */
  onSourceFinal: (text: string, rowId: string) => void;
  /** 与 useTranscription 集成: TranscriptionResult(isFinal=true) → 自动翻译 */
  onTranscriptionFinal: (result: TranscriptionResult, rowId: string) => void;
  /** 切换语言对 (清空 stream buffer) */
  setLangPair: (source: string, target: string) => void;
  /** 清空所有 row (UI 上的"清空字幕") */
  clear: () => void;
  /** 通知服务端清空翻译缓存 (切换语言对时自动调用) */
  clearCache: () => void;
}

export function useSimultaneousInterpretation(
  options: UseSimultaneousInterpretationOptions,
): UseSimultaneousInterpretationReturn {
  const { socket, enabled = true } = options;

  const [state, dispatch] = useReducer(
    translationReducer,
    {
      ...initialTranslationState,
      sourceLang: options.defaultSourceLang ?? 'zh',
      targetLang: options.defaultTargetLang ?? 'en',
    },
  );

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const rowIdCounterRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // --------------------------------------------------------------------------
  // OTel tracer (safe — 未初始化返回 NoopTracer)
  // --------------------------------------------------------------------------
  function getTracer() {
    return trace.getTracer(TRACER_NAME, TRACER_VERSION);
  }

  // --------------------------------------------------------------------------
  // SocketIO 事件订阅
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onTranslationResult = (data: TranslationResultPayload) => {
      if (!data) return;
      const sourceText = data.source_text || '';
      const rowId = `trans-${data.timestamp || Date.now()}-${rowIdCounterRef.current++}`;
      const span = getTracer().startSpan('translation.result');
      try {
        span.setAttribute('translation.cached', !!data.cached);
        span.setAttribute('translation.latency_ms', data.latency_ms || 0);
        span.setAttribute('translation.lang_pair', `${data.source_language}-${data.target_language}`);

        // 先 dispatch source final (记入 pending), 再 dispatch target final (合并)
        if (sourceText) {
          dispatch({ type: 'SOURCE_FINAL', text: sourceText, rowId });
        }
        dispatch({
          type: 'TARGET_FINAL',
          text: data.text || '',
          rowId,
          latencyMs: data.latency_ms || 0,
        });

        // eslint-disable-next-line no-console
        console.log(
          `[Translation] text_len=${(data.text || '').length}, latency_ms=${data.latency_ms || 0}, lang_pair=${data.source_language}-${data.target_language}, cached=${!!data.cached}`,
        );
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
      } finally {
        span.end();
      }
    };

    const onTranslationError = (data: TranslationErrorPayload) => {
      dispatch({ type: 'ERROR', message: data?.message || 'unknown translation error' });
      // eslint-disable-next-line no-console
      console.error('[Translation] error:', data);
    };

    const onConnect = () => {
      dispatch({ type: 'CONNECTION_CHANGE', connected: true });
    };

    const onDisconnect = () => {
      dispatch({ type: 'CONNECTION_CHANGE', connected: false });
    };

    socket.on('translation_result', onTranslationResult);
    socket.on('translation_error', onTranslationError);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('translation_result', onTranslationResult);
      socket.off('translation_error', onTranslationError);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  // --------------------------------------------------------------------------
  // Action callbacks
  // --------------------------------------------------------------------------
  const onSourcePartial = useCallback((text: string) => {
    dispatch({ type: 'SOURCE_PARTIAL', text });
  }, []);

  const onSourceFinal = useCallback((text: string, rowId: string) => {
    if (!enabledRef.current || !socket?.connected) {
      // 翻译关闭 / 离线: 仅记入 reducer (fallback 模式由 reducer 处理)
      dispatch({ type: 'SOURCE_FINAL', text, rowId });
      return;
    }
    // 先入 reducer, 暂存 pendingSourceByRow; 等 translation_result 回包时合并
    dispatch({ type: 'SOURCE_FINAL', text, rowId });
    const current = stateRef.current;
    socket.emit('translate_text', {
      text,
      source_lang: current.sourceLang,
      target_lang: current.targetLang,
      row_id: rowId,
    });
  }, [socket]);

  const onTranscriptionFinal = useCallback(
    (result: TranscriptionResult, rowId: string) => {
      const text = (result.text || '').trim();
      if (!text) return;
      onSourceFinal(text, rowId);
    },
    [onSourceFinal],
  );

  const setLangPair = useCallback((source: string, target: string) => {
    dispatch({ type: 'SET_LANG_PAIR', sourceLang: source, targetLang: target });
    // 清空服务端缓存 (避免旧 pair 命中)
    if (socket?.connected) {
      socket.emit('translation_clear_cache');
    }
  }, [socket]);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const clearCache = useCallback(() => {
    if (socket?.connected) {
      socket.emit('translation_clear_cache');
    }
  }, [socket]);

  return useMemo(
    () => ({
      state,
      onSourcePartial,
      onSourceFinal,
      onTranscriptionFinal,
      setLangPair,
      clear,
      clearCache,
    }),
    [state, onSourcePartial, onSourceFinal, onTranscriptionFinal, setLangPair, clear, clearCache],
  );
}