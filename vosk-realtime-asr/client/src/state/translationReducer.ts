/**
 * translationReducer
 * --------------------
 * 同声传译 2.0 状态管理 - 纯函数 reducer
 *
 * 负责:
 *   - 双语流 (source / target) 同步
 *   - 行对齐 (source 先到 → 等 target; target 先到 → 等 source)
 *   - 网络断连 → fallback 到 source-only
 *   - 语言对切换清空 buffer (避免错位)
 *
 * 与 transcriptionReducer 同模式: 无 I/O / 无 timers / 无 globals, 纯函数可测.
 *
 * Author: MiniMax-M3
 */
export interface LangPairPreset {
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
}

/** 支持的语言对预设 (与后端 SUPPORTED_PAIRS 对齐) */
export const SUPPORTED_LANG_PAIRS: LangPairPreset[] = [
  { source: 'zh', target: 'en', sourceLabel: '中文', targetLabel: 'English' },
  { source: 'en', target: 'zh', sourceLabel: 'English', targetLabel: '中文' },
  { source: 'zh', target: 'ja', sourceLabel: '中文', targetLabel: '日本語' },
  { source: 'ja', target: 'zh', sourceLabel: '日本語', targetLabel: '中文' },
  { source: 'zh', target: 'ko', sourceLabel: '中文', targetLabel: '한국어' },
  { source: 'ko', target: 'zh', sourceLabel: '한국어', targetLabel: '中文' },
  { source: 'en', target: 'ja', sourceLabel: 'English', targetLabel: '日本語' },
  { source: 'ja', target: 'en', sourceLabel: '日本語', targetLabel: 'English' },
];

/** 对齐的双语行 (一行 = 源 + 目标) */
export interface AlignedRow {
  id: string;
  source: string;
  target: string;
  /** 客户端 performance.now() 时间戳 (ms) */
  timestamp: number;
  /** 翻译延迟 ms (null = 尚未翻译到达) */
  latencyMs: number | null;
}

/** 待合并的 target (target 先到, 等 source) */
interface PendingTarget {
  text: string;
  latencyMs: number;
}

export interface TranslationState {
  /** 当前语言对 */
  sourceLang: string;
  targetLang: string;

  /** 当前行 source partial (灰色实时滚动) */
  partialSource: string;
  /** 当前行 target partial (高亮色实时滚动) */
  partialTarget: string;

  /** 已对齐的双语字幕行 (倒序: 最新在前) */
  rows: AlignedRow[];

  /** 网络状态 */
  translationConnected: boolean;
  /** 网络断 / API 失败时降级到 source-only */
  fallbackMode: boolean;

  /** 当前错误信息 */
  error: string | null;

  /** 行对齐协调: source 先到时按 rowId 暂存, target 到达后取出合并 */
  pendingSourceByRow: Record<string, string>;
  /** 行对齐协调: target 先到时按 rowId 暂存, source 到达后取出合并 */
  pendingTargetByRow: Record<string, PendingTarget>;
}

const MAX_ROWS = 200;

export const initialTranslationState: TranslationState = {
  sourceLang: 'zh',
  targetLang: 'en',
  partialSource: '',
  partialTarget: '',
  rows: [],
  translationConnected: true,
  fallbackMode: false,
  error: null,
  pendingSourceByRow: {},
  pendingTargetByRow: {},
};

// ============================================================================
// Actions
// ============================================================================
export type TranslationAction =
  | { type: 'SET_LANG_PAIR'; sourceLang: string; targetLang: string }
  | { type: 'SOURCE_PARTIAL'; text: string }
  | { type: 'SOURCE_FINAL'; text: string; rowId: string }
  | { type: 'TARGET_PARTIAL'; text: string }
  | { type: 'TARGET_FINAL'; text: string; rowId: string; latencyMs: number }
  | { type: 'ALIGNED_ROW'; row: AlignedRow }
  | { type: 'CONNECTION_CHANGE'; connected: boolean }
  | { type: 'ERROR'; message: string }
  | { type: 'CLEAR' };

// ============================================================================
// Helpers
// ============================================================================
function appendRow(rows: AlignedRow[], row: AlignedRow): AlignedRow[] {
  // 顺序追加: 老 → 新 (时间正向), MAX_ROWS 截断最旧
  const next = [...rows, row];
  if (next.length > MAX_ROWS) {
    return next.slice(-MAX_ROWS);
  }
  return next;
}

function makeAlignedRow(
  rowId: string,
  source: string,
  target: string,
  latencyMs: number | null,
  timestamp: number,
): AlignedRow {
  return {
    id: rowId,
    source,
    target,
    timestamp,
    latencyMs,
  };
}

// ============================================================================
// Reducer
// ============================================================================
export function translationReducer(
  state: TranslationState,
  action: TranslationAction,
): TranslationState {
  switch (action.type) {
    case 'SET_LANG_PAIR': {
      // 语言切换: 清空所有 stream buffer / rows / pending, 避免错位
      if (state.sourceLang === action.sourceLang && state.targetLang === action.targetLang) {
        return state;
      }
      return {
        ...initialTranslationState,
        sourceLang: action.sourceLang,
        targetLang: action.targetLang,
        translationConnected: state.translationConnected,
        fallbackMode: state.fallbackMode,
      };
    }

    case 'SOURCE_PARTIAL': {
      return { ...state, partialSource: action.text };
    }

    case 'SOURCE_FINAL': {
      // source 先到: 暂存到 pendingSourceByRow, 等 target 到达合并
      const pendingTarget = state.pendingTargetByRow[action.rowId];
      if (pendingTarget) {
        // target 已先到, 现在合并
        const { [action.rowId]: _, ...rest } = state.pendingTargetByRow;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return {
          ...state,
          partialSource: '',
          rows: appendRow(
            state.rows,
            makeAlignedRow(action.rowId, action.text, pendingTarget.text, pendingTarget.latencyMs, now),
          ),
          pendingTargetByRow: rest,
        };
      }
      return {
        ...state,
        partialSource: '',
        pendingSourceByRow: {
          ...state.pendingSourceByRow,
          [action.rowId]: action.text,
        },
      };
    }

    case 'TARGET_PARTIAL': {
      return { ...state, partialTarget: action.text };
    }

    case 'TARGET_FINAL': {
      // target 到达: 检查 pendingSource 是否有同 rowId
      const pendingSource = state.pendingSourceByRow[action.rowId];
      if (pendingSource !== undefined) {
        const { [action.rowId]: _, ...rest } = state.pendingSourceByRow;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return {
          ...state,
          partialTarget: '',
          rows: appendRow(
            state.rows,
            makeAlignedRow(action.rowId, pendingSource, action.text, action.latencyMs, now),
          ),
          pendingSourceByRow: rest,
        };
      }
      // 没有 pending source, 暂存
      return {
        ...state,
        partialTarget: '',
        pendingTargetByRow: {
          ...state.pendingTargetByRow,
          [action.rowId]: { text: action.text, latencyMs: action.latencyMs },
        },
      };
    }

    case 'ALIGNED_ROW': {
      return {
        ...state,
        rows: appendRow(state.rows, action.row),
      };
    }

    case 'CONNECTION_CHANGE': {
      return {
        ...state,
        translationConnected: action.connected,
        fallbackMode: !action.connected,
      };
    }

    case 'ERROR': {
      return {
        ...state,
        error: action.message,
        fallbackMode: true,
      };
    }

    case 'CLEAR': {
      return {
        ...initialTranslationState,
        sourceLang: state.sourceLang,
        targetLang: state.targetLang,
        translationConnected: state.translationConnected,
      };
    }

    default:
      return state;
  }
}