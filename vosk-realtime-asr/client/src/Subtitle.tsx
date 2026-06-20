/**
 * Subtitle 字幕组件 — 发布会风格
 *
 * 设计参考: Apple WWDC / Google I/O / TED Talks / 央视新闻
 * - 大字白色 + 黑色描边 + 软阴影
 * - 单句居中显示, 句末渐隐换新句
 * - 上一句保留半透明在下方
 * - 句中词级高亮 (按 timeline 推进)
 * - 句首可选 speaker 标签
 *
 * Author: Claude Opus 4.8
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WordInfo } from './types';
import { findActiveWordIndex } from './subtitleKaraoke';

export interface SubtitleProps {
  currentText: string;     // 当前 partial
  fullText: string;        // 累计 final
  words?: WordInfo[];      // 词级时间戳
  finalStartTime: number;  // 当前 final 段起点 (performance.now)
  isRecording: boolean;
  speakerLabel?: string;   // 说话人标签
  /** 字号等级: large(发布会议) / normal(默认) / small(会议聊天) */
  size?: 'large' | 'normal' | 'small';
}

interface Sentence {
  id: string;
  text: string;
  words: WordInfo[];
  spokenAt: number;  // 第一词开始时间 (finalStartTime + words[0].start)
}

export const Subtitle: React.FC<SubtitleProps> = ({
  currentText,
  words,
  finalStartTime,
  isRecording,
  speakerLabel,
  size = 'large',
}) => {
  // 当前高亮词 + 进度 (rAF 驱动)
  const [activeIdx, setActiveIdx] = useState(-1);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    if (!words || words.length === 0 || !isRecording) {
      setActiveIdx(-1);
      setProgress(0);
      rafRef.current = null;
      return;
    }
    const now = performance.now();
    const elapsed = (now - finalStartTime) / 1000;
    const idx = findActiveWordIndex(words, elapsed);
    const w = idx >= 0 && idx < words.length ? words[idx] : undefined;
    const p = w && w.end > w.start ? Math.min(1, (elapsed - w.start) / (w.end - w.start)) : 0;
    setActiveIdx(idx);
    setProgress(p);
    rafRef.current = requestAnimationFrame(tick);
  }, [words, finalStartTime, isRecording]);

  useEffect(() => {
    if (!words?.length || !isRecording) {
      setActiveIdx(-1);
      setProgress(0);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [words, isRecording, tick]);

  // 当前 final 段切句 (按标点)
  const currentSentence = useMemo<Sentence | null>(() => {
    if (words && words.length > 0) {
      return {
        id: 'current-final',
        text: words.map(w => w.word).join(''),
        words,
        spokenAt: finalStartTime + (words[0]?.start || 0) * 1000,
      };
    }
    if (currentText) {
      return { id: 'partial', text: currentText, words: [], spokenAt: Date.now() };
    }
    return null;
  }, [words, currentText, finalStartTime]);

  const fontSize = size === 'large' ? 32 : size === 'small' ? 18 : 24;
  const lineHeight = 1.35;

  return (
    <div
      className="subtitle-overlay"
      role="region"
      aria-label="实时字幕"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '40px',
        transform: 'translateX(-50%)',
        width: 'min(960px, 92vw)',
        padding: '20px 32px',
        background:
          'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0) 100%)',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {/* 说话人标签 (可选) */}
      {speakerLabel && (
        <div
          style={{
            display: 'inline-block',
            marginBottom: 12,
            padding: '4px 14px',
            background: 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: 999,
            color: '#e0e0e0',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.04em',
            backdropFilter: 'blur(8px)',
          }}
        >
          🎙 {speakerLabel}
        </div>
      )}

      {/* 空状态 */}
      {isRecording && !currentSentence && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 18,
            fontStyle: 'italic',
          }}
        >
          🎙 正在聆听...
        </motion.div>
      )}

      {/* 当前句 (大字) */}
      <AnimatePresence mode="wait">
        {currentSentence && (
          <motion.div
            key={currentSentence.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            style={{
              fontSize,
              fontWeight: 600,
              lineHeight,
              color: '#fff',
              textShadow:
                '0 0 1px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)',
              WebkitTextStroke: '0.6px rgba(0,0,0,0.55)',
              letterSpacing: '0.01em',
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
            }}
          >
            {currentSentence.words.length > 0 ? (
              // 词级高亮 (按 timing 推进)
              <span style={{ display: 'inline' }}>
                {currentSentence.words.map((w, i) => {
                  const isActive = i === activeIdx;
                  const isPast = i < activeIdx;
                  return (
                    <span
                      key={i}
                      style={{
                        display: 'inline-block',
                        marginRight: 1,
                        color: isActive ? '#00d4ff' : isPast ? 'rgba(255,255,255,0.55)' : '#fff',
                        textShadow: isActive
                          ? '0 0 12px rgba(0, 212, 255, 0.85), 0 0 1px rgba(0,0,0,0.9)'
                          : undefined,
                        transition: 'color 80ms linear',
                      }}
                    >
                      {w.word}
                    </span>
                  );
                })}
                {/* 进度条: 当前词下方一根细线, 0→100% 表示词内进度 */}
                {activeIdx >= 0 && currentSentence.words[activeIdx] && (
                  <motion.div
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 80,
                      height: 2,
                      background: 'rgba(255,255,255,0.15)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${progress * 100}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #00d4ff, #7c3aed)',
                        transition: 'width 60ms linear',
                      }}
                    />
                  </motion.div>
                )}
              </span>
            ) : (
              // partial 阶段: 整句高亮, 句末加闪烁
              <span>
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ marginRight: 8, color: '#00d4ff', fontSize: fontSize * 0.7 }}
                >
                  ●
                </motion.span>
                {currentSentence.text}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Subtitle;
