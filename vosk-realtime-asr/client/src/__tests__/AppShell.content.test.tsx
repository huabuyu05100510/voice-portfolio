/**
 * AppShell.content.test.tsx — Sprint 18 content switch 验证
 * 7 mode 各自渲染正确组件 + default fallback
 * 用 setItem 直接写入 localStorage 触发 mode 切换, 然后断言对应组件挂载
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ALL_MODES } from '../components/ModeTabs';

// Mock 所有子组件, 断言它们在对应 mode 下被挂载
const mockMounted = { current: new Set<string>() };

vi.mock('../components/FileRecognition', () => ({
  FileRecognition: () => {
    mockMounted.current.add('FileRecognition');
    return <div data-testid="file-recognition">FileRecognition</div>;
  },
}));
vi.mock('../components/PodcastGenerator', () => ({
  PodcastGenerator: () => {
    mockMounted.current.add('PodcastGenerator');
    return <div data-testid="podcast">PodcastGenerator</div>;
  },
}));
vi.mock('../components/VoiceLibrary', () => ({
  VoiceLibrary: () => {
    mockMounted.current.add('VoiceLibrary');
    return <div data-testid="voice-library">VoiceLibrary</div>;
  },
}));
vi.mock('../components/VoiceCloningWizard', () => ({
  VoiceCloningWizard: () => {
    mockMounted.current.add('VoiceCloningWizard');
    return <div data-testid="voice-cloning">VoiceCloningWizard</div>;
  },
}));
vi.mock('../components/RealtimeChat', () => ({
  RealtimeChat: () => {
    mockMounted.current.add('RealtimeChat');
    return <div data-testid="realtime-chat">RealtimeChat</div>;
  },
}));
vi.mock('../components/VoiceDesigner', () => ({
  VoiceDesigner: () => {
    mockMounted.current.add('VoiceDesigner');
    return <div data-testid="voice-designer">VoiceDesigner</div>;
  },
}));
vi.mock('../components/TranscriptHero', () => ({
  TranscriptHero: ({ children }: { children?: React.ReactNode }) => {
    mockMounted.current.add('TranscriptHero');
    return <div data-testid="transcript-hero">{children}</div>;
  },
}));
vi.mock('../components/CaptionBar', () => ({
  CaptionBar: () => {
    mockMounted.current.add('CaptionBar');
    return null;
  },
}));
vi.mock('../components/RecordingButton', () => ({
  RecordingButton: () => {
    mockMounted.current.add('RecordingButton');
    return null;
  },
}));
vi.mock('../components/BilingualCaption', () => ({
  BilingualCaption: () => {
    mockMounted.current.add('BilingualCaption');
    return null;
  },
}));

// Hooks stubs — 避免网络与 audio
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: null, clientRef: { current: null },
    connectionStatus: 'ready', wsState: 'connected', sessionId: null, error: null,
    onTranscription: () => () => {}, onLatency: () => () => {},
    onSessionStatus: () => () => {}, onTtsAudio: () => () => {}, onRecordingStopped: () => () => {},
  }),
}));
vi.mock('../hooks/useRecorder', () => ({
  useRecorder: () => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(),
    mediaStream: null, latestAudio: null, bindWaveformCanvas: vi.fn(),
  }),
}));
vi.mock('../hooks/useTranscription', () => ({
  useTranscription: () => ({
    state: { results: [], currentText: '', fullText: '', speakers: [], currentSpeakerId: null,
      metrics: { audioBytes: 0, transcriptionChars: 0, chunksProcessed: 0, avgLatency: 0, startTime: 0 } },
    dispatch: vi.fn(), pushFinal: vi.fn(), pushPartial: vi.fn(),
    updateMetrics: vi.fn(), renameSpeaker: vi.fn(), clear: vi.fn(),
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
  useRealtimeConversation: () => ({ state: { status: 'idle' }, connect: vi.fn(), disconnect: vi.fn(), clear: vi.fn() }),
  defaultRealtimeWsUrl: () => 'ws://localhost/ws',
}));
vi.mock('../hooks/useSimultaneousInterpretation', () => ({
  useSimultaneousInterpretation: () => ({
    state: { rows: [], partialSource: '', partialTarget: '', sourceLang: 'zh', targetLang: 'en', fallbackMode: false, translationConnected: false },
    onTranscriptionFinal: vi.fn(), onSourcePartial: vi.fn(), clear: vi.fn(),
  }),
}));
vi.mock('../hooks/useFileAsr', () => ({
  useFileAsr: () => ({ tasks: [], submit: vi.fn(), retry: vi.fn(), cancel: vi.fn(), clearFinished: vi.fn(), isUploading: false }),
}));
vi.mock('../hooks/usePodcastGeneration', () => ({
  usePodcastGeneration: () => ({ state: { phase: 'idle' }, submit: vi.fn(), cancel: vi.fn(), retry: vi.fn(), reset: vi.fn() }),
}));
vi.mock('../hooks/useVoiceCloning', () => ({
  useVoiceCloning: () => ({
    state: { phase: 'idle' }, voices: [], activeVoiceId: null,
    startRecording: vi.fn(), onRecordingDone: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(), setVoiceName: vi.fn(), refreshVoices: vi.fn().mockResolvedValue(undefined),
    deleteVoice: vi.fn().mockResolvedValue(undefined), setActiveVoice: vi.fn(),
  }),
}));
vi.mock('../AudioCapture', () => ({
  AudioCapture: class { constructor() {} start() {} stop() {} },
}));
vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startSpan: () => ({ setAttribute: () => {}, setStatus: () => {}, recordException: () => {}, end: () => {} }) }) },
}));
vi.mock('../Visualizer', () => ({ VisualizerPanel: () => null }));
vi.mock('../PerfMonitor', () => ({ PerfMonitor: () => null }));

import App from '../App';

describe('App content switch (Sprint 18)', () => {
  beforeEach(() => {
    mockMounted.current = new Set();
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => cleanup());

  for (const mode of ALL_MODES) {
    it(`mode=${mode} 渲染对应组件`, () => {
      try { localStorage.setItem('voice-portfolio:mode', mode); } catch { /* ignore */ }
      const { container } = render(<App />);

      switch (mode) {
        case 'transcribe':
          expect(mockMounted.current.has('TranscriptHero')).toBe(true);
          break;
        case 'conversation':
          expect(mockMounted.current.has('RealtimeChat')).toBe(true);
          break;
        case 'voice_design':
          expect(mockMounted.current.has('VoiceDesigner')).toBe(true);
          break;
        case 'file_recognition':
          expect(mockMounted.current.has('FileRecognition')).toBe(true);
          break;
        case 'podcast':
          expect(mockMounted.current.has('PodcastGenerator')).toBe(true);
          break;
        case 'voice_library':
          expect(mockMounted.current.has('VoiceLibrary')).toBe(true);
          break;
        case 'voice_cloning':
          expect(mockMounted.current.has('VoiceCloningWizard')).toBe(true);
          break;
      }

      // 通用断言: 菜单始终可见
      expect(screen.getByTestId('side-menu')).toBeTruthy();
      // 主体 main 元素渲染
      expect(container.querySelector('main.app-content')).toBeTruthy();
    });
  }

  it('localStorage 脏值时回退到 transcribe', () => {
    try { localStorage.setItem('voice-portfolio:mode', 'bogus_mode'); } catch { /* ignore */ }
    render(<App />);
    expect(mockMounted.current.has('TranscriptHero')).toBe(true);
  });
});