/**
 * design-system.test.ts — Sprint 9
 * 验证设计 token 已完整声明 (颜色 / 字号 / 间距 / 圆角 / 阴影 / 动效曲线)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(__dirname, '..', 'styles.css');

describe('Sprint 9 设计系统 token', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('声明 surface layer 颜色 (bg-0/1/2/3)', () => {
    expect(css).toMatch(/--bg-0\s*:/);
    expect(css).toMatch(/--bg-1\s*:/);
    expect(css).toMatch(/--bg-2\s*:/);
    expect(css).toMatch(/--bg-3\s*:/);
  });

  it('声明品牌色 brand-500/600/700', () => {
    expect(css).toMatch(/--brand-500\s*:/);
    expect(css).toMatch(/--brand-600\s*:/);
    expect(css).toMatch(/--brand-700\s*:/);
  });

  it('声明说话人调色板 (spk-1..spk-6)', () => {
    for (let i = 1; i <= 6; i++) {
      expect(css, `--spk-${i}`).toMatch(new RegExp(`--spk-${i}\\s*:`));
    }
  });

  it('声明字号阶梯 (font-display-2xl ... font-micro)', () => {
    const sizes = ['display-2xl', 'display-xl', 'display-lg', 'heading-lg',
                   'heading-md', 'body-lg', 'body', 'body-sm', 'caption', 'micro'];
    for (const s of sizes) {
      expect(css, `--font-${s}`).toMatch(new RegExp(`--font-${s}\\s*:`));
    }
  });

  it('声明间距体系 (space-1 ... space-12)', () => {
    const spaces = ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8', 'space-10', 'space-12'];
    for (const s of spaces) {
      expect(css, `--${s}`).toMatch(new RegExp(`--${s}\\s*:`));
    }
  });

  it('声明圆角体系 (radius-xs ... radius-pill)', () => {
    const rs = ['radius-xs', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'radius-pill'];
    for (const r of rs) {
      expect(css, `--${r}`).toMatch(new RegExp(`--${r}\\s*:`));
    }
  });

  it('声明阴影体系 (shadow-1/2/3/glow)', () => {
    expect(css).toMatch(/--shadow-1\s*:/);
    expect(css).toMatch(/--shadow-2\s*:/);
    expect(css).toMatch(/--shadow-3\s*:/);
    expect(css).toMatch(/--glow\s*:/);
  });

  it('声明动效曲线 (ease-out/in/spring) 与 duration', () => {
    expect(css).toMatch(/--ease-out\s*:/);
    expect(css).toMatch(/--ease-in\s*:/);
    expect(css).toMatch(/--ease-spring\s*:/);
    expect(css).toMatch(/--duration-fast\s*:/);
    expect(css).toMatch(/--duration-base\s*:/);
    expect(css).toMatch(/--duration-slow\s*:/);
  });

  it('Workbench 布局: .app-shell 使用 grid 模板', () => {
    expect(css).toMatch(/\.app-shell[\s\S]*?grid-template/);
  });

  it('Hero transcript 区域有 display-2xl 字号应用', () => {
    // 应有 .transcript-hero 或类似选择器使用 font-display-2xl
    expect(css).toMatch(/var\(--font-display-2xl\)/);
  });
});