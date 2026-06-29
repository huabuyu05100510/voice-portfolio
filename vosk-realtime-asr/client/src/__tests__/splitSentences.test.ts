/**
 * splitSentences 单元测试 — TDD Red→Green
 *
 * 锁定长句分行行为: 句末标点切分, 保留标点, 短句不切.
 *
 * Author: glm-5.2
 */
import { describe, it, expect } from 'vitest';
import { splitSentences } from '../utils/splitSentences';

describe('splitSentences / 长句按标点分行', () => {
  it('空字符串 → 空数组', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('无句末标点的短文本 → 单元素数组', () => {
    expect(splitSentences('你好我是王楚然')).toEqual(['你好我是王楚然']);
  });

  it('中文句号切分, 标点保留在句尾', () => {
    expect(splitSentences('你好。我是。王楚然。')).toEqual([
      '你好。',
      '我是。',
      '王楚然。',
    ]);
  });

  it('全角感叹号/问号也能切分', () => {
    expect(splitSentences('你好！是吗？真的。')).toEqual([
      '你好！',
      '是吗？',
      '真的。',
    ]);
  });

  it('半角标点 . ! ? 同样切分', () => {
    expect(splitSentences('Hello. World! Right?')).toEqual([
      'Hello.',
      'World!',
      'Right?',
    ]);
  });

  it('省略号 … 也能切分', () => {
    const out = splitSentences('我想想…对了…就这样');
    expect(out.length).toBe(3);
    expect(out[0]).toBe('我想想…');
    expect(out[1]).toBe('对了…');
    expect(out[2]).toBe('就这样');
  });

  it('连续标点不产生空句', () => {
    // 两个连续句号不应该切出空串
    const out = splitSentences('你好。。世界');
    expect(out.every((s) => s.length > 0)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it('真实长独白 (DIAG 实测样例) → 多行', () => {
    const monologue = '我可能会给他提一些建议。磨合是体现在各个方面的。你觉得呢？';
    const out = splitSentences(monologue);
    expect(out.length).toBe(3);
    expect(out[0]).toBe('我可能会给他提一些建议。');
    expect(out[1]).toBe('磨合是体现在各个方面的。');
    expect(out[2]).toBe('你觉得呢？');
  });

  it('拼接后等于原文 (无丢失/无重复)', () => {
    const text = '第一句。第二句！第三句？还有半句没标点';
    const out = splitSentences(text);
    // 至少所有非标点字符都应该在输出里
    const rejoined = out.join('');
    // 去掉所有空白后, 拼接应该覆盖原文所有非空白字符
    expect(rejoined.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
});
