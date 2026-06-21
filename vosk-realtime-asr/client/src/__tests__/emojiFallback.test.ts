/**
 * emoji-fallback.test.ts — Sprint 8
 * 验证 Twemoji web 字体已在 index.html 中 preload
 * 解决 Linux server / 无头浏览器下 emoji 显示为方框的问题
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML_PATH = resolve(__dirname, '..', '..', 'index.html');

describe('Emoji 兜底字体 (Twemoji)', () => {
  const html = readFileSync(HTML_PATH, 'utf8');

  it('index.html 引用 Twemoji CDN', () => {
    // jsDelivr 上的 Twemoji 字体, 免费 MIT 协议
    expect(html).toMatch(/jspnp[0-9a-z./_-]*twemoji|cdn\.jsdelivr\.net\/.*twemoji/i);
  });

  it('Twemoji 在 font-face 中定义', () => {
    expect(html).toMatch(/@font-face[\s\S]*Twemoji/i);
  });

  it('font-stack 中包含 Twemoji Mozilla (作为额外兜底)', () => {
    expect(html).toMatch(/Twemoji Mozilla/);
  });
});