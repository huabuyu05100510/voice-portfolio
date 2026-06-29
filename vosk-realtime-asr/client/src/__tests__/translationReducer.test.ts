/**
 * TDD: translationReducer 全 action 覆盖
 *
 * 覆盖 actions:
 *   - SET_LANG_PAIR       切换语言对
 *   - SOURCE_PARTIAL      partial 源文本
 *   - SOURCE_FINAL        final 源文本 (与某行 target 对齐)
 *   - TARGET_PARTIAL      partial 翻译结果
 *   - TARGET_FINAL        final 翻译结果
 *   - ALIGNED_ROW         source+target 同步显示 (Netflix 风格对齐)
 *   - CONNECTION_CHANGE   网络状态 (down/up/fallback)
 *   - ERROR               错误 (降级到仅 source)
 *   - CLEAR               清空
 *
 * Author: MiniMax-M3
 */
import { describe, it, expect } from 'vitest';
import {
  translationReducer,
  initialTranslationState,
  SUPPORTED_LANG_PAIRS,
  type TranslationState,
} from '../state/translationReducer';

// ----------------------------------------------------------------------------
// SET_LANG_PAIR
// ----------------------------------------------------------------------------
describe('translationReducer / SET_LANG_PAIR', () => {
  it('设置 source 和 target 语言, 默认 source=zh / target=en', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'SET_LANG_PAIR',
      sourceLang: 'zh',
      targetLang: 'en',
    });
    expect(s1.sourceLang).toBe('zh');
    expect(s1.targetLang).toBe('en');
  });

  it('语言切换时清空 stream buffer (避免错位)', () => {
    const s0: TranslationState = {
      ...initialTranslationState,
      partialSource: '你好世界',
      partialTarget: 'Hello world',
    };
    const s1 = translationReducer(s0, {
      type: 'SET_LANG_PAIR',
      sourceLang: 'en',
      targetLang: 'ja',
    });
    expect(s1.partialSource).toBe('');
    expect(s1.partialTarget).toBe('');
  });
});

// ----------------------------------------------------------------------------
// SOURCE_PARTIAL / TARGET_PARTIAL
// ----------------------------------------------------------------------------
describe('translationReducer / SOURCE_PARTIAL', () => {
  it('更新 partialSource, 不影响 rows', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'SOURCE_PARTIAL',
      text: '你好',
    });
    expect(s1.partialSource).toBe('你好');
    expect(s1.rows).toEqual([]);
  });
});

describe('translationReducer / TARGET_PARTIAL', () => {
  it('更新 partialTarget, 不影响 rows', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'TARGET_PARTIAL',
      text: 'Hello',
    });
    expect(s1.partialTarget).toBe('Hello');
    expect(s1.rows).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// SOURCE_FINAL / TARGET_FINAL
// ----------------------------------------------------------------------------
describe('translationReducer / SOURCE_FINAL', () => {
  it('清空 partialSource 并记入 sourceText 队列', () => {
    const s0: TranslationState = {
      ...initialTranslationState,
      partialSource: '你好',
    };
    const s1 = translationReducer(s0, {
      type: 'SOURCE_FINAL',
      text: '你好世界',
      rowId: 'row1',
    });
    expect(s1.partialSource).toBe('');
    expect(s1.pendingSourceByRow.row1).toBe('你好世界');
  });
});

describe('translationReducer / TARGET_FINAL', () => {
  it('当 rowId 已在 pendingSourceByRow, 创建对齐 row, 移除 pending', () => {
    const s0: TranslationState = {
      ...initialTranslationState,
      pendingSourceByRow: { row1: '你好' },
    };
    const s1 = translationReducer(s0, {
      type: 'TARGET_FINAL',
      text: 'Hello',
      rowId: 'row1',
      latencyMs: 120,
    });
    expect(s1.rows).toHaveLength(1);
    expect(s1.rows[0].source).toBe('你好');
    expect(s1.rows[0].target).toBe('Hello');
    expect(s1.rows[0].latencyMs).toBe(120);
    expect(s1.rows[0].id).toBe('row1');
    expect(s1.pendingSourceByRow.row1).toBeUndefined();
    expect(s1.partialTarget).toBe('');
  });

  it('rowId 不在 pendingSource, 暂存到 pendingTargetByRow (等 source 到达)', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'TARGET_FINAL',
      text: 'Hello',
      rowId: 'row1',
      latencyMs: 100,
    });
    expect(s1.rows).toHaveLength(0);
    expect(s1.pendingTargetByRow.row1).toEqual({
      text: 'Hello',
      latencyMs: 100,
    });
  });

  it('重复 rowId (source 先到) 后 target 到达应触发对齐', () => {
    let s = translationReducer(initialTranslationState, {
      type: 'SOURCE_FINAL',
      text: '你好',
      rowId: 'row1',
    });
    s = translationReducer(s, {
      type: 'TARGET_FINAL',
      text: 'Hello',
      rowId: 'row1',
      latencyMs: 100,
    });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].source).toBe('你好');
    expect(s.rows[0].target).toBe('Hello');
  });
});

