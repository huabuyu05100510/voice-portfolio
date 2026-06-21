/**
 * TranscriptHero — Sprint 9 主工作区
 *
 * Author: Claude Opus 4.8
 */
import React, { useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TranscriptionResult, Speaker } from '../types';

const PALETTE = [
  'var(--spk-1)', 'var(--spk-2)', 'var(--spk-3)',
  'var(--spk-4)', 'var(--spk-5)', 'var(--spk-6)',
];

export interface TranscriptHeroProps {
  results: TranscriptionResult[];
  currentText: string;
  fullText: string;
  speakers?: Speaker[];
  onCopy: () => void;
  canCopy: boolean;
}

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

  return (
    <div className="transcript-hero">
      {!hasContent ? (
        <div className="transcript-hero-headline">
          <span className="hero-eyebrow">火山引擎 · 流式分角色实时转写</span>
          <h1 className="hero-title">准备好,听你说</h1>
          <p className="hero-subtitle">
            按下「开始录音」或快捷键 <kbd className="statusbar-key">Space</kbd>,
            识别引擎将实时把语音转写为文字, 并自动按说话人分色显示。
          </p>
        </div>
      ) : (
        <div className="transcript-hero-headline">
          <span className="hero-eyebrow">实时转写 · {p.results.length} 句 · {p.fullText.length} 字</span>
          <h1 className="hero-title">转写中</h1>
        </div>
      )}

      <div className="transcript-stream" ref={streamRef} role="log" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          {p.results.map((r, idx) => {
            const spk = r.speaker_id ? speakerById.get(r.speaker_id) : null;
            const spkIdx = spk ? (p.speakers?.findIndex((s) => s.id === r.speaker_id) ?? 0) : 0;
            const color = PALETTE[spkIdx % PALETTE.length];
            return (
              <motion.article
                key={`r-${idx}-${r.text?.slice(0, 12)}`}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="transcript-item"
                data-state={r.isFinal ? 'final' : 'partial'}
                data-speaker={spk ? 'true' : undefined}
                style={{ ['--speaker-color' as string]: color }}
                role="listitem"
              >
                <header className="transcript-item-head">
                  <span className="speaker-avatar" style={{ background: color, width: 24, height: 24, fontSize: 11 }}>
                    {spk?.label?.slice(0, 1) ?? '·'}
                  </span>
                  <span className="transcript-item-meta">
                    <span style={{ color }}>{spk?.label ?? '未知说话人'}</span>
                    <span>·</span>
                    <span>{formatTime(r.timestamp)}</span>
                    {r.latency != null && (
                      <>
                        <span>·</span>
                        <span>{r.latency.toFixed(0)} ms</span>
                      </>
                    )}
                  </span>
                </header>
                <p className="transcript-item-text">{r.text}</p>
              </motion.article>
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
              <span aria-hidden="true">📋</span>
              复制全文 ({p.fullText.length} 字)
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

TranscriptHero.displayName = 'TranscriptHero';