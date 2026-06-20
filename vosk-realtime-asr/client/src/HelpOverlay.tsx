/**
 * HelpOverlay — 键盘快捷键帮助弹层.
 *
 * 设计:
 *  - role="dialog", aria-modal="true", aria-labelledby 指向标题
 *  - Esc 关闭, 焦点陷阱 (简单实现: 进入时焦点到关闭按钮, Tab 在内部循环)
 *  - 屏幕阅读器: aria-describedby 指向表格说明
 */

import React, { useEffect, useRef } from 'react';

interface Shortcut {
  key: string;
  description: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  { key: 'Space', description: '开始 / 停止录音' },
  { key: 'R', description: '清除转写结果' },
  { key: 'M', description: '切换静音 (示例音频)' },
  { key: '?', description: '显示 / 隐藏本帮助' },
  { key: 'Esc', description: '关闭弹层' },
  { key: '1', description: '切换到深色主题' },
  { key: '2', description: '切换到浅色主题' },
  { key: '3', description: '切换到高对比度主题' },
  { key: 'Tab', description: '切换焦点 (表单中不触发快捷键)' },
];

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ open, onClose }) => {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Esc 关闭 + 进入时焦点到关闭按钮
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="help-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        aria-describedby="help-dialog-desc"
      >
        <h2 id="help-dialog-title">键盘快捷键</h2>
        <p id="help-dialog-desc" className="sr-only">
          所有快捷键在输入框聚焦时不生效.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">按键</th>
              <th scope="col">功能</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.key}>
                <td>
                  <kbd>{s.key}</kbd>
                </td>
                <td>{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="close-row">
          <button
            ref={closeRef}
            type="button"
            className="btn btn-clear"
            onClick={onClose}
            aria-label="关闭帮助弹层"
          >
            关闭 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};

export default HelpOverlay;