/**
 * AppLayout — 纯展示组件, 接收 App 的所有派生状态, 渲染骨架
 * Author: Claude Opus 4.8
 *
 * Sprint 7 性能优化: 用 React.memo 包裹, 仅当 props 浅比较变化才重渲染
 * (App 每秒 4 次 ws partial, 但 ControlPanel 的 wsState / sessionId 不会变化)
 */
import React from 'react';
import type { AppStatus, WebSocketState, SessionMetrics, TranscriptionResult, WordInfo } from './types';
import { AppHeader } from './AppHeader';
import { ControlPanel } from './ControlPanel';
import { TranscriptionRenderer } from './TranscriptionRenderer';
import { ObservabilityPanel } from './ObservabilityPanel';
import { VisualizerPanel } from './Visualizer';
import { Subtitle } from './Subtitle';
import { DebugPanel } from './DebugPanel';
import type { DebugEntry } from './hooks/useDebugLog';
import { PerfMonitor, PerfMonitorHandle } from './PerfMonitor';

export interface AppLayoutProps {
  // 状态机
  status: AppStatus;
  wsState: WebSocketState;
  sessionId: string | null;
  error: string | null;
  // 转写
  results: TranscriptionResult[];
  currentText: string;
  fullText: string;
  words: WordInfo[];
  finalStartTime: number;
  metrics: SessionMetrics;
  // 录音
  mediaStream: MediaStream | null;
  latestAudio: Int16Array | null;
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  // 日志
  debugLog: DebugEntry[];
  // 回调
  onStart: () => void;
  onStop: () => void;
  onPlaySample: () => void;
  onClear: () => void;
  onCopy: () => void;
  // PerfMonitor handle
  perfHandleRef: React.MutableRefObject<PerfMonitorHandle | null>;
}

/**
 * 自定义比较函数: 转写数据频繁更新 (每 partial 一次),
 * 但只要核心 props (status / wsState / callbacks) 没变, 就跳过重渲染。
 * 当前已挂载的 TranscriptionRenderer / Subtitle 自身有 memo, 可以信赖。
 */
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
    prev.mediaStream === next.mediaStream &&
    prev.latestAudio === next.latestAudio &&
    prev.bindWaveformCanvas === next.bindWaveformCanvas &&
    prev.debugLog === next.debugLog &&
    prev.onStart === next.onStart &&
    prev.onStop === next.onStop &&
    prev.onPlaySample === next.onPlaySample &&
    prev.onClear === next.onClear &&
    prev.onCopy === next.onCopy &&
    prev.perfHandleRef === next.perfHandleRef
  );
}

export const AppLayout: React.FC<AppLayoutProps> = React.memo((p) => {
  const isRecording = p.status === 'recording' || p.status === 'transcribing';
  return (
    <div className="app-container">
      <a href="#main-content" className="skip-link">跳到主要内容</a>
      <AppHeader wsState={p.wsState} />
      <main id="main-content" className="app-main" role="main">
        <ControlPanel
          status={p.status} wsState={p.wsState} sessionId={p.sessionId}
          hasResults={p.results.length > 0}
          bindWaveformCanvas={p.bindWaveformCanvas}
          onStart={p.onStart} onStop={p.onStop}
          onPlaySample={p.onPlaySample} onClear={p.onClear} />
        <section className="transcription-section" aria-label="转写结果区">
          <h3>📝 转写结果</h3>
          <TranscriptionRenderer results={p.results} currentText={p.currentText} fullText={p.fullText} />
          <div className="transcription-actions">
            <button onClick={p.onCopy} disabled={!p.fullText}
              className="btn btn-copy" aria-label="复制全文到剪贴板">📋 复制全文</button>
          </div>
        </section>
        <section className="observability-section">
          <h3>📈 监控面板</h3>
          <ObservabilityPanel status={p.status} metrics={p.metrics} wsState={p.wsState} sessionId={p.sessionId} />
        </section>
      </main>
      <div style={{ padding: '0 30px 20px' }}>
        <VisualizerPanel stream={p.mediaStream} audioData={p.latestAudio} active={isRecording} />
      </div>
      <Subtitle currentText={p.currentText} fullText={p.fullText} words={p.words}
        finalStartTime={p.finalStartTime} isRecording={isRecording} />
      <DebugPanel entries={p.debugLog} />
      {p.error && <div className="error-banner">❌ {p.error}<button>✕</button></div>}
      <footer className="app-footer">
        <span>Vosk 中文模型 | 开源免费</span>
        <span>Prometheus 监控端口: 9091</span>
      </footer>
      <PerfMonitor onHandle={(h) => { p.perfHandleRef.current = h; }} defaultOpen={false} />
    </div>
  );
}, areAppLayoutPropsEqual);

AppLayout.displayName = 'AppLayout';