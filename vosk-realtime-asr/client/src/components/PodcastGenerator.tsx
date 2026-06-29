/**
 * PodcastGenerator — 播客生成面板
 *
 * - 输入: 会议转写文本 (来自 transcription state)
 * - 选项: 风格 / 长度 / 是否包含原声片段
 * - 状态: idle / loading / success / error / running(progress)
 * - 输出: 触发 onGenerated(result) 让父组件挂载 PodcastPlayer
 *
 * 设计语言: Apple Podcasts / Spotify
 * - 卡片式输入区
 * - 风格下拉 + 长度 radio + 原声 checkbox
 * - 主按钮 (生成播客) + 进度条 + 错误重试
 */
import React, { useEffect, useMemo, useState } from 'react';
import { usePodcastGeneration, type PodcastStyle, type PodcastDuration } from '../hooks/usePodcastGeneration';

export interface PodcastGeneratorProps {
  /** 会议转写文本 (从父组件拿) */
  transcript: string;
  /** 自定义 fetch (测试用) */
  fetcher?: typeof fetch;
  /** 生成成功后回调 (父组件挂载 PodcastPlayer) */
  onGenerated?: (result: import('../hooks/usePodcastGeneration').PodcastResult) => void;
}

const STYLE_OPTIONS: { id: PodcastStyle; label: string; description: string }[] = [
  { id: 'tech', label: '科技', description: '聚焦技术原理与产品创新' },
  { id: 'business', label: '商业', description: '聚焦市场趋势与商业策略' },
  { id: 'entertainment', label: '娱乐', description: '轻松幽默, 大众科普' },
  { id: 'academic', label: '学术', description: '严谨结构化, 研究汇报' },
];

const DURATION_OPTIONS: { id: PodcastDuration; label: string; sub: string }[] = [
  { id: 'short', label: '短', sub: '约 1 分钟' },
  { id: 'medium', label: '中', sub: '约 3 分钟' },
  { id: 'long', label: '长', sub: '约 6 分钟' },
];

function PodcastGeneratorImpl({
  transcript,
  fetcher,
  onGenerated,
}: PodcastGeneratorProps): React.ReactElement {
  const [style, setStyle] = useState<PodcastStyle>('tech');
  const [duration, setDuration] = useState<PodcastDuration>('short');
  const [includeAudioClip, setIncludeAudioClip] = useState(false);
  const [overriddenTranscript, setOverriddenTranscript] = useState<string | null>(null);

  const effectiveTranscript = overriddenTranscript ?? transcript;

  const { state, result, error, progress, submit, cancel, retry } = usePodcastGeneration({
    fetcher,
  });

  // 成功后通知父组件
  useEffect(() => {
    if (state === 'success' && result && onGenerated) {
      onGenerated(result);
    }
  }, [state, result, onGenerated]);

  const transcriptStats = useMemo(() => {
    const t = effectiveTranscript || '';
    return {
      chars: t.length,
      words: t.trim() ? t.trim().split(/\s+/).length : 0,
    };
  }, [effectiveTranscript]);

  const canSubmit = state === 'idle' || state === 'error' || state === 'success';
  const isBusy = state === 'submitting' || state === 'running';

  return (
    <section className="podcast-generator" aria-label="播客生成面板">
      <header className="podcast-generator-header">
        <h3>AI 播客摘要</h3>
        <p className="podcast-generator-sub">
          把会议转写交给两位 AI 主持, 生成可听的播客式摘要
        </p>
      </header>

      {/* 转写文本来源 / 预览 */}
      <div className="podcast-transcript">
        <div className="podcast-transcript-meta">
          <span>会议转写</span>
          <span className="podcast-transcript-stats">
            {transcriptStats.chars} 字 · {transcriptStats.words} 词
          </span>
        </div>
        <textarea
          className="podcast-transcript-input"
          value={effectiveTranscript}
          onChange={(e) => setOverriddenTranscript(e.target.value)}
          placeholder="从实时转写自动填充, 也可粘贴或编辑..."
          rows={5}
          aria-label="会议转写文本"
          data-testid="podcast-transcript"
        />
      </div>

      {/* 风格 */}
      <fieldset className="podcast-fieldset">
        <legend>风格</legend>
        <div className="podcast-style-grid">
          {STYLE_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={`podcast-style-card ${style === opt.id ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="podcast-style"
                value={opt.id}
                checked={style === opt.id}
                onChange={() => setStyle(opt.id)}
                data-testid={`podcast-style-${opt.id}`}
              />
              <span className="podcast-style-label">{opt.label}</span>
              <span className="podcast-style-desc">{opt.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 长度 */}
      <fieldset className="podcast-fieldset">
        <legend>长度</legend>
        <div className="podcast-duration-row" role="radiogroup" aria-label="长度">
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={duration === opt.id}
              className={`podcast-duration-chip ${duration === opt.id ? 'is-active' : ''}`}
              onClick={() => setDuration(opt.id)}
              data-testid={`podcast-duration-${opt.id}`}
            >
              <span className="podcast-duration-label">{opt.label}</span>
              <span className="podcast-duration-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* 原声片段 */}
      <label className="podcast-checkbox">
        <input
          type="checkbox"
          checked={includeAudioClip}
          onChange={(e) => setIncludeAudioClip(e.target.checked)}
          data-testid="podcast-include-clip"
        />
        <span>在播客中穿插原声片段 (会议录音 highlight)</span>
      </label>

      {/* 进度 / 错误 */}
      {state === 'running' && (
        <div className="podcast-progress-block" role="status">
          <div className="podcast-progress-text">
            正在生成播客... {Math.round(progress * 100)}%
          </div>
          <div className="podcast-progress-bar-outer">
            <div
              className="podcast-progress-bar-inner"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <button
            type="button"
            className="podcast-btn podcast-btn-ghost"
            onClick={cancel}
            data-testid="podcast-cancel"
          >
            取消
          </button>
        </div>
      )}

      {state === 'error' && error && (
        <div className="podcast-error" role="alert">
          <span>{error.message}</span>
          {error.retryable && (
            <button
              type="button"
              className="podcast-btn podcast-btn-ghost"
              onClick={retry}
              data-testid="podcast-retry"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* 主按钮 */}
      <div className="podcast-actions">
        <button
          type="button"
          className="podcast-btn podcast-btn-primary"
          onClick={() =>
            submit({
              transcript: effectiveTranscript,
              style,
              duration,
              includeAudioClip,
            })
          }
          disabled={!canSubmit || !effectiveTranscript.trim() || isBusy}
          data-testid="podcast-generate"
        >
          {state === 'submitting' ? '提交中...' : '生成播客'}
        </button>
      </div>
    </section>
  );
}

export const PodcastGenerator = React.memo(PodcastGeneratorImpl);
PodcastGenerator.displayName = 'PodcastGenerator';

export default PodcastGenerator;