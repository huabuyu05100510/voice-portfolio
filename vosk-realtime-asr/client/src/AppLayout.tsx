/**
 * AppLayout — Sprint 9 Workbench 布局
 *
 * ┌─ Header ────────────────────────────────────────────┐
 * ├─ Sidebar ─┬─ Hero (live transcript) ────────────────┤
 * │  控制     │                                          │
 * │  说话人   │  Podcast 摘要 (新增)                    │
 * │  监控     │                                          │
 * │  可视化   │                                          │
 * ├───────────┴──────────────────────────────────────────┤
 * └─ Status Bar ────────────────────────────────────────┘
 *
 * Author: Claude Opus 4.8
 * Sprint 14 (MiniMax-M3): 在 Hero 下方挂载播客生成 / 播放模块
 */
import React, { useState } from 'react';
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
import { DebugPanel } from './DebugPanel';
import { PodcastGenerator } from './components/PodcastGenerator';
import { PodcastPlayer } from './components/PodcastPlayer';
import type { PodcastResult } from './hooks/usePodcastGeneration';
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
  /** 说话人重命名 */
  onRenameSpeaker?: (speakerId: string, label: string) => void;
  /** 导出用的全部 results (会议室场景) */
  resultsForExport?: TranscriptionResult[];
  /** 关闭错误提示 */
  onDismissError?: () => void;
  /** Sprint 15 (MiniMax-M3): 同声传译 2.0 — 是否挂载 BilingualCaption 槽位 */
  bilingualEnabled?: boolean;
  /** Sprint 15 (MiniMax-M3): 已渲染好的 BilingualCaption 节点 (父组件负责 hook) */
  bilingualCaption?: React.ReactNode;
  /** Sprint 15 (MiniMax-M3): 已渲染好的 LanguageSelector 节点 */
  bilingualLanguageSelector?: React.ReactNode;
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
    prev.onCopy === next.onCopy &&
    prev.onRenameSpeaker === next.onRenameSpeaker &&
    prev.resultsForExport === next.resultsForExport &&
    prev.onDismissError === next.onDismissError &&
    prev.bilingualEnabled === next.bilingualEnabled &&
    prev.bilingualCaption === next.bilingualCaption &&
    prev.bilingualLanguageSelector === next.bilingualLanguageSelector
  );
}

export const AppLayout: React.FC<AppLayoutProps> = React.memo((p) => {
  const isRecording = p.status === 'recording' || p.status === 'transcribing';
  const currentSpeaker = p.currentSpeakerId
    ? p.speakers.find((s) => s.id === p.currentSpeakerId) ?? null
    : null;
  // Sprint 14 (MiniMax-M3): 播客生成结果, 成功后才挂载播放器
  const [podcastResult, setPodcastResult] = useState<PodcastResult | null>(null);
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
        onRenameSpeaker={p.onRenameSpeaker}
        results={p.resultsForExport}
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
        {/* Sprint 15 (MiniMax-M3): 同声传译 2.0 — 双语字幕槽位 (零侵入, 默认关闭) */}
        {p.bilingualEnabled && (
          <div className="app-bilingual-slot" data-bilingual-mounted="true">
            {p.bilingualLanguageSelector}
            {p.bilingualCaption}
          </div>
        )}
        {/* Sprint 14: 语音播客大模型 (Podcast LLM) 模块 — 零侵入挂载 */}
        <PodcastGenerator
          transcript={p.fullText}
          onGenerated={(r) => setPodcastResult(r)}
        />
        {podcastResult && <PodcastPlayer result={podcastResult} />}
      </main>
      <StatusBar
        wsState={p.wsState}
        status={p.status}
        sessionId={p.sessionId}
        metrics={p.metrics}
      />
      {/* 会议室场景: 主视图 = TranscriptHero (历史流) + CaptionBar (当前句摘要) */}
      <DebugPanel entries={p.debugLog} />
      {p.error && (
        <div className="error-banner" role="alert">
          <span>❌ {p.error}</span>
          <button
            type="button"
            onClick={p.onDismissError}
            aria-label="关闭错误提示"
            className="error-banner-close"
          >✕</button>
        </div>
      )}
    </div>
  );
}, areAppLayoutPropsEqual);

AppLayout.displayName = 'AppLayout';