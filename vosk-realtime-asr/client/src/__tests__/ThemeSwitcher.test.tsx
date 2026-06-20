/**
 * ThemeSwitcher 组件测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ThemeSwitcher } from '../ThemeSwitcher';
import { AccessibilityProvider } from '../AccessibilityContext';

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

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    memStore.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染 radiogroup + 三个 radio 选项', () => {
    render(
      <AccessibilityProvider>
        <ThemeSwitcher />
      </AccessibilityProvider>,
    );
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('当前主题对应的 radio 有 aria-checked=true', () => {
    render(
      <AccessibilityProvider initialTheme="dark">
        <ThemeSwitcher />
      </AccessibilityProvider>,
    );
    const radios = screen.getAllByRole('radio');
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute('aria-label')).toContain('深色');
  });

  it('点击 light 切换主题 + 同步 dataset', () => {
    render(
      <AccessibilityProvider>
        <ThemeSwitcher />
      </AccessibilityProvider>,
    );
    act(() => {
      screen.getByLabelText(/浅色/).click();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('每个 radio 都有 aria-label 描述', () => {
    render(
      <AccessibilityProvider>
        <ThemeSwitcher />
      </AccessibilityProvider>,
    );
    expect(screen.getByLabelText(/深色主题/)).toBeTruthy();
    expect(screen.getByLabelText(/浅色主题/)).toBeTruthy();
    expect(screen.getByLabelText(/高对比度主题/)).toBeTruthy();
  });

  it('Tab 顺序: 当前主题可聚焦 (tabIndex=0), 其他为 -1', () => {
    render(
      <AccessibilityProvider initialTheme="hc">
        <ThemeSwitcher />
      </AccessibilityProvider>,
    );
    const radios = screen.getAllByRole('radio');
    const hcRadio = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(hcRadio?.tabIndex).toBe(0);
    const others = radios.filter((r) => r.getAttribute('aria-checked') === 'false');
    expect(others.every((r) => r.tabIndex === -1)).toBe(true);
  });
});