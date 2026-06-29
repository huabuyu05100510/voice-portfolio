/**
 * design/tokens.ts — Sprint 12 UI Redesign
 *
 * Design tokens 是 UI 系统的"宪法":
 *  - 颜色 / 字号 / 间距 / 圆角 / 阴影 / 动效曲线 / 断点 / 主题
 *  - TypeScript 单一来源, CSS 通过 styles.css 中的 :root vars 消费
 *  - 默认主题 = dark (对标 Otter / Fireflies / 飞书妙记 / 豆包 等产品)
 *  - 浅色主题作为可选 (用户偏好)
 *
 * 设计哲学 (竞品调研 2025-2026):
 *  - 暗色画布 + 高对比文字 = 长会议不疲劳
 *  - 单一品牌色高亮 = 焦点集中 (录音状态)
 *  - 6 色说话人调色板 = 会议场景够用
 *  - 玻璃拟态 (backdrop-filter) = 浮动层主流
 *  - 大圆录音按钮 = 行业标配 (Apple Live Captions / Granola)
 *
 * Author: MiniMax-M3
 */

/* eslint-disable @typescript-eslint/no-magic-numbers */

/* ============================================================================
 * 1. 调色板 (Palette)
 * ========================================================================== */

/**
 * Surface — 5 层画布, 每层对比递增
 *  - bg-0: 整体画布 (最深)
 *  - bg-1: 卡片表面
 *  - bg-2: 浮层 / 浮起元素
 *  - bg-3: 凹陷 / 输入框
 *  - overlay: 半透明遮罩 (用于毛玻璃)
 */
export const palette = {
  surface: {
    'bg-0': '#0a0a14',         // canvas (最深)
    'bg-1': '#13131f',         // surface (卡片)
    'bg-2': '#1d1d2e',         // elevated (浮起)
    'bg-3': '#050510',         // sunken (凹陷)
    'bg-overlay': 'rgba(10, 10, 20, 0.72)',
  },

  /**
   * Text — 4 级对比, WCAG AA 起步
   *  - text-1: 最高对比 (主标题 / 重点数字)
   *  - text-2: 正文
   *  - text-3: 辅助
   *  - text-4: 占位 / disabled
   */
  text: {
    'text-1': '#f5f5f7',
    'text-2': '#c5c5d0',
    'text-3': '#8b8b99',
    'text-4': '#5a5a68',
    'text-on-brand': '#0a0a14',
  },

  /**
   * Brand — 单一品牌色 (青)
   *  对标行业: Granola 用淡紫, Otter 用品牌蓝, 飞书用蓝绿
   *  选青色: 实时性 / 科技感 / 中性百搭
   */
  brand: {
    'brand-50': 'rgba(0, 212, 255, 0.08)',
    'brand-100': 'rgba(0, 212, 255, 0.16)',
    'brand-300': 'rgba(0, 212, 255, 0.48)',
    'brand-500': '#00d4ff',
    'brand-600': '#00a8cc',
    'brand-700': '#007a99',
  },

  /**
   * Speaker — 6 色调色板, 按 speaker index 循环
   *  对标 Granola / Otter / 飞书妙记 (6 色足够覆盖多数会议)
   *  选色原则:
   *   - 饱和度中等 (避免刺眼)
   *   - 明度接近 (深色背景下都不偏暗)
   *   - 色相均匀分布 (避免相邻两人难区分)
   */
  speaker: [
    '#f97316', // spk-1 橙
    '#06b6d4', // spk-2 青
    '#a855f7', // spk-3 紫
    '#10b981', // spk-4 绿
    '#f59e0b', // spk-5 琥珀
    '#ec4899', // spk-6 粉
  ],

  /**
   * Status — 语义色 (成功 / 警告 / 危险 / 信息)
   */
  status: {
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
    recording: '#ef4444', // 录音中专用红
  },
} as const;

/* ============================================================================
 * 2. 字体 (Typography)
 * ========================================================================== */

/**
 * 字体栈 — 西文优先 + 中文 fallback + emoji 兜底
 *  Sprint 9 emoji 修复: 必须包含彩色 emoji fallback, 否则 Windows / Linux 显示为空
 */
