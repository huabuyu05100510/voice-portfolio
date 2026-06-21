/**
 * 转写结果渲染组件
 * 实时显示转写文本，支持增量更新和动画效果
 *
 * Sprint 7 性能优化: React.memo + 浅比较, 减少 framer-motion 进入频率
 * 火山引擎升级: 按 speaker_id 分色 (左侧色条 + 徽章), utterances[] 分段展示
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TranscriptionResult, Speaker, Utterance } from './types';

interface TranscriptionRendererProps {
  results: TranscriptionResult[];
  currentText: string;
  fullText: string;
  /** 火山引擎分角色: 全部已出现的说话人 */
  speakers?: Speaker[];
}

export const TranscriptionRenderer: React.FC<TranscriptionRendererProps> = React.memo(({
  results,
  currentText,
  fullText,
  speakers,
}) => {
  // id → speaker 索引, 用于按结果查色
  const speakerById = useMemo(() => {
    const m = new Map<string, Speaker>();
    for (const s of speakers ?? []) m.set(s.id, s);
    return m;
  }, [speakers]);

  return (
    <div className="transcription-container">
      {/* 转写结果列表 */}
      <div
        className="results-list"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
        aria-label="转写结果日志"
      >
        <AnimatePresence mode="popLayout">
          {results.map((result, index) => {
            const spk = result.speaker_id ? speakerById.get(result.speaker_id) : null;
            const spkColor = spk?.color || 'transparent';
            return (
              <motion.div
                key={`result-${index}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`result-item ${result.isFinal ? 'final' : 'partial'}`}
                role="listitem"
                style={{
                  borderLeft: spk ? `3px solid ${spkColor}` : undefined,
                  paddingLeft: spk ? 10 : undefined,
                }}
              >
                {/* 时间戳 */}
                <span className="result-time" aria-hidden="true">
                  {formatTime(result.timestamp ?? '')}
                </span>

                {/* 说话人徽章 (火山引擎分角色) */}
                {spk && (
                  <span
                    className="result-speaker"
                    style={{
                      background: `${spkColor}22`,
                      color: spkColor,
                      border: `1px solid ${spkColor}66`,
                    }}
                    aria-label={`说话人: ${spk.label}`}
                  >
                    🎙 {spk.label}
                  </span>
                )}

                {/* 文本内容 */}
                <span className="result-text">
                  {result.text}
                </span>

                {/* 词级时间戳 (展开) */}
                {result.isFinal && result.utterances && result.utterances.length > 0 && (
                  <UtteranceDetails utterances={result.utterances} speakerById={speakerById} />
                )}

                {/* 延迟指示 */}
                {result.latency && (
                  <span className="result-latency" aria-label={`延迟 ${result.latency.toFixed(0)} 毫秒`}>
                    {result.latency.toFixed(0)}ms
                  </span>
                )}

                {/* 最终标记 */}
                {result.isFinal && (
                  <span className="result-final-mark" aria-label="已确认">✓</span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* 当前部分结果（实时显示） */}
        {currentText && (
          <motion.div
            key="current"
            initial={{ opacity: 0.5 }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="result-item current"
            role="listitem"
            aria-label="实时识别中"
          >
            <span className="result-indicator" aria-hidden="true">●</span>
            <span className="result-text" aria-live="polite">{currentText}</span>
          </motion.div>
        )}
      </div>

      {/* 空状态 — Sprint 8 增强 */}
      {results.length === 0 && !currentText && (
        <div className="empty-state" role="status">
          <svg
            className="empty-orbit"
            viewBox="0 0 120 120"
            aria-hidden="true"
          >
            <circle className="orbit-ring" cx="60" cy="60" r="44" />
            <circle className="orbit-ring-2" cx="60" cy="60" r="30" />
            <circle className="orbit-core" cx="60" cy="60" r="6" />
            <circle className="orbit-dot" cx="60" cy="16" r="3" />
          </svg>
          <p className="empty-hint">
            点击「开始录音」或按 <kbd>Space</kbd> 键启动识别
          </p>
          <p className="empty-sub">
            声波抵达后,识别引擎将实时转写为文字并按说话人分色显示
          </p>
        </div>
      )}

      {/* 全文汇总 */}
      {fullText && (
        <div className="full-text-summary" aria-label="全文汇总">
          <h4>全文汇总</h4>
          <p className="full-text">{fullText}</p>
          <div className="text-stats">
            <span>字数: {fullText.length}</span>
            {speakers && speakers.length > 0 && (
              <span> · 说话人: {speakers.length}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

TranscriptionRenderer.displayName = 'TranscriptionRenderer';

/**
 * 格式化时间
 */
function formatTime(timestamp: string): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * UtteranceDetails — 展开的火山引擎分段 (final 时显示)
 * 每段一个色块, 词级时间戳折叠在 tooltip 或 inline
 */
const UtteranceDetails: React.FC<{
  utterances: Utterance[];
  speakerById: Map<string, Speaker>;
}> = React.memo(({ utterances, speakerById }) => {
  return (
    <div className="utterance-details" style={{ display: 'block', width: '100%', marginTop: 6 }}>
      {utterances.map((u, idx) => {
        const spk = speakerById.get(u.speaker_id);
        const color = spk?.color || '#888';
        return (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '2px 0',
              fontSize: 12,
              opacity: 0.85,
            }}
          >
            <span style={{ color, fontWeight: 600, minWidth: 56 }}>
              {spk?.label || u.speaker_id}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.6)', minWidth: 70, fontVariantNumeric: 'tabular-nums' }}>
              {(u.start_time / 1000).toFixed(2)}s → {(u.end_time / 1000).toFixed(2)}s
            </span>
            <span style={{ flex: 1, color: 'rgba(255,255,255,0.85)' }}>{u.text}</span>
          </div>
        );
      })}
    </div>
  );
});
UtteranceDetails.displayName = 'UtteranceDetails';

export default TranscriptionRenderer;
