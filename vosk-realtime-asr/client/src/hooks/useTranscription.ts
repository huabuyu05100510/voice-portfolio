/**
 * useTranscription
 * ----------------
 * 薄壳包 transcriptionReducer, 提供 React 友好接口。
 * 把 onChunk / onTranscript / clear / sessionReset 都收敛到 dispatch。
 *
 * Author: Claude Opus 4.8
 * Updated: 火山引擎分角色 — pushPartial/pushFinal 增加 speakerId 参数
 * Sprint 12 模块 A: pushPartial 接入 16ms 节流, 与 rAF 对齐, 减 reducer 抖动
 * Task 13.4: 内联节流迁移至 useThrottledPartial<PartialPayload>
 */
import { useReducer, useCallback } from 'react';
import {
  transcriptionReducer,
  initialTranscriptionState,
  type TranscriptionState,
  type TranscriptionAction,
} from '../state/transcriptionReducer';
import type { TranscriptionResult, SessionMetrics } from '../types';
import { useThrottledPartial } from './useThrottledPartial';

export interface UseTranscriptionReturn {
  state: TranscriptionState;
  /** 原始 reducer dispatch — 供 file-asr 等子模块把异步结果 merge 进同一棵 state 树 (Sprint 18) */
  dispatch: React.Dispatch<TranscriptionAction>;
  /** 收到 partial result (服务端 partial 不带 words, 16ms 节流) */
  pushPartial: (text: string, fullText: string, speakerId?: string | null) => void;
  /** 收到 final result (服务端 final 带 words / fullText / speakers / utterances) */
  pushFinal: (result: TranscriptionResult, isCumulative?: boolean) => void;
  /** 音频 chunk 累计 (来自 recorder hook) */
  recordAudioChunk: (byteLength: number) => void;
  /** 服务端主动推送的 session metrics */
  updateMetrics: (m: SessionMetrics) => void;
  /** 清除转写结果 (R 键) */
  clear: () => void;
  /** 新会话开始 (start_recording) */
  reset: (startTime: number) => void;
  /** 说话人重命名 — sticky, 服务端后续推送同 id 不能覆盖 (会议室场景) */
  renameSpeaker: (speakerId: string, label: string) => void;
}

/** Partial payload used by throttling (Task 13.4: generic throttle) */
interface PartialPayload {
  text: string;
  fullText: string;
  speakerId: string | null;
}

export const useTranscription = (): UseTranscriptionReturn => {
  const [state, dispatch] = useReducer(
    transcriptionReducer,
    initialTranscriptionState,
  );

  // --------------------------------------------------------------------------
  // Task 13.4: 委托 useThrottledPartial<PartialPayload> 进行 leading+trailing 节流
  //   - leading edge 立即 dispatch (响应感)
  //   - 窗口内 (16ms) 多次调用合并为最后一次的 trailing dispatch
  //   - pushPartial 调用 throttledPush.push(); pushFinal 调用 throttledPush.flush()
  // --------------------------------------------------------------------------
  const throttledPush = useThrottledPartial<PartialPayload>({
    intervalMs: 16,
    leading: true,
    onEmit: (p: PartialPayload) => {
      dispatch({ type: 'TRANSCRIPT_PARTIAL', text: p.text, fullText: p.fullText, speakerId: p.speakerId });
    },
  });

  const pushPartial = useCallback((text: string, fullText: string, speakerId?: string | null) => {
    throttledPush({ text, fullText, speakerId: speakerId ?? null });
  }, [throttledPush]);

  // A1 修复: performance.now() 在 dispatch 处调用 (调用点), 而非在 reducer 内部
  // F2 修复: isCumulative 由服务端告知, 透传给 reducer 决定是否走前缀匹配启发式
  const pushFinal = useCallback((result: TranscriptionResult, isCumulative?: boolean) => {
    // Flush any pending partial before dispatching final (Task 13.4)
    throttledPush.flush();
    dispatch({
      type: 'TRANSCRIPT_FINAL',
      result,
      timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      isCumulative,
    });
  }, [throttledPush]);

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

  const renameSpeaker = useCallback((speakerId: string, label: string) => {
    dispatch({ type: 'RENAME_SPEAKER', speakerId, label });
  }, []);

  return {
    state,
    dispatch,
    pushPartial,
    pushFinal,
    recordAudioChunk,
    updateMetrics,
    clear,
    reset,
    renameSpeaker,
  };
};
