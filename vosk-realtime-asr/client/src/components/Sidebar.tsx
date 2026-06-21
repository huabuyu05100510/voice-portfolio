/**
 * Sidebar — Sprint 9
 * 左侧工作区, 收纳: 录音控制 / 说话人列表 / 监控指标 / 可视化
 * 替代旧的 ControlPanel + ObservabilityPanel + 折叠的 VisualizerPanel
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type {
  AppStatus, WebSocketState, SessionMetrics, Speaker,
} from '../types';
import { RecordingButton } from './RecordingButton';
import { SpeakerList } from './SpeakerList';
import { MetricGrid } from './MetricGrid';
import { VisualizerPanel } from '../Visualizer';

export interface SidebarProps {
  status: AppStatus;
  wsState: WebSocketState;
  sessionId: string | null;
  hasResults: boolean;
  speakers: Speaker[];
  currentSpeakerId: string | null;
  metrics: SessionMetrics;
  mediaStream: MediaStream | null;
  latestAudio: Int16Array | null;
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  onStart: () => void;
  onStop: () => void;
  onPlaySample: () => void;
  onClear: () => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo((p) => {
  const isRecording = p.status === 'recording' || p.status === 'transcribing';
  const isConnected = p.wsState === 'connected';
  const canStart = p.status === 'ready' && isConnected;

  return (
    <aside className="app-sidebar" aria-label="控制与监控">
      {/* 录音控制 */}
      <section className="sidebar-section">
        <h4 className="sidebar-section-title">
          <span className="emoji" aria-hidden="true">🎙</span>
          录音
        </h4>
        <div className="recording-control">
          <RecordingButton
            state={p.status}
            isRecording={isRecording}
            disabled={!canStart && !isRecording}
            onStart={p.onStart}
            onStop={p.onStop}
          />
          <div className="action-row">
            <button
              type="button"
              className="action-btn"
              onClick={p.onPlaySample}
              disabled={isRecording || !isConnected}
              aria-label="测试示例音频 (快捷键 M)"
            >
              <span aria-hidden="true">🎵</span>
              示例音频
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={p.onClear}
              disabled={!p.hasResults}
              aria-label="清除转写结果 (快捷键 R)"
            >
              <span aria-hidden="true">🗑</span>
              清除
            </button>
          </div>
        </div>
      </section>

      {/* 说话人列表 */}
      <section className="sidebar-section">
        <h4 className="sidebar-section-title">
          <span className="emoji" aria-hidden="true">🗣</span>
          说话人 ({p.speakers.length})
        </h4>
        <SpeakerList
          speakers={p.speakers}
          currentSpeakerId={p.currentSpeakerId}
          isRecording={isRecording}
        />
      </section>

      {/* 监控指标 */}
      <section className="sidebar-section">
        <h4 className="sidebar-section-title">
          <span className="emoji" aria-hidden="true">📊</span>
          指标
        </h4>
        <MetricGrid metrics={p.metrics} status={p.status} wsState={p.wsState} />
      </section>

      {/* 可视化 (折叠) */}
      <section className="sidebar-section" style={{ marginTop: 'auto' }}>
        <VisualizerPanel
          stream={p.mediaStream}
          audioData={p.latestAudio}
          active={isRecording}
        />
      </section>
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';