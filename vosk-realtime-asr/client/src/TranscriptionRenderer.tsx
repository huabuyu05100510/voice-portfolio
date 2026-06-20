/**
 * 转写结果渲染组件
 * 实时显示转写文本，支持增量更新和动画效果
 *
 * Sprint 7 性能优化: React.memo + 浅比较, 减少 framer-motion 进入频率
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TranscriptionResult } from './types';

interface TranscriptionRendererProps {
  results: TranscriptionResult[];
  currentText: string;
  fullText: string;
}

export const TranscriptionRenderer: React.FC<TranscriptionRendererProps> = React.memo(({
  results,
  currentText,
  fullText,
}) => {
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
          {results.map((result, index) => (
            <motion.div
              key={`result-${index}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className={`result-item ${result.isFinal ? 'final' : 'partial'}`}
              role="listitem"
            >
              {/* 时间戳 */}
              <span className="result-time" aria-hidden="true">
                {formatTime(result.timestamp ?? '')}
              </span>

              {/* 文本内容 */}
              <span className="result-text">
                {result.text}
              </span>

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
          ))}
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

      {/* 空状态 */}
      {results.length === 0 && !currentText && (
        <div className="empty-state" role="status">
          <span>等待录音...</span>
        </div>
      )}

      {/* 全文汇总 */}
      {fullText && (
        <div className="full-text-summary" aria-label="全文汇总">
          <h4>全文汇总</h4>
          <p className="full-text">{fullText}</p>
          <div className="text-stats">
            <span>字数: {fullText.length}</span>
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

export default TranscriptionRenderer;