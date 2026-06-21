/**
 * transcriptionReducer
 * --------------------
 * Pure reducer that owns all transcription state transitions.
 * Centralising this makes every state mutation unit-testable without React.
 *
 * Designed for TDD: no I/O, no timers, no globals. Same in -> same out.
 *
 * Author: Claude Opus 4.8 (Sprint 5 refactor)
 * Updated: 火山引擎分角色 — 增加 speakers / currentSpeakerId / utterances
 */
import type {
  TranscriptionResult,
  WordInfo,
  SessionMetrics,
  Speaker,
  Utterance,
} from '../types';

export interface TranscriptionState {
  results: TranscriptionResult[];          // 累积的 final 段
  currentText: string;                     // partial 当前正在说的话
  fullText: string;                        // 服务端累计的全文
  words: WordInfo[];                       // 词级时间戳 (final 段接收)
  finalStartTime: number;                  // 当前 final 段播放原点
  metrics: SessionMetrics;
  /** 已出现的说话人 (id → {label, color}) — 火山引擎分角色 */
  speakers: Speaker[];
  /** 当前 final 段的说话人 ID (用于 Subtitle 高亮) */
  currentSpeakerId: string | null;
  /** 当前 final 段的分段列表 (火山引擎 utterances[]) */
  currentUtterances: Utterance[];
}

// 火山引擎分角色调色板 — 顶级 12 色, 醒目且区分度高
// 涵盖: 暖色(3) + 冷色(5) + 中性(2) + 警示(2)
// 颜色按 contrast 排序, > 8 说话人时按出现顺序循环
export const SPEAKER_COLOR_PALETTE: string[] = [
  '#00d4ff', // cyan       ★
  '#ff7ab6', // pink       ★
  '#7c3aed', // violet     ★
  '#fbbf24', // amber      ★
  '#22c55e', // green      ★
  '#f97316', // orange     ★
  '#06b6d4', // teal       ★
  '#ef4444', // red        ★
  '#a78bfa', // lavender   ★ (新增)
  '#84cc16', // lime       ★ (新增)
  '#f472b6', // rose       ★ (新增)
  '#14b8a6', // teal-deep  ★ (新增)
];

export function getSpeakerColor(id: string): string {
  // 稳定 hash → palette 索引 (同一个 speaker 永远同色)
  // 用 djb2 + 无符号右移, 避免 Math.abs(-2^31) = -2^31 的 JS 边界陷阱
  // 注意: 不暴露 palette 参数, 否则 .map(getSpeakerColor) 会把
  //       Array.prototype.map 的 (item, index, array) 第二参数当 palette 传进来
  const pal = SPEAKER_COLOR_PALETTE;
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  // >>> 0 强制无符号 32 位
  const idx = (h >>> 0) % pal.length;
  return pal[idx];
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
  speakers: [],
  currentSpeakerId: null,
  currentUtterances: [],
};

export type TranscriptionAction =
  | { type: 'TRANSCRIPT_PARTIAL'; text: string; fullText: string; speakerId?: string | null }
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
      return {
        ...state,
        currentText: action.text,
        fullText: action.fullText || state.fullText,
        currentSpeakerId: action.speakerId ?? state.currentSpeakerId,
      };
    }

    case 'TRANSCRIPT_FINAL': {
      const { result } = action;
      const newText = (result.text || '').trim();
      const nextWords =
        result.words && result.words.length > 0 ? result.words : state.words;

      // 合并说话人 (按 id 去重, 给新出现的分配 color)
      const speakerMap = new Map<string, Speaker>();
      for (const s of state.speakers) speakerMap.set(s.id, s);
      for (const s of result.speakers || []) {
        if (!speakerMap.has(s.id)) {
          speakerMap.set(s.id, { ...s, color: getSpeakerColor(s.id) });
        } else if (s.label) {
          // 更新 label (服务端可能后续分配更友好的名字)
          const prev = speakerMap.get(s.id)!;
          speakerMap.set(s.id, { ...prev, label: s.label });
        }
      }
      const mergedSpeakers = Array.from(speakerMap.values());

      // Sprint 11: 增量合并 — 检测是否是同一说话人的连续累积
      // 火山引擎 cumulative 模式下, 每次 final 返回的是累计全文 (新文本在前, 旧文本在后)
      // 客户端应识别:
      //   A) 文本扩展 (new startsWith last) → 就地更新 (最常见)
      //   B) 文本回退 (new 是 last 子串) → 跳过
      //   C) speaker_id 不稳但文本连续 → 仍合并 (放宽: 仅在文本匹配时信任)
      //   D) 完全独立 → 新增
      const lastResult = state.results[state.results.length - 1];
      let nextResults: TranscriptionResult[];
      let deltaChars = 0;

      const lastText = (lastResult?.text || '').trim();
      const sameOrMissingSpeaker =
        !lastResult
        || !lastResult.speaker_id
        || !result.speaker_id
        || lastResult.speaker_id === result.speaker_id;

      if (!newText) {
        // 空文本 — 跳过
        nextResults = state.results;
        deltaChars = 0;
      } else if (
        lastResult
        && newText.length < lastText.length
        && lastText.includes(newText)
      ) {
        // B) 重复推送 (new 是 last 子串) — 跳过, 必须先检查避免被 C2 误判
        nextResults = state.results;
        deltaChars = 0;
      } else if (
        lastResult
        && newText.length >= lastText.length
        && newText.startsWith(lastText)
      ) {
        // A) 文本扩展 (允许 speaker_id 不稳: 火山引擎可能给同一人分配不同 id)
        nextResults = [...state.results.slice(0, -1), result].slice(-MAX_RESULTS);
        deltaChars = newText.length - lastText.length;
      } else if (
        lastResult
        && newText.startsWith(lastText.slice(0, Math.max(8, Math.floor(lastText.length * 0.7))))
      ) {
        // C) 长前缀重合 (≥70% 字符) → 视为同一说话人累积
        nextResults = [...state.results.slice(0, -1), result].slice(-MAX_RESULTS);
        deltaChars = newText.length - lastText.length;
      } else if (
        lastResult
        && sameOrMissingSpeaker
        && newText.length > 4
        && lastText.length > 4
        && newText.includes(lastText.slice(0, 10))
      ) {
        // C2) 共享前缀 ≥10 字符 (短文本子串太脆弱, 用前缀)
        nextResults = [...state.results.slice(0, -1), result].slice(-MAX_RESULTS);
        deltaChars = newText.length - lastText.length;
      } else {
        // D) 新增卡片
        nextResults = [...state.results, result].slice(-MAX_RESULTS);
        deltaChars = newText.length;
      }

      return {
        ...state,
        results: nextResults,
        currentText: '',
        fullText: result.fullText || state.fullText,
        words: nextWords,
        finalStartTime: performance.now(),
        speakers: mergedSpeakers,
        currentSpeakerId: result.speaker_id ?? null,
        currentUtterances: result.utterances || [],
        metrics: {
          ...state.metrics,
          transcriptionChars: state.metrics.transcriptionChars + deltaChars,
        },
      };
    }

    case 'CLEAR': {
      return {
        ...initialTranscriptionState,
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
