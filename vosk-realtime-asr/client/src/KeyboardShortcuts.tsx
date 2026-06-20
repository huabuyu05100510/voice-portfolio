/**
 * KeyboardShortcuts — 全局键盘事件 hook.
 *
 * 设计目标:
 *  - 单一来源: 一个 document-level keydown 监听
 *  - 不冲突: input / textarea / contenteditable / select focus 时不触发
 *  - 修饰键过滤: 单键映射不应被 Ctrl/Cmd/Alt 触发, 避免覆盖浏览器快捷键
 *  - shift 兼容: '?' 在键盘上需要 shift+/, 允许 shift 修饰键
 *  - 防长按: ignoreRepeat=true 时过滤 repeat 事件
 *  - 大小写无关
 *
 * 用法:
 *   useKeyboardShortcuts({
 *     shortcuts: [
 *       { key: ' ', handler: toggleRecord, description: '录音/停止' },
 *       { key: 'r', handler: clearAll },
 *     ],
 *   });
 */

import { useEffect } from 'react';

export interface ShortcutBinding {
  /** 单个字符或 ' ' (空格), '?' 等 */
  key: string;
  /** 触发时的回调 */
  handler: (e: KeyboardEvent) => void;
  /** 描述 (用于 ? 帮助弹层) */
  description?: string;
  /** 是否允许在表单字段 focus 时也触发, 默认 false */
  allowInInput?: boolean;
}

export type ShortcutMap = readonly ShortcutBinding[];

export interface UseKeyboardShortcutsOptions {
  shortcuts: ShortcutMap;
  /** 是否忽略 keydown 长按 repeat, 默认 true */
  ignoreRepeat?: boolean;
  /** 是否启用, 默认 true (用于响应 enabled prop) */
  enabled?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  // 优先看事件 target, 兜底看 activeElement (keydown 全局监听时 target 通常是 document)
  const el: HTMLElement | null =
    (target && (target as HTMLElement).tagName ? (target as HTMLElement) : null) ??
    (typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null);
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // isContentEditable 在 div.contentEditable = 'true' 后为 true
  if ((el as any).isContentEditable) return true;
  // 兼容显式设置 contentEditable 属性的情况
  if ((el as any).contentEditable === 'true' || (el as any).contentEditable === true) {
    return true;
  }
  return false;
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function useKeyboardShortcuts(opts: UseKeyboardShortcutsOptions): void {
  const { shortcuts, ignoreRepeat = true, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // 长按重复过滤
      if (ignoreRepeat && e.repeat) return;
      // 编辑控件 focus 时不抢键
      const binding = shortcuts.find((b) => {
        if (b.allowInInput) return true;
        if (isEditableTarget(e.target)) return false;
        return normalizeKey(b.key) === normalizeKey(e.key);
      });
      if (!binding) return;
      // 单键映射不应被 Ctrl/Cmd/Alt 抢占
      // 但 shift 允许 (兼容 ? 在 shift 上)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // 阻止默认行为 (Space 滚动页面)
      if (e.key === ' ') {
        e.preventDefault();
      }
      binding.handler(e);
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [shortcuts, ignoreRepeat, enabled]);
}