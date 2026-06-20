/**
 * transcriptionReducer
 * --------------------
 * Pure reducer that owns all transcription state transitions.
 * Centralising this makes every state mutation unit-testable without React.
 *
 * Designed for TDD: no I/O, no timers, no globals. Same in -> same out.
 *
 * Author: Claude Opus 4.8 (Sprint 5 refactor)
 */
import type {
  TranscriptionResult,
  WordInfo,
  SessionMetrics,
} from '../types';

export interface TranscriptionState {
  results: TranscriptionResult[];          // 累积的 final 段
  currentText: string;                     // partial 当前正在说的话
  fullText: string;                        // 服务端累计的全文
  words: WordInfo[];                       // 词级时间戳 (final 段接收)
  finalStartTime: number;                  // 当前 final 段播放原点
  metrics: SessionMetrics;
}

export const initialTranscriptionState: TranscriptionState = {
  results: [],
  currentText: '',
  fullText: '',
  words: [],
  finalStartTime: 0,
  metrics: {
    audioBytes: 0,
    transcriptionChars: 0,
    chunksProcessed: 0,
    avgLatency: 0,
    totalLatencies: 0,
    startTime: 0,
  },
};

export type TranscriptionAction =
  | { type: 'TRANSCRIPT_PARTIAL'; text: string; fullText: string }
  | { type: 'TRANSCRIPT_FINAL'; result: TranscriptionResult }
  | { type: 'CLEAR' }
  | { type: 'METRICS_UPDATE'; metrics: SessionMetrics }
  | { type: 'AUDIO_CHUNK_RECORDED'; byteLength: number }
  | { type: 'SESSION_RESET'; startTime: number };

/** 给定数字, 取滑动上限 (避免 actions 之间重复字面量) */
const MAX_RESULTS = 200;

export function transcriptionReducer(
  state: TranscriptionState,
  action: TranscriptionAction,
): TranscriptionState {
  switch (action.type) {
    case 'TRANSCRIPT_PARTIAL': {
      // partial: 不入 results 列表, 只刷新 currentText / fullText
      return {
        ...state,
        currentText: action.text,
        fullText: action.fullText || state.fullText,
      };
    }

    case 'TRANSCRIPT_FINAL': {
      const { result } = action;
      const nextWords =
        result.words && result.words.length > 0 ? result.words : state.words;
      const nextResults = [...state.results, result].slice(-MAX_RESULTS);
      return {
        ...state,
        results: nextResults,
        currentText: '',                 // final 来了 → 清空 partial
        fullText: result.fullText || state.fullText,
        words: nextWords,
        // 重置卡拉OK播放原点: 让字幕从 "开始" 位置高亮
        finalStartTime: performance.now(),
        metrics: {
          ...state.metrics,
          transcriptionChars:
            state.metrics.transcriptionChars + (result.text?.length ?? 0),
        },
      };
    }

    case 'CLEAR': {
      return {
        ...initialTranscriptionState,
        // 保留 metrics 起始时间, 不清零 — 整次会话的累计指标仍有意义
        metrics: {
          ...initialTranscriptionState.metrics,
          startTime: state.metrics.startTime,
        },
      };
    }

    case 'METRICS_UPDATE': {
      return { ...state, metrics: action.metrics };
    }

    case 'AUDIO_CHUNK_RECORDED': {
      return {
        ...state,
        metrics: {
          ...state.metrics,
          audioBytes: state.metrics.audioBytes + action.byteLength,
          chunksProcessed: state.metrics.chunksProcessed + 1,
        },
      };
    }

    case 'SESSION_RESET': {
      return {
        ...initialTranscriptionState,
        metrics: {
          ...initialTranscriptionState.metrics,
          startTime: action.startTime,
        },
      };
    }

    default:
      return state;
  }
}