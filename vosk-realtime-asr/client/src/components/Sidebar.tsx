/**
 * Sidebar — Sprint 9
 * 左侧工作区, 收纳: 录音控制 / 说话人列表 / 监控指标 / 可视化
 * 替代旧的 ControlPanel + ObservabilityPanel + 折叠的 VisualizerPanel
 *
 * 模块 C (2026-06-27): 加 ProfileToggle UI (纯净模式 / 会议模式)
 *
 * Author: Claude Opus 4.8 (模块 C: MiniMax-M3)
 */
import React, { useState } from 'react';
import type {
  AppStatus, WebSocketState, SessionMetrics, Speaker, TranscriptionResult,
  AudioProfileId,
} from '../types';
import { AUDIO_PROFILES } from '../types';
import { RecordingButton } from './RecordingButton';
import { SpeakerList } from './SpeakerList';
import { MetricGrid } from './MetricGrid';
import { ProfileToggle } from './ProfileToggle';
import { VisualizerPanel } from '../Visualizer';
import { formatMinutes, downloadText, defaultFilename } from '../utils/exportMinutes';

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
  /** 说话人重命名 (会议室场景) */
  onRenameSpeaker?: (speakerId: string, label: string) => void;
  /** 导出纪要用的转写结果 (不传则不显示导出按钮) */
  results?: TranscriptionResult[];
  /** 音频 profile 切换回调 (模块 C) */
  onProfileChange?: (id: AudioProfileId) => void;
  /** 当前激活的 profile id (模块 C) */
  profile?: AudioProfileId;
  /** 声音复刻 2.0 入口 (可选, 2026-06-27) */
  onOpenVoiceCloning?: () => void;
  /** 当前激活的 voice_id (有则显示徽章) */
  activeVoiceId?: string | null;
}

export const Sidebar: React.FC<SidebarProps> = React.memo((p) => {
  const isRecording = p.status === 'recording' || p.status === 'transcribing';
  const isConnected = p.wsState === 'connected';
  const canStart = p.status === 'ready' && isConnected;
  const [exportOpen, setExportOpen] = useState(false);

  const doExport = (fmt: 'txt' | 'md') => {
    if (!p.results || p.results.length === 0) return;
    const content = formatMinutes(p.results, p.speakers, { format: fmt });
    const mime = fmt === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    downloadText(defaultFilename(fmt), content, mime);
    setExportOpen(false);
  };

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
          <ProfileToggle
            value={p.profile ?? 'meeting'}
            disabled={isRecording}
            onChange={p.onProfileChange}
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
          {/* 会议室: 导出纪要 — TXT / Markdown, 录音结束后可用 */}
          {p.results && p.results.length > 0 && (
            <div className="export-group">
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={() => setExportOpen((v) => !v)}
                disabled={isRecording}
                aria-expanded={exportOpen}
                aria-label="导出会议纪要"
              >
                <span aria-hidden="true">📤</span>
                导出纪要 ({p.results.length} 句)
              </button>
              {exportOpen && (
                <div className="export-menu" role="menu">
                  <button type="button" role="menuitem" className="export-menu-item" onClick={() => doExport('txt')}>
                    <span aria-hidden="true">📄</span> 导出 TXT
                  </button>
                  <button type="button" role="menuitem" className="export-menu-item" onClick={() => doExport('md')}>
                    <span aria-hidden="true">📑</span> 导出 Markdown
                  </button>
                </div>
              )}
            </div>
          )}
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
          onRenameSpeaker={p.onRenameSpeaker}
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

      {/* 声音复刻 2.0 入口 (可选, 仅当 consumer 提供回调时渲染) */}
      {p.onOpenVoiceCloning && (
        <section className="sidebar-section">
          <button
            type="button"
            className="voice-cloning-entry"
            onClick={p.onOpenVoiceCloning}
            aria-label="打开声音复刻 2.0"
            data-testid="voice-cloning-entry"
          >
            <span className="voice-cloning-entry-icon" aria-hidden="true">
              ♪
            </span>
            <span className="voice-cloning-entry-text">
              <span className="voice-cloning-entry-title">声音复刻 2.0</span>
              <span className="voice-cloning-entry-sub">
                {p.activeVoiceId
                  ? `当前: ${p.activeVoiceId}`
                  : '录制专属音色'}
              </span>
            </span>
            {p.activeVoiceId ? (
              <span className="voice-cloning-entry-badge">已激活</span>
            ) : (
              <span className="voice-cloning-entry-badge">NEW</span>
            )}
          </button>
        </section>
      )}
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';