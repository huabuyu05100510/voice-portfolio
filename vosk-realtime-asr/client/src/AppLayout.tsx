/**
 * AppLayout — Sprint 9 Workbench 布局
 *
 * ┌─ Header ────────────────────────────────────────────┐
 * ├─ Sidebar ─┬─ Hero (live transcript) ────────────────┤
 * │  控制     │                                          │
 * │  说话人   │                                          │
 * │  监控     │                                          │
 * │  可视化   │                                          │
 * ├───────────┴──────────────────────────────────────────┤
 * └─ Status Bar ────────────────────────────────────────┘
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type {
  AppStatus,
  WebSocketState,
  SessionMetrics,
  TranscriptionResult,
  WordInfo,
  Speaker,
  Utterance,
} from './types';
import { AppHeader } from './AppHeader';
import { Sidebar } from './components/Sidebar';
import { TranscriptHero } from './components/TranscriptHero';
import { StatusBar } from './components/StatusBar';
import { CaptionBar } from './components/CaptionBar';
import { Subtitle } from './Subtitle';
import { DebugPanel } from './DebugPanel';
import type { DebugEntry } from './hooks/useDebugLog';

export interface AppLayoutProps {
  status: AppStatus;
  wsState: WebSocketState;
  sessionId: string | null;
  error: string | null;
  results: TranscriptionResult[];
  currentText: string;
  fullText: string;
  words: WordInfo[];
  finalStartTime: number;
  metrics: SessionMetrics;
  speakers: Speaker[];
  currentSpeakerId: string | null;
  utterances: Utterance[];
  mediaStream: MediaStream | null;
  latestAudio: Int16Array | null;
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  debugLog: DebugEntry[];
  onStart: () => void;
  onStop: () => void;
  onPlaySample: () => void;
  onClear: () => void;
  onCopy: () => void;
}

function areAppLayoutPropsEqual(prev: AppLayoutProps, next: AppLayoutProps): boolean {
  return (
    prev.status === next.status &&
    prev.wsState === next.wsState &&
    prev.sessionId === next.sessionId &&
    prev.error === next.error &&
    prev.results === next.results &&
    prev.currentText === next.currentText &&
    prev.fullText === next.fullText &&
    prev.words === next.words &&
    prev.finalStartTime === next.finalStartTime &&
    prev.metrics === next.metrics &&
    prev.speakers === next.speakers &&
    prev.currentSpeakerId === next.currentSpeakerId &&
    prev.utterances === next.utterances &&
    prev.mediaStream === next.mediaStream &&
    prev.latestAudio === next.latestAudio &&
    prev.bindWaveformCanvas === next.bindWaveformCanvas &&
    prev.debugLog === next.debugLog &&
    prev.onStart === next.onStart &&
    prev.onStop === next.onStop &&
    prev.onPlaySample === next.onPlaySample &&
    prev.onClear === next.onClear &&
    prev.onCopy === next.onCopy
  );
}

export const AppLayout: React.FC<AppLayoutProps> = React.memo((p) => {
  const isRecording = p.status === 'recording' || p.status === 'transcribing';
  const currentSpeaker = p.currentSpeakerId
    ? p.speakers.find((s) => s.id === p.currentSpeakerId) ?? null
    : null;
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">跳到主要内容</a>
      <AppHeader wsState={p.wsState} status={p.status} />
      <Sidebar
        status={p.status}
        wsState={p.wsState}
        sessionId={p.sessionId}
        hasResults={p.results.length > 0}
        speakers={p.speakers}
        currentSpeakerId={p.currentSpeakerId}
        metrics={p.metrics}
        mediaStream={p.mediaStream}
        latestAudio={p.latestAudio}
        bindWaveformCanvas={p.bindWaveformCanvas}
        onStart={p.onStart}
        onStop={p.onStop}
        onPlaySample={p.onPlaySample}
        onClear={p.onClear}
      />
      <main className="app-hero" id="main-content" role="main">
        <TranscriptHero
          results={p.results}
          currentText={p.currentText}
          fullText={p.fullText}
          speakers={p.speakers}
          onCopy={p.onCopy}
          canCopy={!!p.fullText}
        />
        <CaptionBar
          currentText={p.currentText}
          fullText={p.fullText}
          currentSpeaker={currentSpeaker}
          isRecording={isRecording}
        />
      </main>
      <StatusBar
        wsState={p.wsState}
        status={p.status}
        sessionId={p.sessionId}
        metrics={p.metrics}
      />
      {/* 旧 Subtitle (兼容) — 已被 CaptionBar 取代, 但保留以便词级高亮动画 */}
      <Subtitle
        currentText={p.currentText}
        fullText={p.fullText}
        words={p.words}
        finalStartTime={p.finalStartTime}
        isRecording={isRecording}
        currentSpeaker={currentSpeaker}
        size="small"
      />
      <DebugPanel entries={p.debugLog} />
      {p.error && <div className="error-banner">❌ {p.error}<button>✕</button></div>}
    </div>
  );
}, areAppLayoutPropsEqual);

AppLayout.displayName = 'AppLayout';