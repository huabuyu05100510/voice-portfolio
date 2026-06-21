/**
 * useTranscription
 * ----------------
 * 薄壳包 transcriptionReducer, 提供 React 友好接口。
 * 把 onChunk / onTranscript / clear / sessionReset 都收敛到 dispatch。
 *
 * Author: Claude Opus 4.8
 * Updated: 火山引擎分角色 — pushPartial/pushFinal 增加 speakerId 参数
 */
import { useReducer, useCallback } from 'react';
import {
  transcriptionReducer,
  initialTranscriptionState,
  type TranscriptionState,
} from '../state/transcriptionReducer';
import type { TranscriptionResult, SessionMetrics } from '../types';

export interface UseTranscriptionReturn {
  state: TranscriptionState;
  /** 收到 partial result (服务端 partial 不带 words) */
  pushPartial: (text: string, fullText: string, speakerId?: string | null) => void;
  /** 收到 final result (服务端 final 带 words / fullText / speakers / utterances) */
  pushFinal: (result: TranscriptionResult) => void;
  /** 音频 chunk 累计 (来自 recorder hook) */
  recordAudioChunk: (byteLength: number) => void;
  /** 服务端主动推送的 session metrics */
  updateMetrics: (m: SessionMetrics) => void;
  /** 清除转写结果 (R 键) */
  clear: () => void;
  /** 新会话开始 (start_recording) */
  reset: (startTime: number) => void;
}

export const useTranscription = (): UseTranscriptionReturn => {
  const [state, dispatch] = useReducer(
    transcriptionReducer,
    initialTranscriptionState,
  );

  const pushPartial = useCallback((text: string, fullText: string, speakerId?: string | null) => {
    dispatch({ type: 'TRANSCRIPT_PARTIAL', text, fullText, speakerId: speakerId ?? null });
  }, []);

  const pushFinal = useCallback((result: TranscriptionResult) => {
    dispatch({ type: 'TRANSCRIPT_FINAL', result });
  }, []);

  const recordAudioChunk = useCallback((byteLength: number) => {
    dispatch({ type: 'AUDIO_CHUNK_RECORDED', byteLength });
  }, []);

  const updateMetrics = useCallback((m: SessionMetrics) => {
    dispatch({ type: 'METRICS_UPDATE', metrics: m });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const reset = useCallback((startTime: number) => {
    dispatch({ type: 'SESSION_RESET', startTime });
  }, []);

  return {
    state,
    pushPartial,
    pushFinal,
    recordAudioChunk,
    updateMetrics,
    clear,
    reset,
  };
};
