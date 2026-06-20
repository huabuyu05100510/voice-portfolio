/**
 * AccessibilityContext — 主题 + 减动效偏好.
 *
 * 设计目标:
 *  - 单一来源: 主题写入 <html data-theme="..."> 方便 CSS 选择器匹配
 *  - 持久化: localStorage, 刷新后保留
 *  - prefers-reduced-motion: 用 matchMedia 监听系统级偏好
 *  - 类型安全: Theme 联合类型, setTheme 编译期拒绝非法值
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Theme = 'dark' | 'light' | 'hc';

interface AccessibilityCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** 来自系统的 prefers-reduced-motion: reduce 媒体查询 */
  prefersReducedMotion: boolean;
  /** 三主题列表, 用于 UI 切换器 */
  themes: readonly Theme[];
  /** 主题显示名 */
  themeLabel: (t: Theme) => string;
}

const THEME_KEY = 'vosk-a11y:theme';
const VALID_THEMES: readonly Theme[] = ['dark', 'light', 'hc'];
const THEME_LABELS: Record<Theme, string> = {
  dark: '深色',
  light: '浅色',
  hc: '高对比度',
};

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved && (VALID_THEMES as readonly string[]).includes(saved)) {
      return saved as Theme;
    }
  } catch {
    // localStorage 访问失败 (隐私模式等), 忽略
  }
  return 'dark';
}

const AccessibilityContext = createContext<AccessibilityCtx | null>(null);

export interface AccessibilityProviderProps {
  children: React.ReactNode;
  /** 测试用, 强制指定初始主题 */
  initialTheme?: Theme;
}

export const AccessibilityProvider: React.FC<AccessibilityProviderProps> = ({
  children,
  initialTheme,
}) => {
  const [theme, setThemeState] = useState<Theme>(
    initialTheme ?? readInitialTheme(),
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    () => {
      if (typeof window === 'undefined' || !window.matchMedia) return false;
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
  );

  // 主题同步到 <html data-theme> + localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // 监听 prefers-reduced-motion 变化
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setPrefersReducedMotion(e.matches);
    setPrefersReducedMotion(mql.matches);
    // 兼容旧 API (Safari < 14)
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const value = useMemo<AccessibilityCtx>(
    () => ({
      theme,
      setTheme,
      prefersReducedMotion,
      themes: VALID_THEMES,
      themeLabel: (t: Theme) => THEME_LABELS[t],
    }),
    [theme, setTheme, prefersReducedMotion],
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
};

export function useAccessibility(): AccessibilityCtx {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error('useAccessibility must be used within <AccessibilityProvider>');
  }
  return ctx;
}