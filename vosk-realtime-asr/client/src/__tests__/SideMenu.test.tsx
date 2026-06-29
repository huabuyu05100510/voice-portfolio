/**
 * SideMenu.test.tsx — Sprint 18 全量 7 项分组菜单
 * 验证:3 section label / 7 菜单项 / active 高亮 / 点击 → onModeChange / 键盘可达
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { SideMenu } from '../components/SideMenu';
import type { SideMenuProps } from '../components/SideMenu';

describe('SideMenu', () => {
  afterEach(() => cleanup());

  const defaultProps: SideMenuProps = {
    mode: 'transcribe',
    onModeChange: vi.fn(),
    sessionId: null,
    wsState: 'connected',
    metrics: { audioBytes: 0, transcriptionChars: 0, chunksProcessed: 0, avgLatency: 0, startTime: 0 },
  };

  it('渲染 7 个菜单按钮', () => {
    render(<SideMenu {...defaultProps} />);
    expect(screen.getByRole('button', { name: '实时转写' })).toBeDefined();
    expect(screen.getByRole('button', { name: '文件识别' })).toBeDefined();
    expect(screen.getByRole('button', { name: '对话模式' })).toBeDefined();
    expect(screen.getByRole('button', { name: '播客生成' })).toBeDefined();
    expect(screen.getByRole('button', { name: '音色设计' })).toBeDefined();
    expect(screen.getByRole('button', { name: '音色库' })).toBeDefined();
    expect(screen.getByRole('button', { name: '语音克隆' })).toBeDefined();
  });

  it('渲染 3 个分组 label (转写 / 生成 / 音色)', () => {
    render(<SideMenu {...defaultProps} />);
    expect(screen.getByText('转写')).toBeDefined();
    expect(screen.getByText('生成')).toBeDefined();
    expect(screen.getByText('音色')).toBeDefined();
  });

  it('active 项有 --active class', () => {
    render(<SideMenu {...defaultProps} mode="conversation" />);
    const item = screen.getByRole('button', { name: '对话模式' });
    expect(item.className).toContain('side-menu-item--active');
    // 其他项不应有 active
    expect(screen.getByRole('button', { name: '实时转写' }).className).not.toContain('side-menu-item--active');
  });

  it('点击新 mode 项 → 触发 onModeChange', () => {
    const onModeChange = vi.fn();
    render(<SideMenu {...defaultProps} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole('button', { name: '文件识别' }));
    expect(onModeChange).toHaveBeenCalledWith('file_recognition');

    fireEvent.click(screen.getByRole('button', { name: '播客生成' }));
    expect(onModeChange).toHaveBeenCalledWith('podcast');

    fireEvent.click(screen.getByRole('button', { name: '音色库' }));
    expect(onModeChange).toHaveBeenCalledWith('voice_library');

    fireEvent.click(screen.getByRole('button', { name: '语音克隆' }));
    expect(onModeChange).toHaveBeenCalledWith('voice_cloning');
  });

  it('按钮可用键盘 focus + Enter 触发', () => {
    const onModeChange = vi.fn();
    render(<SideMenu {...defaultProps} onModeChange={onModeChange} />);
    const btn = screen.getByRole('button', { name: '音色库' });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.click(btn);
    expect(onModeChange).toHaveBeenCalledWith('voice_library');
  });

  it('录音中 (mode=transcribe) 显示 metrics', () => {
    render(<SideMenu {...defaultProps} metrics={{ ...defaultProps.metrics, avgLatency: 50, audioBytes: 4096 }} />);
    expect(screen.getByText(/50ms/)).toBeDefined();
    expect(screen.getByText(/4KB/)).toBeDefined();
  });

  it('WS 状态显示', () => {
    const { rerender } = render(<SideMenu {...defaultProps} wsState="connected" />);
    expect(screen.getByText(/WS connected/)).toBeDefined();
    rerender(<SideMenu {...defaultProps} wsState="disconnected" />);
    expect(screen.getByText(/WS disconnected/)).toBeDefined();
  });

  it('快捷键提示区域渲染', () => {
    render(<SideMenu {...defaultProps} />);
    expect(screen.getByText('快捷键')).toBeDefined();
    expect(screen.getByText(/录音/)).toBeDefined();
  });

  it('侧栏根元素有 data-testid="side-menu"', () => {
    render(<SideMenu {...defaultProps} />);
    expect(screen.getByTestId('side-menu')).toBeDefined();
  });

  it('所有 7 个按钮可点击且不抛错', () => {
    const onModeChange = vi.fn();
    render(<SideMenu {...defaultProps} onModeChange={onModeChange} />);
    const labels = ['实时转写', '文件识别', '对话模式', '播客生成', '音色设计', '音色库', '语音克隆'];
    for (const l of labels) {
      expect(() => fireEvent.click(screen.getByRole('button', { name: l }))).not.toThrow();
    }
    expect(onModeChange).toHaveBeenCalledTimes(7);
  });
});