/**
 * CaptionBar -- Sprint 9 浮动字幕 (Sprint 12 卡拉OK 升级)
 *
 * Sprint 13.3 性能优化: DOM 密集型卡拉OK → 零重渲染 O(1) attribute swap
 * - useMemo 创建稳定 span 元素 (keyed by data-word-index)
 * - rAF tick 直接操作 DOM (data-active-idx + data-progress + .is-active/.is-past 类名交换)
 * - 避免每帧 O(n_words) React 重渲染 + DOM 属性更新
 *
 * Author: Sprint 9 -- Claude Opus 4.8
 * 升级: Sprint 12 卡拉OK -- Claude Opus 4.6 (模块 A)
 * 优化: Sprint 13.3 DOM 优化 -- Claude Opus 4.6
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Speaker, WordInfo } from '../types';
import { getSpeakerColor } from '../state/transcriptionReducer';
import { findActiveWordIndex, computeWordProgress } from '../subtitleKaraoke';

export interface CaptionBarProps {
  currentText: string;
  fullText: string;
  currentSpeaker?: Speaker | null;
  isRecording: boolean;
  /** 词级时间戳 -- 仅 final 段有, partial 阶段为空 */
  words?: WordInfo[];
  /** final 段起始时间戳 (ms, performance.now 时间域) */
  finalStartTime?: number;
  /** 外部强制开关 -- 留 prop 是为了父组件未来控制 (默认 true) */
  karaokeEnabled?: boolean;
}

