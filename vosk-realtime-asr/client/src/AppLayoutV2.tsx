/**
 * AppLayoutV2 — Sprint 16 Admin Layout
 *
 * Admin-panel layout: 左菜单 + 右内容
 * Shell (TopBar + SideMenu + RightPanel) stays fixed.
 * Content area renders via children prop — mode changes only swap content.
 */
import React from 'react';
import type {
  AppStatus,
  WebSocketState,
  SessionMetrics,
  TranscriptionResult,
  Speaker,
} from './types';
import type { DebugEntry } from './hooks/useDebugLog';
import type { PodcastResult } from './hooks/usePodcastGeneration';
import type { AppMode } from './components/ModeTabs';
import { TopBar } from './components/TopBar';
import { SideMenu } from './components/SideMenu';
import { RightPanel } from './components/RightPanel';
import { formatMinutes, downloadText, defaultFilename } from './utils/exportMinutes';
import { AlertIcon, CloseIcon } from './design/icons';

export interface AppLayoutV2Props {
  /** Shell state */
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  /** TopBar props */
  status: AppStatus;
  wsState: WebSocketState;
  isRecording: boolean;
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
  ttsEnabled: boolean;
  onTtsToggle: () => void;
  bilingualEnabled: boolean;
  onBilingualToggle: () => void;
  onExport: () => void;
  onPlaySample: () => void;
  hasResults: boolean;
  /** SideMenu props */
  sessionId: string | null;
  metrics: SessionMetrics;
  /** Error */
  error: string | null;
  onDismissError?: () => void;
  /** RightPanel props */
  speakers: Speaker[];
  currentSpeakerId: string | null;
  onRenameSpeaker?: (speakerId: string, label: string) => void;
  mediaStream: MediaStream | null;
  latestAudio: Int16Array | null;
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  podcastTranscript: string;
  onPodcastGenerated: (r: PodcastResult) => void;
  podcastResult: PodcastResult | null;
  debugLog: DebugEntry[];
  resultsForExport?: TranscriptionResult[];
  onClear: () => void;
  onCopy: () => void;
  /** Content children — what renders inside the main area */
  children: React.ReactNode;
}

export const AppLayoutV2: React.FC<AppLayoutV2Props> = React.memo((p) => {
  const [rightPanelOpen, setRightPanelOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [podcastResult, setPodcastResult] = React.useState<PodcastResult | null>(p.podcastResult);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (p.podcastResult) setPodcastResult(p.podcastResult);
  }, [p.podcastResult]);

  const doExport = React.useCallback((fmt: 'txt' | 'md') => {
    if (!p.resultsForExport || p.resultsForExport.length === 0) return;
    const content = formatMinutes(p.resultsForExport, p.speakers, { format: fmt });
    const mime = fmt === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    downloadText(defaultFilename(fmt), content, mime);
    setExportOpen(false);
  }, [p.resultsForExport, p.speakers]);

  const isTranscribe = p.mode === 'transcribe';

  return (
    <div className="app-shell--v2">
      <a href="#main-content" className="skip-link">跳到主要内容</a>

      {/* === TOP BAR === */}
      <TopBar
        status={p.status}
        wsState={p.wsState}
        isRecording={p.isRecording}
        canStart={p.canStart}
        onStart={p.onStart}
        onStop={p.onStop}
        ttsEnabled={p.ttsEnabled}
        onTtsToggle={p.onTtsToggle}
        bilingualEnabled={p.bilingualEnabled}
        onBilingualToggle={p.onBilingualToggle}
        hasResults={p.hasResults}
        onExport={p.onExport}
        canPlaySample={p.canStart}
        onPlaySample={p.onPlaySample}
        compact={!isTranscribe}
        onMenuToggle={() => setMenuOpen((v) => !v)}
      />

      {/* === BODY: Sidebar + Content === */}
      <div className="app-body" data-menu-open={menuOpen ? 'true' : undefined}>
        {/* SideMenu drawer overlay (mobile) */}
        {menuOpen && (
          <div
            className="side-menu-overlay"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Sidebar Menu */}
        <SideMenu
          mode={p.mode}
          onModeChange={(m) => { p.onModeChange(m); setMenuOpen(false); }}
          sessionId={p.sessionId}
          wsState={p.wsState}
          metrics={p.metrics}
        />

        {/* Main Content */}
        <main className="app-content" id="main-content" role="main">
          {/* Error */}
          {p.error && (
            <div className="notification-strip" role="alert">
              <AlertIcon size={14} />
              <span>{p.error}</span>
              <button type="button" className="notification-strip-close"
                onClick={p.onDismissError} aria-label="关闭错误提示">
                <CloseIcon size={14} />
              </button>
            </div>
          )}

          {p.children}
        </main>

        {/* Right Tools Panel — only for transcribe mode */}
        {isTranscribe && (
          <RightPanel
            collapsed={!rightPanelOpen}
            onToggleCollapse={() => setRightPanelOpen((v) => !v)}
            speakers={p.speakers}
            currentSpeakerId={p.currentSpeakerId}
            isRecording={p.isRecording}
            onRenameSpeaker={p.onRenameSpeaker}
            metrics={p.metrics}
            status={p.status}
            wsState={p.wsState}
            mediaStream={p.mediaStream}
            latestAudio={p.latestAudio}
            bindWaveformCanvas={p.bindWaveformCanvas}
            podcastTranscript={p.podcastTranscript}
            onPodcastGenerated={(r) => { setPodcastResult(r); p.onPodcastGenerated(r); }}
            podcastResult={podcastResult}
            debugLog={p.debugLog}
            results={p.resultsForExport}
            onExport={doExport}
            exportOpen={exportOpen}
            onToggleExport={() => setExportOpen((v) => !v)}
            canPlaySample={p.canStart}
            onPlaySample={p.onPlaySample}
            hasResults={p.hasResults}
            onClear={p.onClear}
          />
        )}
      </div>
    </div>
  );
});

AppLayoutV2.displayName = 'AppLayoutV2';