export const typography = {
  fontStack:
    "'Inter', 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', " +
    "'Microsoft YaHei', 'Noto Sans SC', system-ui, -apple-system, " +
    "BlinkMacSystemFont, 'Segoe UI', Roboto, " +
    "'Apple Color Emoji', 'Segoe UI Emoji', " +
    "'Noto Color Emoji', 'Twemoji Mozilla', 'EmojiOne Color', sans-serif",
  fontMono:
    "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, " +
    "'PingFang SC', 'Microsoft YaHei', monospace",
  fontNumeric:
    "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace",

  /**
   * 字号阶梯 — Major Third 1.25
   *  display: Hero / 营销级 (转写主标题)
   *  heading: 章节 / 卡片标题
   *  body: 正文
   *  caption: 辅助
   *  micro: 徽章 / 标签
   */
  size: {
    'display-2xl': '56px', // Hero 巨标题
    'display-xl': '40px',
    'display-lg': '32px',
    'heading-lg': '22px',
    'heading-md': '18px',
    'body-lg': '16px',
    body: '14px',
    'body-sm': '13px',
    caption: '12px',
    micro: '11px',
  },

  /** 行高 (line-height) — 倍数 */
  leading: {
    tight: '1.15',
    snug: '1.3',
    normal: '1.5',
    relaxed: '1.7',
  },

  /** 字间距 (letter-spacing) */
  tracking: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.04em',
  },
} as const;

/* ============================================================================
 * 3. 间距 (Spacing) — 4px base
 * ========================================================================== */

/**
 * 4px 为基准单位的等比数列, 与 Material Design / Tailwind 对齐
 * 常用: 4/8/12/16/20/24/32/40/48/64/80
 */
export const spacing = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'space-10': '40px',
  'space-12': '48px',
  'space-16': '64px',
  'space-20': '80px',
} as const;

/* ============================================================================
 * 4. 圆角 (Radius)
 * ========================================================================== */

/**
 * 圆角阶梯
 *  - xs/sm: 小元素 (chip / tag)
 *  - md: 默认卡片
 *  - lg/xl: 大容器 / 模态
 *  - pill: 完全圆角 (徽章)
 *  - circle: 大圆按钮 (录音按钮)
 */
export const radius = {
  'radius-xs': '4px',
  'radius-sm': '6px',
  'radius-md': '10px',
  'radius-lg': '14px',
  'radius-xl': '20px',
  'radius-2xl': '28px',
  'radius-pill': '9999px',
  'radius-circle': '50%',
} as const;

/* ============================================================================
 * 5. 阴影 (Elevation)
 * ========================================================================== */

/**
 * 阴影阶梯 — 5 档
 *  - shadow-1: 静止 (resting)
 *  - shadow-2: 悬停 (hover)
 *  - shadow-3: 浮起 (modal)
 *  - glow: 焦点光晕 (focus ring)
 *  - glow-danger: 危险状态焦点
 *  - inset: 内阴影 (输入框)
 */
export const elevation = {
  'shadow-1': '0 1px 2px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12)',
  'shadow-2': '0 4px 6px rgba(0, 0, 0, 0.16), 0 10px 15px rgba(0, 0, 0, 0.18)',
  'shadow-3': '0 10px 20px rgba(0, 0, 0, 0.22), 0 20px 40px rgba(0, 0, 0, 0.26)',
  'glow': '0 0 0 1px rgba(0, 212, 255, 0.48), 0 0 24px rgba(0, 212, 255, 0.32)',
  'glow-danger': '0 0 0 1px rgba(239, 68, 68, 0.48), 0 0 24px rgba(239, 68, 68, 0.32)',
  'inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
} as const;

/* ============================================================================
 * 6. 动效 (Motion)
 * ========================================================================== */

/**
 * 缓动曲线 — 来自 Apple HIG / Material Motion
 *  - ease-out: 进入 (物体飞入屏幕)
 *  - ease-in: 退出 (物体飞出屏幕)
 *  - ease-in-out: 状态切换
 *  - ease-spring: 弹性 (按钮按压 / 录音开始)
 */
