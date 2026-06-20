/**
 * KeyboardShortcuts hook 测试
 *
 * 覆盖:
 *  - 监听 document keydown
 *  - 按键命中映射 → 调用对应 handler
 *  - input/textarea/contenteditable focus 时不触发
 *  - 修饰键 (Ctrl/Cmd) 单独时不误触发
 *  - ignoreRepeat 阻止 keydown 长按重复
 *  - 卸载时移除监听
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts, type ShortcutMap } from '../KeyboardShortcuts';

type Handler = (e: KeyboardEvent) => void;

interface Handlers {
  toggleRecord: Handler;
  clear: Handler;
  toggleMute: Handler;
  help: Handler;
  themeDark: Handler;
  themeLight: Handler;
  themeHC: Handler;
}

function dispatchKey(opts: Partial<KeyboardEvent> & { key: string }) {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe('useKeyboardShortcuts', () => {
  let handlers: Handlers;
  let addSpy: any;
  let removeSpy: any;
  let shortcuts: ShortcutMap;

  beforeEach(() => {
    handlers = {
      toggleRecord: vi.fn(),
      clear: vi.fn(),
      toggleMute: vi.fn(),
      help: vi.fn(),
      themeDark: vi.fn(),
      themeLight: vi.fn(),
      themeHC: vi.fn(),
    };
    shortcuts = [
      { key: ' ', handler: handlers.toggleRecord, description: '录音/停止' },
      { key: 'r', handler: handlers.clear, description: '清除' },
      { key: 'm', handler: handlers.toggleMute, description: '静音' },
      { key: '?', handler: handlers.help, description: '帮助' },
      { key: '1', handler: handlers.themeDark, description: '深色主题' },
      { key: '2', handler: handlers.themeLight, description: '浅色主题' },
      { key: '3', handler: handlers.themeHC, description: '高对比度' },
    ];
    addSpy = vi.spyOn(document, 'addEventListener');
    removeSpy = vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('挂载时注册 keydown, 卸载时移除', () => {
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ shortcuts }),
    );
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('Space 触发 toggleRecord', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    dispatchKey({ key: ' ' });
    expect(handlers.toggleRecord).toHaveBeenCalledTimes(1);
  });

  it('R / M / ? triggers corresponding handlers', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    dispatchKey({ key: 'r' });
    dispatchKey({ key: 'm' });
    dispatchKey({ key: '?' });
    expect(handlers.clear).toHaveBeenCalledTimes(1);
    expect(handlers.toggleMute).toHaveBeenCalledTimes(1);
    expect(handlers.help).toHaveBeenCalledTimes(1);
  });

  it('1 / 2 / 3 触发主题切换 handler', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    dispatchKey({ key: '1' });
    dispatchKey({ key: '2' });
    dispatchKey({ key: '3' });
    expect(handlers.themeDark).toHaveBeenCalledTimes(1);
    expect(handlers.themeLight).toHaveBeenCalledTimes(1);
    expect(handlers.themeHC).toHaveBeenCalledTimes(1);
  });

  it('input/textarea/contenteditable focus 时不触发', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    dispatchKey({ key: 'r' });
    dispatchKey({ key: ' ' });
    document.body.removeChild(input);
    expect(handlers.clear).not.toHaveBeenCalled();
    expect(handlers.toggleRecord).not.toHaveBeenCalled();
  });

  it('contenteditable 元素 focus 时不触发', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    // jsdom 对非表单元素 focus 不可靠, 直接把 activeElement 设为 div 模拟 focus
    (div as any).focus = vi.fn();
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => div,
    });
    dispatchKey({ key: 'r' });
    document.body.removeChild(div);
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => document.body,
    });
    expect(handlers.clear).not.toHaveBeenCalled();
  });

  it('带 Ctrl/Cmd/Alt 修饰键时, 不触发单键映射', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    dispatchKey({ key: 'r', ctrlKey: true });
    dispatchKey({ key: 'r', metaKey: true });
    dispatchKey({ key: 'r', altKey: true });
    expect(handlers.clear).not.toHaveBeenCalled();
  });

  it('shift+? 也能命中 "?" 映射 (兼容 ? 在 shift 键上)', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    dispatchKey({ key: '?', shiftKey: true });
    expect(handlers.help).toHaveBeenCalledTimes(1);
  });

  it('ignoreRepeat=true 时阻止长按重复', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts, ignoreRepeat: true }));
    dispatchKey({ key: 'r', repeat: true });
    dispatchKey({ key: 'r', repeat: true });
    expect(handlers.clear).not.toHaveBeenCalled();
    dispatchKey({ key: 'r', repeat: false });
    expect(handlers.clear).toHaveBeenCalledTimes(1);
  });

  it('key 的大小写不敏感', () => {
    renderHook(() => useKeyboardShortcuts({ shortcuts }));
    dispatchKey({ key: 'R' });
    expect(handlers.clear).toHaveBeenCalledTimes(1);
  });
});