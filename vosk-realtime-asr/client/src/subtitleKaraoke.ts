/**
 * 卡拉OK 字幕 — 纯函数工具
 * 抽离出来便于单元测试
 */
import type { WordInfo } from './types';

/**
 * 根据当前播放时间, 用二分查找返回应该高亮的词索引
 * - 找到第一个 start > t 的位置, 它的前一个就是当前高亮词
 * - 没找到 (整段还没开始) 返回 -1
 * - 所有词都已结束返回 words.length - 1
 *
 * @param words 词级时间戳数组
 * @param elapsedSec 当前播放时间 (秒, 相对段起点)
 */
export function findActiveWordIndex(words: WordInfo[], elapsedSec: number): number {
  if (!words || words.length === 0) return -1;
  if (elapsedSec < words[0].start) return -1;

  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid].start <= elapsedSec) lo = mid + 1;
    else hi = mid;
  }
  // lo 是第一个 start > t 的位置, 当前高亮 = lo - 1
  const idx = lo - 1;
  // clamp 到合法范围
  if (idx < 0) return -1;
  if (idx >= words.length) return words.length - 1;
  return idx;
}

/**
 * 计算当前词内的进度 (0..1)
 * - 没有当前词返回 0
 * - 已经超过当前词 end 返回 1
 */
export function computeWordProgress(word: WordInfo | undefined, elapsedSec: number): number {
  if (!word) return 0;
  const dur = Math.max(0.001, word.end - word.start);
  const within = (elapsedSec - word.start) / dur;
  return Math.max(0, Math.min(1, within));
}

/**
 * 把 words 数组按每行 N 个切成多行
 * 用于字幕的换行
 */
export function chunkWordsIntoLines(words: WordInfo[], wordsPerLine: number = 6): WordInfo[][] {
  if (!words || words.length === 0) return [];
  const out: WordInfo[][] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    out.push(words.slice(i, i + wordsPerLine));
  }
  return out;
}
