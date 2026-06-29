/**
 * ModeTabs.test.tsx — TDD tests for ModeTabs component (Sprint 16)
 *  Sprint 18: 7 tabs 全覆盖
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { ModeTabs, type AppMode, ALL_MODES } from '../components/ModeTabs';

describe('ModeTabs', () => {
  afterEach(() => cleanup());

  it('renders three original tabs', () => {
    render(<ModeTabs mode="transcribe" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '实时转写' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '对话' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '音色设计' })).toBeDefined();
  });

  it('renders 7 tabs total (Sprint 18)', () => {
    render(<ModeTabs mode="transcribe" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '实时转写' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '对话' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '音色设计' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '文件识别' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '播客生成' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '音色库' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '语音克隆' })).toBeDefined();
  });

  it('ALL_MODES 包含 7 个值', () => {
    expect(ALL_MODES).toHaveLength(7);
    expect(ALL_MODES).toContain('transcribe');
    expect(ALL_MODES).toContain('conversation');
    expect(ALL_MODES).toContain('voice_design');
    expect(ALL_MODES).toContain('file_recognition');
    expect(ALL_MODES).toContain('podcast');
    expect(ALL_MODES).toContain('voice_library');
    expect(ALL_MODES).toContain('voice_cloning');
  });

  it('marks current mode tab as selected', () => {
    render(<ModeTabs mode="conversation" onChange={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: '对话' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onChange when clicking a different tab', () => {
    const onChange = vi.fn();
    render(<ModeTabs mode="transcribe" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '音色设计' }));
    expect(onChange).toHaveBeenCalledWith('voice_design');
  });

  it('calls onChange when clicking new mode tabs (file_recognition / podcast / voice_library / voice_cloning)', () => {
    const onChange = vi.fn();
    render(<ModeTabs mode="transcribe" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '文件识别' }));
    expect(onChange).toHaveBeenCalledWith('file_recognition');
    fireEvent.click(screen.getByRole('tab', { name: '播客生成' }));
    expect(onChange).toHaveBeenCalledWith('podcast');
    fireEvent.click(screen.getByRole('tab', { name: '音色库' }));
    expect(onChange).toHaveBeenCalledWith('voice_library');
    fireEvent.click(screen.getByRole('tab', { name: '语音克隆' }));
    expect(onChange).toHaveBeenCalledWith('voice_cloning');
  });

  it('marks inactive tabs as not selected', () => {
    render(<ModeTabs mode="transcribe" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '对话' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '音色设计' }).getAttribute('aria-selected')).toBe('false');
  });

  it('active tab has --active CSS class', () => {
    render(<ModeTabs mode="voice_design" onChange={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: '音色设计' });
    expect(tab.className).toContain('topbar-tab--active');
  });
});