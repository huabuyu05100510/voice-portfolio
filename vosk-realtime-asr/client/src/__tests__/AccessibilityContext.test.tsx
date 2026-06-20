/**
 * AccessibilityContext 测试
 * TDD: 先写测试, 再写实现.
 *
 * 覆盖:
 *  - 默认主题 = dark
 *  - setTheme 切换主题
 *  - 主题写到 document.documentElement.dataset.theme
 *  - prefers-reduced-motion 被监听到
 *  - 主题持久化到 localStorage
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import React from 'react';
import {
  AccessibilityProvider,
  useAccessibility,
  type Theme,
} from '../AccessibilityContext';

// jsdom 在没有 URL 时不创建 localStorage, 这里注入一个内存实现
const memStore = new Map<string, string>();
if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => memStore.set(k, v),
      removeItem: (k: string) => memStore.delete(k),
      clear: () => memStore.clear(),
      key: (i: number) => Array.from(memStore.keys())[i] ?? null,
      get length() { return memStore.size; },
    },
  });
}
if (typeof globalThis.localStorage === 'undefined' && typeof window !== 'undefined') {
  (globalThis as any).localStorage = window.localStorage;
}

const Probe: React.FC = () => {
  const { theme, setTheme, prefersReducedMotion } = useAccessibility();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="reduced">{String(prefersReducedMotion)}</span>
      <button onClick={() => setTheme('light')}>to-light</button>
      <button onClick={() => setTheme('hc')}>to-hc</button>
      <button onClick={() => setTheme('dark')}>to-dark</button>
    </div>
  );
};

describe('AccessibilityContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('默认主题为 dark, 并写入 documentElement dataset', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setTheme 切换主题 + 同步 dataset + 持久化到 localStorage', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>,
    );

    act(() => {
      screen.getByText('to-light').click();
    });
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('vosk-a11y:theme')).toBe('light');

    act(() => {
      screen.getByText('to-hc').click();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('hc');
    expect(localStorage.getItem('vosk-a11y:theme')).toBe('hc');
  });

  it('从 localStorage 恢复主题', () => {
    localStorage.setItem('vosk-a11y:theme', 'hc');
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('hc');
    expect(document.documentElement.getAttribute('data-theme')).toBe('hc');
  });

  it('监听 prefers-reduced-motion 媒体查询变化', () => {
    // jsdom 默认没有 matchMedia, 我们手动注入
    let listener: ((e: MediaQueryListEvent) => void) | null = null;
    const mockMQL = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    } as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mockMQL);

    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(screen.getByTestId('reduced').textContent).toBe('false');

    // 模拟系统切到 reduce
    (mockMQL as any).matches = true;
    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByTestId('reduced').textContent).toBe('true');
  });

  it('useAccessibility 在 Provider 外抛错', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AccessibilityProvider/);
    spy.mockRestore();
  });

  it('列出所有合法主题枚举', () => {
    const themes: Theme[] = ['dark', 'light', 'hc'];
    expect(themes.length).toBe(3);
  });
});