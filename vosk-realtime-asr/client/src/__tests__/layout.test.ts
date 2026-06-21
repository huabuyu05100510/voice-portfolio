/**
 * layout.test.ts — Sprint 8 布局回归测试
 * 验证主 grid 比例 + 响应式断点 + visualizer 折叠
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(__dirname, '..', 'styles.css');

describe('Sprint 8 布局', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('.app-main 使用 minmax 三栏约束 (防内容塌陷)', () => {
    expect(css).toMatch(/\.app-main[\s\S]*?grid-template-columns:\s*minmax/);
  });

  it('.app-main 有 1280px 断点 (两栏)', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*1280px\)[\s\S]*?\.app-main/);
  });

  it('.app-main 有 768px 断点 (单栏)', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.app-main/);
  });

  it('.visualizer-panel 支持折叠 (data-state)', () => {
    // 通过 .visualizer-panel[data-state="collapsed"] 控制折叠
    expect(css).toMatch(/\.visualizer-panel\[data-state=["']collapsed["']\]/);
  });

  it('.empty-state 包含 SVG 装饰元素样式', () => {
    expect(css).toMatch(/\.empty-state[\s\S]*?\.empty-orbit/);
    expect(css).toMatch(/\.orbit-core\s*\{[^}]*animation/);
  });
});