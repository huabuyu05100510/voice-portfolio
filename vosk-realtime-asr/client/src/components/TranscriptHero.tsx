/**
 * TranscriptHero -- Sprint 9 主工作区
 *
 * Sprint 13.2 性能优化: 限制 framer-motion 动画开销
 * - 200+ results 时只有最后 50 条使用 motion 包裹
 * - 只有最后 5 条启用 layout 动画 (O(5) vs O(n) per frame)
 * - data-performance 属性暴露可观测指标
 *
 * Author: Claude Opus 4.8 (Sprint 9)
 * Optimized: Claude Opus 4.6 (Sprint 13.2)
 */
import React, { useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TranscriptionResult, Speaker } from '../types';
import { getSpeakerColor } from '../state/transcriptionReducer';
import { splitSentences } from '../utils/splitSentences';
import { CopyIcon } from '../design/icons';

export interface TranscriptHeroProps {
  results: TranscriptionResult[];
  currentText: string;
  fullText: string;
  speakers?: Speaker[];
  onCopy: () => void;
  canCopy: boolean;
  /** Sprint 16: slot for empty state (centered RecButton + hero copy) */
  emptyStateSlot?: React.ReactNode;
  /** Sprint 16: slot for CaptionBar + BilingualCaption children */
  children?: React.ReactNode;
}

/** 最大使用 framer-motion 包裹的条目数 (从末尾计数) */
const MAX_MOTION_ITEMS = 50;
/** 最大使用 layout 动画的条目数 (从末尾计数, 是 MAX_MOTION_ITEMS 的子集) */
const MAX_LAYOUT_ITEMS = 5;

function formatTime(ts?: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  } catch {
    return ts;
  }
}

/** 纯渲染: 单条结果的内容 (不含外层 motion 包裹) */
function renderItemContent(
  r: TranscriptionResult,
  spk: Speaker | null | undefined,
  color: string,
  sameSpeakerAsPrev: boolean,
): React.ReactNode {
  return (
    <>
      {!sameSpeakerAsPrev && (
        <div className="transcript-item-speaker">
          <span className="speaker-dot" style={{ background: color }} aria-hidden="true" />
          <span className="speaker-name" style={{ color }}>
            {spk?.label ?? '未识别'}
          </span>
          <span className="speaker-time">{formatTime(r.timestamp)}</span>
        </div>
      )}
      <p className="transcript-item-text">
        {(() => {
          const lines = splitSentences(r.text || '');
          if (lines.length <= 1) {
            return <span>{r.text}</span>;
          }
          return lines.map((s, i) => (
            <span key={i} className="transcript-sentence" style={{ display: 'block' }}>
              {s}
            </span>
          ));
        })()}
      </p>
    </>
  );
}

export const TranscriptHero: React.FC<TranscriptHeroProps> = React.memo((p) => {
  const streamRef = useRef<HTMLDivElement>(null);
  const speakerById = useMemo(() => {
    const m = new Map<string, Speaker>();
    for (const s of p.speakers ?? []) m.set(s.id, s);
    return m;
  }, [p.speakers]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    // 仅当用户已经在底部附近时才自动滚动 (不打断阅读)
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [p.results.length, p.currentText]);

  const hasContent = p.results.length > 0 || !!p.currentText;
  const totalResults = p.results.length;

  return (
    <div className="transcript-hero">
      {!hasContent ? (
        <div className="empty-state">
          {p.emptyStateSlot}
          <div className="empty-state-headline">
            <h1>准备好，听你说</h1>
            <p>
              按下「开始录音」或快捷键 <kbd className="empty-state-kbd">Space</kbd>，
              识别引擎将实时把语音转写为文字，并自动按说话人分色显示。
            </p>
          </div>
        </div>
      ) : (
        <div className="transcript-hero-headline">
          <span className="hero-eyebrow">实时转写 · {p.results.length} 句 · {p.fullText.length} 字</span>
          <h1 className="hero-title">转写中</h1>
        </div>
      )}

      <div
        className="transcript-stream"
        ref={streamRef}
        role="log"
        aria-live="polite"
        data-performance={`motion=${MAX_MOTION_ITEMS},layout=${MAX_LAYOUT_ITEMS},visible=${totalResults}`}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {p.results.map((r, idx) => {
            const spk = r.speaker_id ? speakerById.get(r.speaker_id) : null;
            const color = r.speaker_id ? getSpeakerColor(r.speaker_id) : 'var(--text-3)';
            const prevResult = p.results[idx - 1];
            const sameSpeakerAsPrev =
              !!prevResult
              && !!prevResult.speaker_id
              && prevResult.speaker_id === r.speaker_id;
            const isLatest = idx === totalResults - 1 && !p.currentText;

            // 从末尾计算距离, 决定是否使用 motion 包裹
            const distanceFromEnd = totalResults - 1 - idx;
            const useMotion = distanceFromEnd < MAX_MOTION_ITEMS;
            const useLayout = distanceFromEnd < MAX_LAYOUT_ITEMS;

            const commonAttrs = {
              className: 'transcript-item' as const,
              'data-state': r.isFinal ? 'final' : 'partial',
              'data-speaker': spk ? 'true' : undefined,
              'data-same-prev': sameSpeakerAsPrev ? 'true' : undefined,
              'data-latest': isLatest ? 'true' : undefined,
              style: { ['--speaker-color' as string]: color },
              role: 'listitem' as const,
            };

            if (useMotion) {
              return (
                <motion.article
                  key={`r-${idx}`}
                  {...commonAttrs}
                  layout={useLayout}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  data-motion="on"
                  data-layout={useLayout ? 'on' : 'off'}
                >
                  {renderItemContent(r, spk, color, sameSpeakerAsPrev)}
                </motion.article>
              );
            }

            // 旧条目: 无 motion 包裹, 零动画开销
            return (
              <article
                key={`r-${idx}`}
                {...commonAttrs}
                data-motion="off"
              >
                {renderItemContent(r, spk, color, sameSpeakerAsPrev)}
              </article>
            );
          })}
          {p.currentText && (
            <motion.div
              key="current"
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="transcript-item"
              data-state="partial"
              data-motion="on"
              data-layout="on"
              role="listitem"
              aria-label="实时识别中"
            >
              <header className="transcript-item-head">
                <span className="transcript-item-meta">
                  <span style={{ color: 'var(--brand-500)' }}>识别中</span>
                </span>
              </header>
              <p className="transcript-item-text">{p.currentText}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 底部操作条 */}
        {p.canCopy && (
          <div style={{ marginTop: 'var(--space-6)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="action-btn"
              onClick={p.onCopy}
              aria-label="复制全文到剪贴板"
            >
              <CopyIcon size={14} />
              复制全文 ({p.fullText.length} 字)
            </button>
          </div>
        )}
      </div>
      {/* Sprint 16: CaptionBar + BilingualCaption passed as children */}
      {p.children}
    </div>
  );
});

TranscriptHero.displayName = 'TranscriptHero';