export const motion = {
  ease: {
    'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
    'ease-in': 'cubic-bezier(0.7, 0, 0.84, 0)',
    'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
    'ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },

  /** 时长 (毫秒) */
  duration: {
    'duration-fast': '120ms',
    'duration-base': '200ms',
    'duration-slow': '320ms',
    'duration-slower': '480ms',
  },
} as const;

/* ============================================================================
 * 7. 断点 (Breakpoints) — 行业标准 4 档
 * ========================================================================== */

/**
 * 断点 — 对标 Tailwind / Material Design
 *  - desktop:    ≥ 1440px  — 大屏三栏
 *  - tablet:     ≥ 1024px  — 中屏二栏
 *  - tablet-sm:  ≥ 768px   — 小屏单栏
 *  - mobile:     < 768px   — 移动单栏
 */
export const breakpoints = {
  desktop: 1440,
  tablet: 1024,
  'tablet-sm': 768,
  mobile: 480,
} as const;

/* ============================================================================
 * 8. 主题 (Themes)
 * ========================================================================== */

/**
 * 暗色主题 — 默认
 *  对标 Otter / Fireflies / Granola / 飞书妙记
 */
const darkTheme = `
  --bg-0: ${palette.surface['bg-0']};
  --bg-1: ${palette.surface['bg-1']};
  --bg-2: ${palette.surface['bg-2']};
  --bg-3: ${palette.surface['bg-3']};
  --bg-overlay: ${palette.surface['bg-overlay']};

  --border-1: rgba(255, 255, 255, 0.08);
  --border-2: rgba(255, 255, 255, 0.16);
  --border-3: rgba(255, 255, 255, 0.28);

  --text-1: ${palette.text['text-1']};
  --text-2: ${palette.text['text-2']};
  --text-3: ${palette.text['text-3']};
  --text-4: ${palette.text['text-4']};
  --text-on-brand: ${palette.text['text-on-brand']};

  --brand-50: ${palette.brand['brand-50']};
  --brand-100: ${palette.brand['brand-100']};
  --brand-300: ${palette.brand['brand-300']};
  --brand-500: ${palette.brand['brand-500']};
  --brand-600: ${palette.brand['brand-600']};
  --brand-700: ${palette.brand['brand-700']};

  --success-500: ${palette.status.success};
  --warning-500: ${palette.status.warning};
  --danger-500:  ${palette.status.danger};
  --info-500:    ${palette.status.info};
  --recording:   ${palette.status.recording};

  --spk-1: ${palette.speaker[0]};
  --spk-2: ${palette.speaker[1]};
  --spk-3: ${palette.speaker[2]};
  --spk-4: ${palette.speaker[3]};
  --spk-5: ${palette.speaker[4]};
  --spk-6: ${palette.speaker[5]};
`.trim();

/**
 * 亮色主题 — 可选 (用户偏好)
 *  对标 Apple Live Captions 浅色 / Notion 浅色
 */
const lightTheme = `
  --bg-0: #f5f5f7;
  --bg-1: #ffffff;
  --bg-2: #fafafa;
  --bg-3: #ececef;
  --bg-overlay: rgba(255, 255, 255, 0.84);

  --border-1: rgba(0, 0, 0, 0.08);
  --border-2: rgba(0, 0, 0, 0.16);
  --border-3: rgba(0, 0, 0, 0.28);

  --text-1: #1a1a1f;
  --text-2: #3f3f46;
  --text-3: #71717a;
  --text-4: #a1a1aa;
  --text-on-brand: #ffffff;

  --brand-50:  rgba(0, 102, 204, 0.08);
  --brand-100: rgba(0, 102, 204, 0.16);
  --brand-300: rgba(0, 102, 204, 0.48);
  --brand-500: #0066cc;
  --brand-600: #0052a3;
  --brand-700: #003d7a;

  --success-500: #059669;
  --warning-500: #d97706;
  --danger-500:  #dc2626;
  --info-500:    #2563eb;
  --recording:   #dc2626;

  --spk-1: #ea580c;
  --spk-2: #0891b2;
  --spk-3: #9333ea;
  --spk-4: #059669;
  --spk-5: #d97706;
  --spk-6: #db2777;
`.trim();

/**
 * High-contrast 主题 — WCAG AAA 7:1
 *  保留 Sprint 9 实现 (无障碍兜底)
 */
const hcTheme = `
  --bg-0: #000000;
  --bg-1: #0a0a0a;
  --bg-2: #141414;
  --text-1: #ffffff;
  --text-2: #cccccc;
  --brand-500: #00ffff;
  --success-500: #00ff00;
  --warning-500: #ffff00;
  --danger-500: #ff5555;
`.trim();

/* ============================================================================
 * 9. 导出
 * ========================================================================== */

export const defaultTheme = 'dark' as const;

export const themes: Record<string, string> = {
  dark: darkTheme,
  light: lightTheme,
  hc: hcTheme,
};

/**
 * 类型导出 — 供其他模块约束
 */
export type ThemeName = 'dark' | 'light' | 'hc';
export type SpeakerIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type FontSize = keyof typeof typography.size;
export type Spacing = keyof typeof spacing;
export type Radius = keyof typeof radius;
export type Motion = keyof (typeof motion.ease | typeof motion.duration);

/**
 * 完整 tokens 对象 (用于 Storybook / 调试面板展示)
 */
export const tokens = {
  palette,
  typography,
  spacing,
  radius,
  elevation,
  motion,
  breakpoints,
  defaultTheme,
  themes,
} as const;

export default tokens;
