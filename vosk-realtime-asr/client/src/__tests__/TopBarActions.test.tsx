/**
 * TopBarActions.test.tsx — TDD tests for TopBarActions component (Sprint 16)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { TopBarActions } from '../components/TopBarActions';

describe('TopBarActions', () => {
  afterEach(() => cleanup());

  const defaultProps = {
    ttsEnabled: false,
    onTtsToggle: vi.fn(),
    bilingualEnabled: false,
    onBilingualToggle: vi.fn(),
    hasResults: false,
    onExport: vi.fn(),
    canPlaySample: false,
    onPlaySample: vi.fn(),
    theme: 'dark' as const,
    onThemeToggle: vi.fn(),
  };

  it('renders TTS toggle button', () => {
    render(<TopBarActions {...defaultProps} />);
    expect(screen.getByLabelText('开启语音合成')).toBeDefined();
  });

  it('TTS toggle shows correct state when enabled', () => {
    render(<TopBarActions {...defaultProps} ttsEnabled={true} />);
    expect(screen.getByLabelText('关闭语音合成')).toBeDefined();
  });

  it('calls onTtsToggle when TTS button clicked', () => {
    const onTtsToggle = vi.fn();
    render(<TopBarActions {...defaultProps} onTtsToggle={onTtsToggle} />);
    fireEvent.click(screen.getByLabelText('开启语音合成'));
    expect(onTtsToggle).toHaveBeenCalledOnce();
  });

  it('renders bilingual toggle button', () => {
    render(<TopBarActions {...defaultProps} />);
    expect(screen.getByLabelText('开启同声传译')).toBeDefined();
  });

  it('calls onBilingualToggle when clicked', () => {
    const onBilingualToggle = vi.fn();
    render(<TopBarActions {...defaultProps} onBilingualToggle={onBilingualToggle} />);
    fireEvent.click(screen.getByLabelText('开启同声传译'));
    expect(onBilingualToggle).toHaveBeenCalledOnce();
  });

  it('does not render export button when hasResults=false', () => {
    render(<TopBarActions {...defaultProps} />);
    expect(screen.queryByLabelText('导出会议纪要')).toBeNull();
  });

  it('renders export button when hasResults=true', () => {
    render(<TopBarActions {...defaultProps} hasResults={true} />);
    expect(screen.getByLabelText('导出会议纪要')).toBeDefined();
  });

  it('calls onExport when export button clicked', () => {
    const onExport = vi.fn();
    render(<TopBarActions {...defaultProps} hasResults={true} onExport={onExport} />);
    fireEvent.click(screen.getByLabelText('导出会议纪要'));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('renders theme toggle button', () => {
    render(<TopBarActions {...defaultProps} />);
    expect(screen.getByLabelText('切换主题')).toBeDefined();
  });

  it('calls onThemeToggle when clicked', () => {
    const onThemeToggle = vi.fn();
    render(<TopBarActions {...defaultProps} onThemeToggle={onThemeToggle} />);
    fireEvent.click(screen.getByLabelText('切换主题'));
    expect(onThemeToggle).toHaveBeenCalledOnce();
  });

  it('shows active state for bilingual toggle when enabled', () => {
    render(<TopBarActions {...defaultProps} bilingualEnabled={true} />);
    const btn = screen.getByLabelText('关闭同声传译');
    expect(btn.className).toContain('topbar-action-btn--active');
  });
});