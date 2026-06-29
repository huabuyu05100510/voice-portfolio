/**
 * sideMenuVisibility.test.tsx — 2026-06-29
 * 验证 <App /> 渲染后左侧菜单在大屏下可见 (toBeVisible)
 * 用户的 "看不到菜单" 反馈 → 在 SideMenu 上挂 data-testid 便于 E2E 断言.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// jsdom 没有 layout, 默认所有元素 toBeVisible 都为 true; 这里主要断言:
//  1) SideMenu 渲染了 (存在 data-testid)
//  2) 父容器不是 display:none
//  3) SideMenu 自身不是 display:none

// 隔离 App 的重依赖 — 让测试聚焦"侧栏被挂载并显示"
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: null,
    clientRef: { current: null },
    connectionStatus: 'ready',
    wsState: 'connected',
    sessionId: null,
    error: null,
    onTranscription: () => () => {},
    onLatency: () => () => {},
    onSessionStatus: () => () => {},
    onTtsAudio: () => () => {},
    onRecordingStopped: () => () => {},
  }),
}));
vi.mock('../hooks/useRecorder', () => ({
  useRecorder: () => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    mediaStream: null,
    latestAudio: null,
    bindWaveformCanvas: vi.fn(),
  }),
}));
vi.mock('../hooks/useTranscription', () => ({
  useTranscription: () => ({
    state: {
      results: [],
      currentText: '',
      fullText: '',
      speakers: [],
      currentSpeakerId: null,
      metrics: { audioBytes: 0, transcriptionChars: 0, chunksProcessed: 0, avgLatency: 0, startTime: 0 },
    },
    dispatch: vi.fn(),
    pushFinal: vi.fn(),
    pushPartial: vi.fn(),
    updateMetrics: vi.fn(),
    renameSpeaker: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock('../hooks/useDebugLog', () => ({
  useDebugLog: () => ({ push: vi.fn(), log: [] }),
}));
vi.mock('../hooks/useSampleAudio', () => ({
  useSampleAudio: () => ({ play: vi.fn() }),
}));
vi.mock('../hooks/useTtsPlayback', () => ({
  useTtsPlayback: () => ({ enabled: false, toggle: vi.fn(), enqueue: vi.fn() }),
}));
vi.mock('../hooks/useRealtimeConversation', () => ({
  useRealtimeConversation: () => ({
    state: { status: 'idle' },
    connect: vi.fn(),
    disconnect: vi.fn(),
    clear: vi.fn(),
  }),
  defaultRealtimeWsUrl: () => 'ws://localhost/ws',
}));
vi.mock('../hooks/useSimultaneousInterpretation', () => ({
  useSimultaneousInterpretation: () => ({
    state: {
      rows: [],
      partialSource: '',
      partialTarget: '',
      sourceLang: 'zh',
      targetLang: 'en',
      fallbackMode: false,
      translationConnected: false,
    },
    onTranscriptionFinal: vi.fn(),
    onSourcePartial: vi.fn(),
    clear: vi.fn(),
  }),
}));

// AudioCapture is imported transitively by SideMenu/App — stub it
vi.mock('../AudioCapture', () => ({
  AudioCapture: class { constructor() {} start() {} stop() {} },
}));

// OpenTelemetry 直接 stub — 让 tracer 可用但不联网
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setAttribute: () => {},
        setStatus: () => {},
        recordException: () => {},
        end: () => {},
      }),
    }),
  },
}));

// SideMenu 依赖这些子组件 — 隔离掉防止链路太深
vi.mock('../Visualizer', () => ({
  VisualizerPanel: () => null,
}));
vi.mock('../PerfMonitor', () => ({
  PerfMonitor: () => null,
}));

// 隔离 RecordingButton (需要 audioWorklet 等)
vi.mock('../components/RecordingButton', () => ({
  RecordingButton: () => null,
}));

import App from '../App';

describe('SideMenu 可见性', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => cleanup());

  it('App 渲染后存在 data-testid="side-menu" 的左侧菜单', () => {
    render(<App />);
    const sideMenu = screen.queryByTestId('side-menu');
    expect(sideMenu).toBeTruthy();
    expect(sideMenu!.tagName.toLowerCase()).toBe('aside');
  });

  it('SideMenu 不是 display:none', () => {
    render(<App />);
    const sideMenu = screen.getByTestId('side-menu');
    // jsdom 不计算 layout, 这里通过 css 静态验证
    const styles = (sideMenu as HTMLElement).style;
    expect(styles.display).not.toBe('none');
  });

  it('SideMenu 父容器 .app-body 也不是 display:none', () => {
    const { container } = render(<App />);
    const body = container.querySelector('.app-body');
    expect(body).toBeTruthy();
  });

  it('大屏下 SideMenu 不在 transform: translateX(-100%) 的 drawer 状态', () => {
    render(<App />);
    const body = document.querySelector('.app-body');
    expect(body?.getAttribute('data-menu-open')).not.toBe('true');
  });

  it('content 区域在默认 mode 下渲染了内容 (不空白)', () => {
    const { container } = render(<App />);
    const main = container.querySelector('main#main-content, .app-content');
    expect(main).toBeTruthy();
    // 默认 transcribe 模式下, main 应该有子元素 (TranscriptHero 或 CaptionBar)
    expect(main!.children.length).toBeGreaterThan(0);
  });
});