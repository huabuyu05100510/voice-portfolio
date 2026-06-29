/**
 * designTokens.test.ts — Sprint 12 UI Redesign
 * 验证 design/tokens.ts 提供的 design system 契约:
 *  - 调色板 (surface / brand / speaker / status)
 *  - 字号阶梯 (type scale)
 *  - 间距 (spacing 4px base)
 *  - 圆角 (radius)
 *  - 阴影 (elevation)
 *  - 动效曲线 (motion)
 *  - 断点 (breakpoints 1440/1024/768/480)
 *  - 主题 (default = dark, light optional)
 *
 * 红: 此测试运行前 design/tokens.ts 不存在, 应 fail
 * 绿: 实现 tokens.ts 后通过
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const TOKENS_PATH = resolve(__dirname, '..', 'design', 'tokens.ts');
const ANIMATIONS_PATH = resolve(__dirname, '..', 'design', 'animations.ts');
const CSS_PATH = resolve(__dirname, '..', 'styles.css');

interface TokensModule {
  palette: {
    surface: Record<string, string>;
    text: Record<string, string>;
    brand: Record<string, string>;
    speaker: string[];
    status: Record<string, string>;
  };
  typography: {
    fontStack: string;
    fontMono: string;
    fontNumeric: string;
    size: Record<string, string>;
    leading: Record<string, string>;
    tracking: Record<string, string>;
  };
  spacing: Record<string, string>;
  radius: Record<string, string>;
  elevation: Record<string, string>;
  motion: {
    ease: Record<string, string>;
    duration: Record<string, string>;
  };
  breakpoints: Record<string, number>;
  defaultTheme: 'dark' | 'light';
  themes: Record<string, Record<string, string>>;
}

let tokens: TokensModule;

beforeAll(async () => {
  // 必须存在
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(`design/tokens.ts not found at ${TOKENS_PATH}`);
  }
  // 动态 import (Vitest 支持 TS, 但需要 .ts 解析)
  // 用 vitest 的 import.meta.glob 替代, 或直接 require
  const mod = await import('../design/tokens');
  tokens = mod as unknown as TokensModule;
});

describe('design/tokens.ts — Sprint 12 UI Redesign', () => {
  describe('调色板 (palette)', () => {
    it('surface 至少有 4 层 (bg-0..bg-3)', () => {
      expect(tokens.palette.surface).toBeDefined();
      expect(tokens.palette.surface['bg-0']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.surface['bg-1']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.surface['bg-2']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.surface['bg-3']).toMatch(/^#[0-9a-f]{3,8}$/i);
    });

    it('text 至少 4 级 (text-1..text-4)', () => {
      expect(tokens.palette.text).toBeDefined();
      expect(tokens.palette.text['text-1']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.text['text-2']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.text['text-3']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.text['text-4']).toMatch(/^#[0-9a-f]{3,8}$/i);
    });

    it('brand 至少 3 档 (brand-500/600/700)', () => {
      expect(tokens.palette.brand).toBeDefined();
      expect(tokens.palette.brand['brand-500']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.brand['brand-600']).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.brand['brand-700']).toMatch(/^#[0-9a-f]{3,8}$/i);
    });

    it('speaker 调色板 6 色 (对标行业)', () => {
      expect(tokens.palette.speaker).toBeDefined();
      expect(Array.isArray(tokens.palette.speaker)).toBe(true);
      expect(tokens.palette.speaker.length).toBeGreaterThanOrEqual(6);
      for (const c of tokens.palette.speaker) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('status 至少包含 success / warning / danger / info', () => {
      expect(tokens.palette.status).toBeDefined();
      expect(tokens.palette.status.success).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.status.warning).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.status.danger).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(tokens.palette.status.info).toMatch(/^#[0-9a-f]{3,8}$/i);
    });
  });

  describe('字体 (typography)', () => {
    it('fontStack 包含中文 + 英文 fallback', () => {
      expect(tokens.typography.fontStack).toBeDefined();
      // 必须包含至少一个西文字体 + 一个中文字体
      expect(tokens.typography.fontStack).toMatch(/Inter|Helvetica|SF|System/i);
      expect(tokens.typography.fontStack).toMatch(/PingFang|Hiragino|Microsoft YaHei|Noto Sans SC/i);
    });

    it('fontMono 与 fontNumeric 用于等宽数字', () => {
      expect(tokens.typography.fontMono).toMatch(/Mono|Menlo|Consolas/i);
      expect(tokens.typography.fontNumeric).toMatch(/Mono|Menlo|Consolas/i);
    });

    it('字号阶梯 10 级 (display-2xl ... micro)', () => {
      const required = [
        'display-2xl', 'display-xl', 'display-lg',
        'heading-lg', 'heading-md',
        'body-lg', 'body', 'body-sm', 'caption', 'micro',
      ];
      for (const s of required) {
        expect(tokens.typography.size[s], `--font-${s}`).toMatch(/^\d+(\.\d+)?(px|rem)$/);
      }
    });

    it('leading 与 tracking 至少各 3 档', () => {
      expect(Object.keys(tokens.typography.leading).length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(tokens.typography.tracking).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('间距 (spacing) — 4px base', () => {
    it('至少声明 space-1 ... space-20', () => {
      const required = ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8', 'space-10', 'space-12', 'space-16', 'space-20'];
      for (const s of required) {
        expect(tokens.spacing[s], `--${s}`).toMatch(/^\d+px$/);
      }
    });

    it('space-1 必须是 4px (base)', () => {
      expect(tokens.spacing['space-1']).toBe('4px');
    });
  });

  describe('圆角 (radius)', () => {
    it('至少 6 档 (xs/sm/md/lg/xl/pill)', () => {
      const required = ['radius-xs', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'radius-pill'];
      for (const r of required) {
        expect(tokens.radius[r], `--${r}`).toMatch(/^\d+px$/);
      }
    });
  });

  describe('阴影 (elevation)', () => {
    it('至少 4 档 (shadow-1/2/3/glow)', () => {
      expect(tokens.elevation['shadow-1']).toMatch(/rgba|0 1px/);
      expect(tokens.elevation['shadow-2']).toMatch(/rgba|0 4px/);
      expect(tokens.elevation['shadow-3']).toMatch(/rgba|0 10px/);
      expect(tokens.elevation['glow']).toBeDefined();
    });
  });

  describe('动效 (motion)', () => {
    it('ease 至少 3 种曲线 (out/in/spring)', () => {
      expect(tokens.motion.ease['ease-out']).toMatch(/cubic-bezier/);
      expect(tokens.motion.ease['ease-in']).toMatch(/cubic-bezier/);
      expect(tokens.motion.ease['ease-spring']).toMatch(/cubic-bezier/);
    });

    it('duration 至少 3 档 (fast/base/slow)', () => {
      expect(tokens.motion.duration['duration-fast']).toMatch(/^\d+ms$/);
      expect(tokens.motion.duration['duration-base']).toMatch(/^\d+ms$/);
      expect(tokens.motion.duration['duration-slow']).toMatch(/^\d+ms$/);
    });
  });

  describe('断点 (breakpoints) — 行业标准 4 档', () => {
    it('至少包含 1440 / 1024 / 768 / 480', () => {
      expect(tokens.breakpoints.desktop).toBe(1440);
      expect(tokens.breakpoints.tablet).toBe(1024);
      expect(tokens.breakpoints['tablet-sm']).toBe(768);
      expect(tokens.breakpoints.mobile).toBe(480);
    });
  });

  describe('主题 (themes)', () => {
    it('defaultTheme 必须是 dark (暗色默认)', () => {
      expect(tokens.defaultTheme).toBe('dark');
    });

    it('themes 至少包含 dark + light', () => {
      expect(tokens.themes.dark).toBeDefined();
      expect(tokens.themes.light).toBeDefined();
    });

    it('每个主题都包含完整 surface + text + brand + status', () => {
      for (const themeName of ['dark', 'light']) {
        const theme = tokens.themes[themeName];
        expect(theme, `${themeName}.bg-0`).toMatch(/--bg-0\s*:/);
        expect(theme, `${themeName}.bg-1`).toMatch(/--bg-1\s*:/);
        expect(theme, `${themeName}.text-1`).toMatch(/--text-1\s*:/);
        expect(theme, `${themeName}.brand-500`).toMatch(/--brand-500\s*:/);
      }
    });
  });
});

describe('design/animations.ts — 关键帧与缓动', () => {
  it('animations.ts 必须存在', () => {
    expect(existsSync(ANIMATIONS_PATH)).toBe(true);
  });

  it('导出关键帧: pulse / record / fadeIn / slideUp 至少各 1', async () => {
    const mod = await import('../design/animations');
    const anim = mod as unknown as Record<string, unknown>;
    const required = ['pulseStatus', 'recordPulse', 'fadeIn', 'slideUp'];
    for (const k of required) {
      expect(anim[k], `animations.${k}`).toBeDefined();
    }
  });
});

describe('styles.css — token 引用契约', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('CSS 必须引用 design tokens (var(--xxx) ≥ 50 处)', () => {
    const matches = css.match(/var\(--/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(50);
  });

  it('必须保留 :root[data-theme="dark"] / :root[data-theme="light"] 两套', () => {
    expect(css).toMatch(/\[data-theme="dark"\]/);
    expect(css).toMatch(/\[data-theme="light"\]/);
  });

  it('必须有 prefers-reduced-motion 减动效', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('1440 / 1024 / 768 三档断点都存在', () => {
    expect(css).toMatch(/@media[^{]*max-width:\s*1440px/);
    expect(css).toMatch(/@media[^{]*max-width:\s*1024px/);
    expect(css).toMatch(/@media[^{]*max-width:\s*768px/);
  });
});
