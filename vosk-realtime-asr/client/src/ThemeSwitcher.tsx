/**
 * ThemeSwitcher — 三主题切换器 (radiogroup 语义).
 *
 * 设计:
 *  - role="radiogroup", 每个按钮 role="radio" + aria-checked
 *  - 键盘: Tab 进入, ←/→/↑/↓ 切换, Space/Enter 确认 (浏览器 radio 原生支持)
 *  - aria-label 中文描述当前主题
 */

import React from 'react';
import { useAccessibility, type Theme } from './AccessibilityContext';

export const ThemeSwitcher: React.FC = () => {
  const { theme, setTheme, themes, themeLabel } = useAccessibility();

  return (
    <div
      className="theme-switcher"
      role="radiogroup"
      aria-label="主题切换"
    >
      {themes.map((t: Theme) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          aria-label={`切换到${themeLabel(t)}主题`}
          tabIndex={theme === t ? 0 : -1}
          className="theme-option"
          onClick={() => setTheme(t)}
          onKeyDown={(e) => {
            // 方向键在 radiogroup 内切换 (标准 ARIA 实践)
            const idx = themes.indexOf(t);
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              const next = themes[(idx + 1) % themes.length];
              setTheme(next);
              (document.querySelector(
                `[aria-label="切换到${themeLabel(next)}主题"]`,
              ) as HTMLElement | null)?.focus();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              const prev = themes[(idx - 1 + themes.length) % themes.length];
              setTheme(prev);
              (document.querySelector(
                `[aria-label="切换到${themeLabel(prev)}主题"]`,
              ) as HTMLElement | null)?.focus();
            }
          }}
        >
          {themeLabel(t)}
        </button>
      ))}
    </div>
  );
};

export default ThemeSwitcher;