// ----------------------------------------------------------------------------
// ALIGNED_ROW (manual / 主动对齐, 用于 cached 翻译后到)
// ----------------------------------------------------------------------------
describe('translationReducer / ALIGNED_ROW', () => {
  it('直接追加一行已对齐的字幕', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'ALIGNED_ROW',
      row: { id: 'r1', source: '你好', target: 'Hello', timestamp: 100, latencyMs: 100 },
    });
    expect(s1.rows).toHaveLength(1);
    expect(s1.rows[0].source).toBe('你好');
    expect(s1.rows[0].target).toBe('Hello');
  });

  it('超过 MAX_ROWS 时截断最旧 (FIFO, 类似 transcriptionReducer)', () => {
    let s = initialTranslationState;
    for (let i = 0; i < 250; i++) {
      s = translationReducer(s, {
        type: 'ALIGNED_ROW',
        row: { id: `r${i}`, source: `s${i}`, target: `t${i}`, timestamp: i, latencyMs: 100 },
      });
    }
    expect(s.rows.length).toBeLessThanOrEqual(200);
    expect(s.rows[s.rows.length - 1].source).toBe('s249');
  });
});

// ----------------------------------------------------------------------------
// CONNECTION_CHANGE
// ----------------------------------------------------------------------------
describe('translationReducer / CONNECTION_CHANGE', () => {
  it('disconnected 时标记 fallback 模式', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'CONNECTION_CHANGE',
      connected: false,
    });
    expect(s1.translationConnected).toBe(false);
    expect(s1.fallbackMode).toBe(true);
  });

  it('connected 时退出 fallback', () => {
    const s0: TranslationState = {
      ...initialTranslationState,
      translationConnected: false,
      fallbackMode: true,
    };
    const s1 = translationReducer(s0, {
      type: 'CONNECTION_CHANGE',
      connected: true,
    });
    expect(s1.translationConnected).toBe(true);
    expect(s1.fallbackMode).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// ERROR
// ----------------------------------------------------------------------------
describe('translationReducer / ERROR', () => {
  it('记录错误, 自动 fallback 到 source-only 模式', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'ERROR',
      message: 'API down',
    });
    expect(s1.error).toBe('API down');
    expect(s1.fallbackMode).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// CLEAR
// ----------------------------------------------------------------------------
describe('translationReducer / CLEAR', () => {
  it('清空 rows, partial*, pending*, 但保留语言对', () => {
    let s: TranslationState = {
      ...initialTranslationState,
      sourceLang: 'ja',
      targetLang: 'en',
      rows: [
        { id: 'r1', source: '古い', target: 'old', timestamp: 1, latencyMs: 100 },
      ],
      partialSource: '你好',
      partialTarget: 'Hello',
      pendingSourceByRow: { foo: 'bar' },
    };
    s = translationReducer(s, { type: 'CLEAR' });
    expect(s.rows).toEqual([]);
    expect(s.partialSource).toBe('');
    expect(s.partialTarget).toBe('');
    expect(s.pendingSourceByRow).toEqual({});
    expect(s.sourceLang).toBe('ja');  // 保留
    expect(s.targetLang).toBe('en');
  });
});

// ----------------------------------------------------------------------------
// pure function / 不可变性
// ----------------------------------------------------------------------------
describe('translationReducer / purity', () => {
  it('不修改入参 state', () => {
    const s0: TranslationState = {
      ...initialTranslationState,
      rows: [{ id: 'r1', source: 'a', target: 'b', timestamp: 1, latencyMs: 100 }],
    };
    const snapshot = JSON.stringify(s0);
    translationReducer(s0, { type: 'CLEAR' });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('每次 action 返回新对象 (引用不同)', () => {
    const s1 = translationReducer(initialTranslationState, {
      type: 'SOURCE_PARTIAL',
      text: 'x',
    });
    expect(s1).not.toBe(initialTranslationState);
  });
});

// ----------------------------------------------------------------------------
// 语言对预设
// ----------------------------------------------------------------------------
describe('translationReducer / LANGUAGE_PRESETS', () => {
  it('SUPPORTED_LANG_PAIRS 应包含 zh-en', () => {
    const found = SUPPORTED_LANG_PAIRS.some((p) => p.source === 'zh' && p.target === 'en');
    expect(found).toBe(true);
  });
  it('SUPPORTED_LANG_PAIRS 应至少 4 对 (zh↔en / zh↔ja / zh↔ko / en↔ja)', () => {
    expect(SUPPORTED_LANG_PAIRS.length).toBeGreaterThanOrEqual(4);
  });
});