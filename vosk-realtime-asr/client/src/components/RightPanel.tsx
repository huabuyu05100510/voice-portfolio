/**
 * RightPanel — Sprint 16 Layout Restructuring
 *
 * Collapsible right-side tabbed panel replacing the old left Sidebar.
 * Tabs: 说话人 (Speakers) | 工具 (Tools) | 监控 (Monitor)
 *
 * Accepts slots for podcast player / export to avoid prop explosion.
 */
import React, { useState } from 'react';
import type {
  SessionMetrics,
  Speaker,
  TranscriptionResult,
} from '../types';
import type { IconProps } from '../design/icons';
import {
  UsersIcon,
  SettingsIcon,
  ChartIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
  DownloadIcon,
  FileTextIcon,
  TrashIcon,
  MusicIcon,
} from '../design/icons';
import { SpeakerList } from './SpeakerList';
import { MetricGrid } from './MetricGrid';
import { VisualizerPanel } from '../Visualizer';
import { DebugPanel } from '../DebugPanel';
import { PodcastGenerator } from './PodcastGenerator';
import { PodcastPlayer } from './PodcastPlayer';
import type { PodcastResult } from '../hooks/usePodcastGeneration';

type PanelTab = 'speakers' | 'tools' | 'monitor';

export interface RightPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Speakers */
  speakers: Speaker[];
  currentSpeakerId: string | null;
  isRecording: boolean;
  onRenameSpeaker?: (speakerId: string, label: string) => void;
  /** Metrics */
  metrics: SessionMetrics;
  status: string;
  wsState: string;
  /** Visualizer */
  mediaStream: MediaStream | null;
  latestAudio: Int16Array | null;
  bindWaveformCanvas: (el: HTMLCanvasElement | null) => void;
  /** Tools — Podcast */
  podcastTranscript: string;
  onPodcastGenerated: (r: PodcastResult) => void;
  podcastResult: PodcastResult | null;
  /** Debug */
  debugLog: any[];
  /** Export */
  results?: TranscriptionResult[];
  onExport: (format: 'txt' | 'md') => void;
  exportOpen: boolean;
  onToggleExport: () => void;
  /** Sample audio */
  canPlaySample: boolean;
  onPlaySample: () => void;
  /** Clear */
  hasResults: boolean;
  onClear: () => void;
}

const TABS: { id: PanelTab; label: string; icon: React.FC<IconProps> }[] = [
  { id: 'speakers', label: '说话人', icon: UsersIcon },
  { id: 'tools', label: '工具', icon: SettingsIcon },
  { id: 'monitor', label: '监控', icon: ChartIcon },
];

export const RightPanel: React.FC<RightPanelProps> = React.memo((p) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('speakers');

  if (p.collapsed) {
    return (
      <aside className="right-panel right-panel--collapsed" aria-label="侧边栏(已折叠)" data-testid="right-panel">
        <button
          type="button"
          className="right-panel-toggle"
          onClick={p.onToggleCollapse}
          aria-label="展开侧边栏"
          title="展开侧边栏"
          style={{ position: 'absolute', top: 12, right: -36 }}
        >
          <PanelRightIcon size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="right-panel" aria-label="侧边栏" data-testid="right-panel">
      {/* Header */}
      <div className="right-panel-header">
        <span style={{ fontSize: 'var(--font-caption)', fontWeight: 600, color: 'var(--text-2)' }}>
          {TABS.find((t) => t.id === activeTab)?.label}
        </span>
        <button
          type="button"
          className="right-panel-toggle"
          onClick={p.onToggleCollapse}
          aria-label="收起侧边栏"
          title="收起侧边栏"
        >
          <PanelRightCloseIcon size={16} />
        </button>
      </div>

      {/* Tabs */}
      <nav className="right-panel-tabs" role="tablist" aria-label="侧边栏功能">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`right-panel-tab${activeTab === t.id ? ' right-panel-tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <t.icon size={14} />
            <span style={{ marginLeft: 4 }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="right-panel-content">
        {/* Speakers Tab */}
        <div style={{ display: activeTab === 'speakers' ? 'contents' : 'none' }}>
          <div className="right-panel-section">
            <SpeakerList
              speakers={p.speakers}
              currentSpeakerId={p.currentSpeakerId}
              isRecording={p.isRecording}
              onRenameSpeaker={p.onRenameSpeaker}
            />
          </div>
        </div>

        {/* Tools Tab */}
        <div style={{ display: activeTab === 'tools' ? 'contents' : 'none' }}>
          <div className="right-panel-section">
            {/* Sample + Clear */}
            <div style={{ display: 'flex', gap: 8 }}>
              {p.canPlaySample && (
                <button
                  type="button"
                  className="action-btn"
                  onClick={p.onPlaySample}
                  disabled={p.isRecording}
                  aria-label="测试示例音频 (快捷键 M)"
                >
                  <MusicIcon size={14} />
                  <span style={{ marginLeft: 4 }}>示例音频</span>
                </button>
              )}
              <button
                type="button"
                className="action-btn"
                onClick={p.onClear}
                disabled={!p.hasResults}
                aria-label="清除转写结果 (快捷键 R)"
              >
                <TrashIcon size={14} />
                <span style={{ marginLeft: 4 }}>清除</span>
              </button>
            </div>

            {/* Export */}
            {p.results && p.results.length > 0 && (
              <div>
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={p.onToggleExport}
                  disabled={p.isRecording}
                  aria-expanded={p.exportOpen}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <DownloadIcon size={14} />
                  <span style={{ marginLeft: 4 }}>导出纪要 ({p.results.length} 句)</span>
                </button>
                {p.exportOpen && (
                  <div className="export-menu" role="menu" style={{ marginTop: 4 }}>
                    <button type="button" role="menuitem" className="export-menu-item" onClick={() => p.onExport('txt')}>
                      <FileTextIcon size={14} />
                      <span style={{ marginLeft: 4 }}>导出 TXT</span>
                    </button>
                    <button type="button" role="menuitem" className="export-menu-item" onClick={() => p.onExport('md')}>
                      <FileTextIcon size={14} />
                      <span style={{ marginLeft: 4 }}>导出 Markdown</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Podcast Generator */}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h4 className="right-panel-section-title">
                <ChartIcon size={12} />
                AI 播客生成
              </h4>
              <PodcastGenerator
                transcript={p.podcastTranscript}
                onGenerated={p.onPodcastGenerated}
              />
              {p.podcastResult && <PodcastPlayer result={p.podcastResult} />}
            </div>
          </div>
        </div>

        {/* Monitor Tab */}
        <div style={{ display: activeTab === 'monitor' ? 'contents' : 'none' }}>
          <div className="right-panel-section">
            <h4 className="right-panel-section-title">
              <ChartIcon size={12} />
              性能指标
            </h4>
            <MetricGrid metrics={p.metrics} status={p.status as any} wsState={p.wsState as any} />

            <h4 className="right-panel-section-title" style={{ marginTop: 'var(--space-4)' }}>
              <ChartIcon size={12} />
              音频波形
            </h4>
            <VisualizerPanel
              stream={p.mediaStream}
              audioData={p.latestAudio}
              active={p.isRecording}
            />

            <h4 className="right-panel-section-title" style={{ marginTop: 'var(--space-4)' }}>
              <ChartIcon size={12} />
              调试日志
            </h4>
            <DebugPanel entries={p.debugLog} />
          </div>
        </div>
      </div>
    </aside>
  );
});

RightPanel.displayName = 'RightPanel';
