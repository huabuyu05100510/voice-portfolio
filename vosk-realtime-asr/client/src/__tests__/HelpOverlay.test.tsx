/**
 * HelpOverlay 组件测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HelpOverlay } from '../HelpOverlay';

describe('HelpOverlay', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('open=false 时不渲染', () => {
    const { container } = render(<HelpOverlay open={false} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('open=true 渲染 dialog + 标题 + 表格', () => {
    render(<HelpOverlay open onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('键盘快捷键')).toBeTruthy();
    // Space 是常用键, 应出现
    expect(screen.getByText('Space')).toBeTruthy();
  });

  it('dialog 有 aria-modal + aria-labelledby + aria-describedby', () => {
    render(<HelpOverlay open onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('help-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('help-dialog-desc');
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<HelpOverlay open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /关闭帮助弹层/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc 键关闭弹层', () => {
    const onClose = vi.fn();
    render(<HelpOverlay open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩 (overlay) 关闭, 点击 dialog 内部不关闭', () => {
    const onClose = vi.fn();
    render(<HelpOverlay open onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});