/**
 * BilingualCaption — Netflix 风格双行字幕
 *
 * 设计:
 *   - 上行: 源语言 (灰色背景, 较低视觉权重)
 *   - 下行: 目标语言 (深色背景 + 强调色高亮)
 *   - rows: 已对齐的历史字幕, 倒序 (最新在前)
 *   - partial*: 当前行未完成的部分, 顶部高亮显示
 *   - fontSize / position: 用户可调 (CSS 驱动)
 *
 * Author: MiniMax-M3
 */
import React from 'react';
import type { AlignedRow } from '../state/translationReducer';

export type BilingualFontSize = 'small' | 'medium' | 'large';
export type BilingualPosition = 'top' | 'middle' | 'bottom';

export interface BilingualCaptionProps {
  rows: AlignedRow[];
  partialSource: string;
  partialTarget: string;
  sourceLang: string;
  targetLang: string;
  /** 网络 / API 断开 → fallback 到 source-only */
  fallbackMode?: boolean;
  /** socket 是否连接 */
  translationConnected?: boolean;
  /** 字号 (CSS class) */
  fontSize?: BilingualFontSize;
  /** 字幕位置 */
  position?: BilingualPosition;
  /** 历史行最大保留数 (防止长会话 DOM 节点爆炸) */
  maxRows?: number;
  /** ARIA live 区域 */
  ariaLabel?: string;
}

const FONT_CLASS: Record<BilingualFontSize, string> = {
  small: 'bilingual-size-small',
  medium: 'bilingual-size-medium',
  large: 'bilingual-size-large',
};

const POSITION_CLASS: Record<BilingualPosition, string> = {
  top: 'bilingual-position-top',
  middle: 'bilingual-position-middle',
  bottom: 'bilingual-position-bottom',
};

export const BilingualCaption: React.FC<BilingualCaptionProps> = (p) => {
  const fontSize = p.fontSize ?? 'medium';
  const position = p.position ?? 'bottom';
  const maxRows = p.maxRows ?? 20;
  const fallback = p.fallbackMode ?? false;
  const connected = p.translationConnected ?? true;
  const ariaLabel = p.ariaLabel ?? '同声传译双语字幕';

  const empty = !p.partialSource && !p.partialTarget && p.rows.length === 0;

  // 倒序: 最新行在前 (UI 自上而下滚动)
  const visibleRows = [...p.rows].slice(-maxRows).reverse();

  return (
    <div
      className={`bilingual-caption ${FONT_CLASS[fontSize]} ${POSITION_CLASS[position]}`}
      data-empty={empty}
      data-fallback={fallback}
      data-translation-connected={connected}
      data-source-lang={p.sourceLang}
      data-target-lang={p.targetLang}
      role="region"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      {fallback && (
        <div className="bilingual-fallback-notice" role="status">
          <span className="bilingual-fallback-icon" aria-hidden="true">⏸</span>
          <span className="bilingual-fallback-text">翻译离线 · 仅显示源语言</span>
        </div>
      )}

      {/* 当前行: partial (高亮) */}
      {!empty && (p.partialSource || p.partialTarget) && (
        <div className="bilingual-row bilingual-row-current" data-row-type="current">
          <div className="bilingual-row-source" data-lang={p.sourceLang}>
            {p.partialSource || (empty ? '' : '\u00A0')}
          </div>
          {!fallback && (
            <div className="bilingual-row-target" data-lang={p.targetLang}>
              {p.partialTarget || '\u00A0'}
            </div>
          )}
        </div>
      )}

      {/* 已对齐历史行: 倒序 */}
      {visibleRows.length > 0 && (
        <ol className="bilingual-rows-history" aria-label="历史双语字幕">
          {visibleRows.map((row) => (
            <li key={row.id} className="bilingual-row" data-row-id={row.id}>
              <div className="bilingual-row-source" data-lang={p.sourceLang}>
                {row.source || '\u00A0'}
              </div>
              {!fallback && (
                <div className="bilingual-row-target" data-lang={p.targetLang}>
                  {row.target || '\u00A0'}
                </div>
              )}
              {row.latencyMs != null && !fallback && (
                <span className="bilingual-row-latency" title="翻译延迟">
                  {row.latencyMs}ms
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* 完全空态 */}
      {empty && (
        <div className="bilingual-empty-hint" role="status">
          等待翻译结果…
        </div>
      )}
    </div>
  );
};

BilingualCaption.displayName = 'BilingualCaption';