const CaptionBarInner: React.FC<CaptionBarProps> = (p) => {
  const text = p.currentText || p.fullText.split(/[。？！\n]/).slice(-1)[0] || '';
  const empty = !text;
  const spkColor = p.currentSpeaker?.color || (p.currentSpeaker?.id ? getSpeakerColor(p.currentSpeaker.id) : 'var(--spk-1)');

  // 内部 K 键开关 -- 用户可独立于父组件控制
  const [internalKaraoke, setInternalKaraoke] = useState<boolean>(true);
  // 优先级: 父组件 prop 关闭时强制 false, 否则取内部状态
  const karaokeEnabled = p.karaokeEnabled !== false && internalKaraoke;

  // K 键监听 (只在 CaptionBar mounted 且不在表单 focus 时)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setInternalKaraoke((v) => !v);
        // 同时触发自定义事件, 让 PerfMonitor/其他订阅者联动 (PerfMonitor 加 partialHz)
        if (typeof document !== 'undefined') {
          document.dispatchEvent(new CustomEvent('vosk:shortcut:toggle-karaoke', { detail: { next: !karaokeEnabled } }));
        }
        // 结构化日志: 便于追踪 K 键切换
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.log('[CaptionBar] karaoke toggle', { next: !karaokeEnabled });
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [karaokeEnabled]);

  // ============================================================================
  // Sprint 13.3: 稳定 span 元素 (useMemo), 只随 words 变化重建
  // ============================================================================
  const hasWords = !!p.words && p.words.length > 0 && p.finalStartTime != null;

  const karaokeSpans = useMemo(() => {
    if (!hasWords || !karaokeEnabled) return null;
    const words = p.words as WordInfo[];
    return words.map((w, i) => (
      <span
        key={i}
        data-word-index={i}
        className="transcript-word"
      >
        {w.word}
        {/* 静态进度条 span: useMemo 中创建一次, rAF 不重建; width 由 CSS --progress 驱动 */}
        <span className="word-progress" />
      </span>
    ));
  }, [p.words, hasWords, karaokeEnabled]);

  // ============================================================================
  // Sprint 13.3: Refs for O(1) direct DOM manipulation in rAF tick
  // ============================================================================
  const karaokeWrapperRef = useRef<HTMLSpanElement | null>(null);
  const prevActiveIdxRef = useRef<number>(-1);
  const rafRef = useRef<number | null>(null);

  // Sprint 13.3: rAF tick -- 仅更新 data-active-idx + data-progress + 类名交换 (O(1))
  const tick = useCallback(() => {
    if (!hasWords || !karaokeEnabled) {
      const wrapper = karaokeWrapperRef.current;
      if (wrapper) {
        wrapper.removeAttribute('data-active-idx');
        wrapper.removeAttribute('data-progress');
        // 清除所有 is-active / is-past 类名
        const allWords = wrapper.querySelectorAll('.transcript-word');
        allWords.forEach((el) => {
          el.classList.remove('is-active', 'is-past');
          el.removeAttribute('data-progress');
        });
      }
      prevActiveIdxRef.current = -1;
      rafRef.current = null;
      return;
    }

    const words = p.words as WordInfo[];
    const elapsed = (performance.now() - (p.finalStartTime as number)) / 1000;
    const idx = findActiveWordIndex(words, elapsed);
    const prog = idx >= 0 && idx < words.length
      ? computeWordProgress(words[idx], elapsed) : 0;

    const wrapper = karaokeWrapperRef.current;
    if (!wrapper) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // 1. 更新 wrapper data-active-idx (O(1))
    wrapper.setAttribute('data-active-idx', String(idx));
    wrapper.setAttribute('data-progress', prog.toFixed(3));

    // 2. 如果 active word 索引变化 → 交换类名 (O(1) normally, O(skip) on jump)
    if (prevActiveIdxRef.current !== idx) {
      const prevIdx = prevActiveIdxRef.current;
      // 旧 active 变 is-past
      if (prevIdx >= 0 && prevIdx < words.length) {
        const prevEl = wrapper.querySelector(
          `.transcript-word[data-word-index="${prevIdx}"]`,
        );
        if (prevEl) {
          prevEl.classList.remove('is-active');
          prevEl.classList.add('is-past');
          prevEl.removeAttribute('data-progress');
          (prevEl as HTMLElement).style.removeProperty('--progress');
        }
      }
      // 中间跳过的词: 从未 active, 但已经被说话声"覆盖" → 标记 is-past
      const startIdx = Math.max(-1, prevIdx);
      for (let j = startIdx + 1; j < idx && j < words.length; j++) {
        const midEl = wrapper.querySelector(
          `.transcript-word[data-word-index="${j}"]`,
        );
        if (midEl) {
          midEl.classList.add('is-past');
        }
      }
      // 新 active 加上 is-active
      if (idx >= 0 && idx < words.length) {
        const curEl = wrapper.querySelector(
          `.transcript-word[data-word-index="${idx}"]`,
        );
        if (curEl) {
          curEl.classList.add('is-active');
        }
      }
      prevActiveIdxRef.current = idx;
    }

    // 3. 更新当前 active word 的 data-progress 和 CSS --progress (O(1))
    if (idx >= 0 && idx < words.length) {
      const activeEl = wrapper.querySelector(
        `.transcript-word[data-word-index="${idx}"]`,
      ) as HTMLElement | null;
      if (activeEl) {
        activeEl.setAttribute('data-progress', prog.toFixed(3));
        // 设置 CSS custom property 给 ::after 和 .word-progress span
        activeEl.style.setProperty('--progress', prog.toFixed(3));
        // 同时更新 .word-progress span 宽度 (向后兼容 e2e 测试)
        const progressSpan = activeEl.querySelector('.word-progress') as HTMLElement | null;
        if (progressSpan) {
          progressSpan.style.width = `${prog * 100}%`;
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [p.words, p.finalStartTime, hasWords, karaokeEnabled]);

  // 启动/停止 rAF 循环
  useEffect(() => {
    if (!hasWords || !karaokeEnabled) {
      // 清理状态
      const wrapper = karaokeWrapperRef.current;
      if (wrapper) {
        wrapper.removeAttribute('data-active-idx');
        wrapper.removeAttribute('data-progress');
      }
      prevActiveIdxRef.current = -1;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [tick, hasWords, karaokeEnabled]);

  return (
    <div
      className="caption-bar"
      data-empty={empty}
      data-karaoke={karaokeEnabled && hasWords ? 'on' : 'off'}
      role="region"
      aria-label="实时字幕"
      aria-live="polite"
      style={{ ['--speaker-color' as string]: spkColor }}
    >
      {p.currentSpeaker && !empty && (
        <span className="caption-speaker" style={{ color: spkColor, background: `color-mix(in srgb, ${spkColor} 16%, transparent)`, borderColor: spkColor }}>
          {p.currentSpeaker.label}
        </span>
      )}
      <span className="caption-text">
        {empty
          ? (p.isRecording ? '正在聆听…' : '等待开始录音…')
          : (karaokeEnabled && hasWords && karaokeSpans
              ? (
                <span
                  className="karaoke"
                  ref={karaokeWrapperRef}
                  data-active-idx="-1"
                  data-progress="0.000"
                >
                  {karaokeSpans}
                </span>
              )
              : text)}
      </span>
    </div>
  );
};

export const CaptionBar: React.FC<CaptionBarProps> = React.memo(CaptionBarInner);
CaptionBar.displayName = 'CaptionBar';