/**
 * VoiceDesignPresets — 音色预设卡片列表
 *
 * UI:
 * ┌────────────────────────────┐
 * │ [icon] 名称                │
 * │ 描述                       │
 * │       [一键应用]            │
 * └────────────────────────────┘
 *
 * 键盘可达: Enter / Space 触发 onApply.
 */
import React from 'react';
import { PRESETS, type VoicePreset } from '../hooks/useVoiceDesign';

export interface VoiceDesignPresetsProps {
  /** 应用预设回调 (传入 preset.id) */
  onApply: (presetId: string) => void;
  /** 自定义预设列表 (覆盖默认 PRESETS) */
  customPresets?: VoicePreset[];
  /** 自定义类名 */
  className?: string;
}

export const VoiceDesignPresets: React.FC<VoiceDesignPresetsProps> = (p) => {
  const list = p.customPresets || PRESETS;
  return (
    <section className={`vd-presets ${p.className || ''}`} aria-label="音色预设">
      <h3 className="vd-section-title">一键预设</h3>
      <div className="vd-preset-grid">
        {list.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className="vd-preset-card"
            onClick={() => p.onApply(preset.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                p.onApply(preset.id);
              }
            }}
            aria-label={`应用预设: ${preset.name}`}
            title={`应用 ${preset.name}`}
          >
            <div className="vd-preset-icon" aria-hidden="true">
              {presetIcon(preset.icon || preset.id)}
            </div>
            <div className="vd-preset-body">
              <h4 className="vd-preset-name">{preset.name}</h4>
              <p className="vd-preset-desc">{preset.description}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};

VoiceDesignPresets.displayName = 'VoiceDesignPresets';

// ============================================================================
// 图标 fallback (用首字 / emoji-free 字符)
// ============================================================================
function presetIcon(key: string): string {
  switch (key) {
    case 'news':
    case 'news_anchor':
    case 'mature_news':
      return '新';
    case 'heart':
    case 'gentle_female':
      return '柔';
    case 'mic':
    case 'magnetic_male':
      return '麦';
    case 'star':
    case 'child':
      return '童';
    case 'bolt':
    case 'energetic_young':
      return '活';
    case 'shield':
      return '权';
    default:
      return key.charAt(0).toUpperCase();
  }
}