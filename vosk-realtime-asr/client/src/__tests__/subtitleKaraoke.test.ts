/**
 * 卡拉OK 字幕 — 词级高亮 单元测试
 *
 * 验收:
 * - findActiveWordIndex: 二分查找, 给定 elapsedSec 返回正确高亮索引
 * - computeWordProgress: 当前词内 0..1 进度
 * - chunkWordsIntoLines: 行切分
 *
 * 这是 Subtitle.tsx 的核心逻辑, 用纯函数抽出来便于测试
 */
import { describe, it, expect } from 'vitest';
import {
  findActiveWordIndex,
  computeWordProgress,
  chunkWordsIntoLines,
} from '../subtitleKaraoke';
import type { WordInfo } from '../types';

// 6 个词的中文句子, 每词约 0.5s
const sample: WordInfo[] = [
  { word: '你', start: 0.0, end: 0.5, confidence: 0.9 },
  { word: '好', start: 0.5, end: 1.0, confidence: 0.9 },
  { word: '世', start: 1.0, end: 1.5, confidence: 0.9 },
  { word: '界', start: 1.5, end: 2.0, confidence: 0.9 },
  { word: '欢', start: 2.0, end: 2.5, confidence: 0.9 },
  { word: '迎', start: 2.5, end: 3.0, confidence: 0.9 },
];

describe('findActiveWordIndex — 词级卡拉OK 索引', () => {
  it('t < 第一个词 start 时返回 -1', () => {
    expect(findActiveWordIndex(sample, -0.5)).toBe(-1);
    expect(findActiveWordIndex(sample, 0)).toBe(0);   // start=0 边界算"已开始"
  });

  it('t 落在第 i 个词区间内时返回 i', () => {
    expect(findActiveWordIndex(sample, 0.1)).toBe(0);  // 在"你"中
    expect(findActiveWordIndex(sample, 0.4)).toBe(0);  // "你" 末
    expect(findActiveWordIndex(sample, 0.5)).toBe(1);  // "好" 起点
    expect(findActiveWordIndex(sample, 1.25)).toBe(2); // "世" 中
    expect(findActiveWordIndex(sample, 2.99)).toBe(5); // "迎" 末
  });

  it('t 超过最后一个词 end 时返回最后一个索引', () => {
    expect(findActiveWordIndex(sample, 3.5)).toBe(5);
    expect(findActiveWordIndex(sample, 100)).toBe(5);
  });

  it('空 words 返回 -1', () => {
    expect(findActiveWordIndex([], 1.0)).toBe(-1);
    expect(findActiveWordIndex(undefined as any, 1.0)).toBe(-1);
  });

  it('单元素 words', () => {
    const single: WordInfo[] = [{ word: '孤', start: 1.0, end: 2.0, confidence: 0.5 }];
    expect(findActiveWordIndex(single, 0.5)).toBe(-1);
    expect(findActiveWordIndex(single, 1.5)).toBe(0);
    expect(findActiveWordIndex(single, 2.5)).toBe(0);
  });

  it('大量词 (100) 的二分查找 O(log n)', () => {
    const big: WordInfo[] = Array.from({ length: 100 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.1,
      end: (i + 1) * 0.1,
      confidence: 0.9,
    }));
    // 中间值
    expect(findActiveWordIndex(big, 5.05)).toBe(50);
    // 起始边界
    expect(findActiveWordIndex(big, 0.05)).toBe(0);
    // 结尾边界
    expect(findActiveWordIndex(big, 9.95)).toBe(99);
  });

  it('词之间有空隙时 (Vosk 实际常出现), 落在空隙也算高亮前一个', () => {
    const withGaps: WordInfo[] = [
      { word: 'A', start: 0.0, end: 0.3, confidence: 0.9 },
      { word: 'B', start: 0.5, end: 0.8, confidence: 0.9 },  // 0.3-0.5 是空隙
      { word: 'C', start: 1.0, end: 1.3, confidence: 0.9 },
    ];
    expect(findActiveWordIndex(withGaps, 0.4)).toBe(0);  // 空隙, 还算 A
    expect(findActiveWordIndex(withGaps, 0.6)).toBe(1);
  });
});

describe('computeWordProgress — 当前词内 0..1 进度', () => {
  it('词内 50% 位置进度 = 0.5', () => {
    const w = sample[2]; // 1.0 - 1.5
    expect(computeWordProgress(w, 1.25)).toBeCloseTo(0.5, 2);
  });

  it('词起点进度 = 0', () => {
    expect(computeWordProgress(sample[0], 0.0)).toBe(0);
  });

  it('词末进度 = 1', () => {
    expect(computeWordProgress(sample[0], 0.5)).toBe(1);
  });

  it('超过 end 时 clamp 到 1', () => {
    expect(computeWordProgress(sample[0], 5.0)).toBe(1);
  });

  it('未到 start 时 clamp 到 0', () => {
    expect(computeWordProgress(sample[2], 0.5)).toBe(0);
  });

  it('word=undefined 返回 0', () => {
    expect(computeWordProgress(undefined, 1.0)).toBe(0);
  });

  it('start==end (零时长词) 不除零', () => {
    const zero: WordInfo = { word: 'z', start: 1.0, end: 1.0, confidence: 0.5 };
    // t < start: 0
    expect(computeWordProgress(zero, 0.5)).toBe(0);
    // t > end: 1
    expect(computeWordProgress(zero, 1.5)).toBe(1);
  });
});

describe('chunkWordsIntoLines — 行切分', () => {
  it('空数组返回空', () => {
    expect(chunkWordsIntoLines([])).toEqual([]);
  });

  it('6 个词按 2/行 切 3 行', () => {
    const lines = chunkWordsIntoLines(sample, 2);
    expect(lines.length).toBe(3);
    expect(lines[0].map(w => w.word)).toEqual(['你', '好']);
    expect(lines[1].map(w => w.word)).toEqual(['世', '界']);
    expect(lines[2].map(w => w.word)).toEqual(['欢', '迎']);
  });

  it('7 个词按 3/行 切 3 行 (最后一行 1 个)', () => {
    const seven: WordInfo[] = [...sample, { word: '啊', start: 3.0, end: 3.5, confidence: 0.5 }];
    const lines = chunkWordsIntoLines(seven, 3);
    expect(lines.length).toBe(3);
    expect(lines[2]).toHaveLength(1);
    expect(lines[2][0].word).toBe('啊');
  });

  it('默认每行 6 个', () => {
    const big: WordInfo[] = Array.from({ length: 13 }, (_, i) => ({
      word: `w${i}`, start: i * 0.1, end: (i + 1) * 0.1, confidence: 0.9,
    }));
    const lines = chunkWordsIntoLines(big);
    expect(lines.length).toBe(3); // 6 + 6 + 1
    expect(lines[0]).toHaveLength(6);
    expect(lines[1]).toHaveLength(6);
    expect(lines[2]).toHaveLength(1);
  });
});

describe('集成场景 — 模拟一次 final 段', () => {
  it('从 0 到 3.5s 持续高亮, 索引单调递增', () => {
    const seen: number[] = [];
    for (let t = 0; t <= 3.5; t += 0.1) {
      const idx = findActiveWordIndex(sample, t);
      seen.push(idx);
    }
    // 第一次应 >= 0
    expect(seen[0]).toBe(0);
    // 最后应等于 sample.length - 1
    expect(seen[seen.length - 1]).toBe(5);
    // 索引应该单调不减
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });
});
