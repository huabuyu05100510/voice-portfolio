/**
 * Subtitle 字幕组件 — 发布会风格 (分角色升级版)
 *
 * 设计参考: Apple WWDC / Google I/O / TED Talks / 央视新闻
 * - 大字白色 + 黑色描边 + 软阴影
 * - 单句居中显示, 句末渐隐换新句
 * - 上一句保留半透明在下方
 * - 句中词级高亮 (按 timeline 推进)
 * - 句首 speaker 标签 + 配色 (火山引擎分角色)
 *
 * Author: Claude Opus 4.8
 * 火山引擎升级: currentSpeaker (id/label/color) — 高亮 + 句首徽章
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WordInfo, Speaker } from './types';
import { findActiveWordIndex } from './subtitleKaraoke';

export interface SubtitleProps {
  currentText: string;
  fullText: string;
  words?: WordInfo[];
  finalStartTime: number;
  isRecording: boolean;
  /** 当前句子的说话人 (id/label/color) — 火山引擎分角色 */
  currentSpeaker?: Speaker | null;
  /** 字号等级: large(发布会议) / normal(默认) / small(会议聊天) */
  size?: 'large' | 'normal' | 'small';
}

interface Sentence {
  id: string;
  text: string;
  words: WordInfo[];
  spokenAt: number;
}

export const Subtitle: React.FC<SubtitleProps> = ({
  currentText,
  words,
  finalStartTime,
  isRecording,
  currentSpeaker,
  size = 'large',
}) => {
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
  const speakerColor = currentSpeaker?.color || '#00d4ff';

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
      {/* 说话人徽章 (按 speaker 配色) */}
      <AnimatePresence mode="wait">
        {currentSpeaker && (
          <motion.div
            key={currentSpeaker.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            style={{
              display: 'inline-block',
              marginBottom: 12,
              padding: '4px 14px',
              background: `linear-gradient(135deg, ${speakerColor}33, ${speakerColor}11)`,
              border: `1px solid ${speakerColor}66`,
              borderRadius: 999,
              color: speakerColor,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.04em',
              backdropFilter: 'blur(8px)',
              boxShadow: `0 0 18px ${speakerColor}33`,
            }}
            aria-label={`当前说话人: ${currentSpeaker.label}`}
          >
            🎙 {currentSpeaker.label}
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* 当前句 (大字, 按 speaker 配色描边) */}
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
                "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
            }}
          >
            {currentSentence.words.length > 0 ? (
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
                        color: isActive ? speakerColor : isPast ? 'rgba(255,255,255,0.55)' : '#fff',
                        textShadow: isActive
                          ? `0 0 12px ${speakerColor}cc, 0 0 1px rgba(0,0,0,0.9)`
                          : undefined,
                        transition: 'color 80ms linear',
                      }}
                    >
                      {w.word}
                    </span>
                  );
                })}
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
                        background: `linear-gradient(90deg, ${speakerColor}, ${speakerColor}99)`,
                        transition: 'width 60ms linear',
                      }}
                    />
                  </motion.div>
                )}
              </span>
            ) : (
              <span>
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ marginRight: 8, color: speakerColor, fontSize: fontSize * 0.7 }}
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
