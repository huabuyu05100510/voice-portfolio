/**
 * font-stack 测试 — 验证 emoji 字体已在全局 CSS 声明
 * TDD: 这个测试先写, 期望失败 (emoji 字体未声明), 然后修 CSS 让它绿
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(__dirname, '..', 'styles.css');

describe('global font stack', () => {
  let css: string;
  beforeAll(() => {
    css = readFileSync(CSS_PATH, 'utf8');
  });

  it('declares --font-stack variable', () => {
    expect(css).toMatch(/--font-stack\s*:/);
  });

  it('declares at least one emoji-capable font in the stack', () => {
    // Apple Color Emoji (macOS/iOS), Segoe UI Emoji (Windows),
    // Noto Color Emoji (Linux/Android), Twemoji Mozilla (Linux fallback)
    const emojiFonts = [
      'Apple Color Emoji',
      'Segoe UI Emoji',
      'Noto Color Emoji',
      'Twemoji Mozilla',
    ];
    const found = emojiFonts.some((f) => css.includes(f));
    expect(found, `expected one of ${emojiFonts.join(', ')} in styles.css`).toBe(true);
  });

  it('includes CJK fallback fonts for Chinese characters', () => {
    expect(css).toMatch(/PingFang SC|Microsoft YaHei|Noto Sans CJK|Hiragino Sans/);
  });

  it('uses --font-stack on body / root', () => {
    expect(css).toMatch(/font-family\s*:\s*var\(--font-stack\)/);
  });
});