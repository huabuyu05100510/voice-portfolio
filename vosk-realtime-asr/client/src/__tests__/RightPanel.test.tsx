/**
 * RightPanel.test.tsx — TDD tests for RightPanel component (Sprint 16)
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { RightPanel } from '../components/RightPanel';
import type { RightPanelProps } from '../components/RightPanel';

// jsdom has no real canvas, VisualizerPanel's AudioVisualizer will crash
vi.mock('../Visualizer', () => ({
  VisualizerPanel: () => null,
}));

describe('RightPanel', () => {
  afterEach(() => cleanup());

  const defaultProps: RightPanelProps = {
    collapsed: false,
    onToggleCollapse: vi.fn(),
    speakers: [],
    currentSpeakerId: null,
    isRecording: false,
    onRenameSpeaker: undefined,
    metrics: { audioBytes: 0, transcriptionChars: 0, chunksProcessed: 0, avgLatency: 0, startTime: 0 },
    status: 'idle',
    wsState: 'disconnected',
    mediaStream: null,
    latestAudio: null,
    bindWaveformCanvas: vi.fn(),
    podcastTranscript: '',
    onPodcastGenerated: vi.fn(),
    podcastResult: null,
    debugLog: [],
    results: undefined,
    onExport: vi.fn(),
    exportOpen: false,
    onToggleExport: vi.fn(),
    canPlaySample: false,
    onPlaySample: vi.fn(),
    hasResults: false,
    onClear: vi.fn(),
  };

  it('renders collapsed state when collapsed=true', () => {
    const { container } = render(
      <RightPanel {...defaultProps} collapsed={true} />,
    );
    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel!.className).toContain('right-panel--collapsed');
  });

  it('renders expanded state with 3 tabs', () => {
    render(<RightPanel {...defaultProps} />);
    expect(screen.getByRole('tab', { name: /说话人/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /工具/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /监控/ })).toBeDefined();
  });

  it('switches active tab on click', () => {
    render(<RightPanel {...defaultProps} />);
    const toolsTab = screen.getByRole('tab', { name: /工具/ });
    fireEvent.click(toolsTab);
    expect(toolsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /说话人/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('calls onToggleCollapse when collapse button clicked', () => {
    const onToggle = vi.fn();
    render(<RightPanel {...defaultProps} onToggleCollapse={onToggle} />);
    fireEvent.click(screen.getByLabelText('收起侧边栏'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders speakers tab by default', () => {
    render(
      <RightPanel
        {...defaultProps}
        speakers={[
          { id: 'spk1', label: 'Alice', color: '#ff0000' },
          { id: 'spk2', label: 'Bob', color: '#00ff00' },
        ]}
      />,
    );
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
  });

  it('renders export button when results are available', () => {
    render(
      <RightPanel
        {...defaultProps}
        results={[{ text: 'Hello', isFinal: true, fullText: 'Hello', timestamp: new Date().toISOString(), definite: true, start_time: 0, end_time: 1000 }]}
      />,
    );
    // Switch to tools tab
    fireEvent.click(screen.getByRole('tab', { name: /工具/ }));
    expect(screen.getByText(/导出纪要/)).toBeDefined();
  });

  it('shows clear button when hasResults=true in tools tab', () => {
    render(<RightPanel {...defaultProps} hasResults={true} />);
    fireEvent.click(screen.getByRole('tab', { name: /工具/ }));
    expect(screen.getByLabelText('清除转写结果 (快捷键 R)')).toBeDefined();
  });

  it('does not show collapsed-internal content in collapsed mode', () => {
    render(<RightPanel {...defaultProps} collapsed={true} />);
    expect(screen.queryByRole('tab', { name: /说话人/ })).toBeNull();
  });
});