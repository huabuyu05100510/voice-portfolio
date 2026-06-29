/**
 * LanguageSelector — 语言对选择器
 *
 * 设计:
 *   - 两个 dropdown: 源语言 / 目标语言
 *   - 切换时自动 emit clearCache (避免旧 pair 缓存命中)
 *   - 与 translationReducer.setLangPair 配合使用
 *
 * Author: MiniMax-M3
 */
import React from 'react';
import { SUPPORTED_LANG_PAIRS, type LangPairPreset } from '../state/translationReducer';

export interface LanguageSelectorProps {
  sourceLang: string;
  targetLang: string;
  onChange: (source: string, target: string) => void;
  /** 禁用 (例如离线 fallback) */
  disabled?: boolean;
  /** 紧凑模式 (用于 sidebar) */
  compact?: boolean;
  ariaLabel?: string;
}

/** 全语言列表 (按预设聚合) */
function buildAllLangs(): { code: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const p of SUPPORTED_LANG_PAIRS) {
    if (!seen.has(p.source)) seen.set(p.source, p.sourceLabel);
    if (!seen.has(p.target)) seen.set(p.target, p.targetLabel);
  }
  return Array.from(seen, ([code, label]) => ({ code, label })).sort((a, b) =>
    a.label.localeCompare(b.label, 'zh'),
  );
}

const ALL_LANGS = buildAllLangs();

export const LanguageSelector: React.FC<LanguageSelectorProps> = (p) => {
  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    p.onChange(e.target.value, p.targetLang);
  };

  const handleTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    p.onChange(p.sourceLang, e.target.value);
  };

  const handleSwap = () => {
    p.onChange(p.targetLang, p.sourceLang);
  };

  return (
    <div
      className={`language-selector ${p.compact ? 'language-selector--compact' : ''}`}
      data-disabled={p.disabled ? 'true' : 'false'}
      role="group"
      aria-label={p.ariaLabel ?? '语言对选择'}
    >
      <select
        className="language-selector-source"
        value={p.sourceLang}
        onChange={handleSourceChange}
        disabled={p.disabled}
        aria-label="源语言"
      >
        {ALL_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="language-selector-swap"
        onClick={handleSwap}
        disabled={p.disabled}
        aria-label="交换源语言与目标语言"
        title="交换"
      >
        ⇄
      </button>

      <select
        className="language-selector-target"
        value={p.targetLang}
        onChange={handleTargetChange}
        disabled={p.disabled}
        aria-label="目标语言"
      >
        {ALL_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
};

LanguageSelector.displayName = 'LanguageSelector';

export type { LangPairPreset };