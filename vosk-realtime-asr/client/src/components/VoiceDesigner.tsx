/**
 * VoiceDesigner — 音色设计器主面板
 *
 * UI 布局 (左右双栏 + 中间):
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Header: "音色设计 — 让 AI 生成你专属的声音"             │
 * ├──────────────┬──────────────────────┬─────────────────────────┤
 * │ 参数面板     │ 文本输入 + 试听      │ 波形 + 播放控制        │
 * │ - gender    │ <textarea>           │ <canvas> 波形           │
 * │ - age       │ [试听] [保存音色]    │ <audio> 控件           │
 * │ - emotion   │                      │ [保存音色] 弹窗         │
 * │ - style     │                      │                         │
 * │ - speed     │                      │                         │
 * │ - pitch     │                      │                         │
 * │ - volume    │                      │                         │
 * │ + Presets   │                      │                         │
 * └──────────────┴──────────────────────┴─────────────────────────┘
 *
 * 设计要点:
 * - 全部状态由 useVoiceDesign hook 管理 (单参状态)
 * - Slider 自定义样式 (轨道 + 拇指 + 当前值气泡)
 * - 预设面板: VoiceDesignPresets 子组件
 * - 保存音色: 模态框, 含音色名 + 描述
 * - 可观测: console.log [VoiceDesign] on generate / save (正式接入 OTel 由后续 agent 完成)
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  useVoiceDesign,
  GENDERS, AGES, EMOTIONS, STYLES,
  SPEED_RANGE, PITCH_RANGE, VOLUME_RANGE,
  DEFAULT_VOICE_PARAMS,
  type Gender, type Age, type Emotion, type Style,
} from '../hooks/useVoiceDesign';
import { VoiceDesignPresets } from './VoiceDesignPresets';

export interface VoiceDesignerProps {
  /** 初次加载时自动应用的预设 id (可选) */
  initialPresetId?: string;
  /** 自定义类名 */
  className?: string;
}

export const VoiceDesigner: React.FC<VoiceDesignerProps> = (p) => {
  const {
    params, presets, isGenerating, lastResult, isSaving, error, savedVoiceId,
    updateParam, applyPreset, generate, saveVoice, reset,
    loadPresets, loadSeedVoices,
  } = useVoiceDesign();

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [voiceDesc, setVoiceDesc] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // 初次加载应用预设 + 从服务端拉取最新预设 / seed-voices
  useEffect(() => {
    if (p.initialPresetId) {
      applyPreset(p.initialPresetId);
    }
    void loadPresets();
    void loadSeedVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lastResult 更新 → 渲染音频 + 画波形
  useEffect(() => {
    if (!lastResult?.ok || !lastResult.audio_base64) {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      return;
    }
    // base64 → Blob → object URL
    if (audioUrlRef.current) {
      safeRevokeObjectURL(audioUrlRef.current);
    }
    const bytes = base64ToBytes(lastResult.audio_base64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' });
    const url = safeCreateObjectURL(blob);
    audioUrlRef.current = url;
    if (audioRef.current && url) {
      audioRef.current.src = url;
      audioRef.current.load();
    }
    // 画波形
    void drawWaveformFromBase64(lastResult.audio_base64);
  }, [lastResult]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) safeRevokeObjectURL(audioUrlRef.current);
    };
  }, []);

  // ====== Handlers ======
  const handleGenerate = async () => {
    // eslint-disable-next-line no-console
    console.info('[VoiceDesign] generate', {
      params: {
        gender: params.gender, age: params.age, emotion: params.emotion,
        style: params.style, speed: params.speed, pitch: params.pitch,
        volume: params.volume, text_len: params.text.length,
      },
    });
    await generate();
  };

  const handleSave = async () => {
    if (!voiceName.trim()) return;
    // eslint-disable-next-line no-console
    console.info('[VoiceDesign] save', { voice_name: voiceName });
    const r = await saveVoice({
      voice_name: voiceName.trim(),
      sample_audio: lastResult?.audio_base64 || '',
      description: voiceDesc.trim(),
      preview_text: params.text,
    });
    if (r?.ok) {
      // 1.5s 后自动关闭
      setTimeout(() => {
        setShowSaveModal(false);
        setVoiceName('');
        setVoiceDesc('');
      }, 1500);
    }
  };

  const handleReset = () => {
    reset();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  };

  // ====== Waveform drawing ======
  const drawWaveformFromBase64 = async (b64: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // 伪波形: 从 base64 抽样绘制 (不解析 mp3)
    const bytes = base64ToBytes(b64);
    const samples = 200;
    const step = Math.max(1, Math.floor(bytes.length / samples));
    const mid = h / 2;
    ctx.strokeStyle = '#5b8def';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * w;
      const idx = i * step;
      const v = bytes[idx % bytes.length] / 255;  // 0..1
      const amp = (v - 0.5) * h * 0.9;
      ctx.moveTo(x, mid);
      ctx.lineTo(x, mid + amp);
    }
    ctx.stroke();
  };

  return (
    <div className={`voice-designer ${p.className || ''}`}>
      <header className="vd-header">
        <h2 className="vd-title">音色设计</h2>
        <p className="vd-subtitle">通过参数调节生成专属声音, 试听后可保存为自定义 voice_id</p>
      </header>

      <div className="vd-grid">
        {/* ==== 左栏: 参数 + 预设 ==== */}
        <section className="vd-params" aria-label="音色参数">
          {/* 预设 */}
          <VoiceDesignPresets onApply={applyPreset} customPresets={presets} />

          <fieldset className="vd-fieldset">
            <legend>性别</legend>
            <div className="vd-radio-group" role="radiogroup">
              {GENDERS.map((g) => (
                <label key={g} className={`vd-radio ${params.gender === g ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="gender"
                    value={g}
                    checked={params.gender === g}
                    onChange={() => updateParam('gender', g as Gender)}
                    aria-label={`gender-${g}`}
                  />
                  <span>{g === 'female' ? '女' : '男'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="vd-fieldset">
            <legend>年龄</legend>
            <div className="vd-chip-group" role="radiogroup">
              {AGES.map((a) => (
                <label key={a} className={`vd-chip ${params.age === a ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="age"
                    value={a}
                    checked={params.age === a}
                    onChange={() => updateParam('age', a as Age)}
                  />
                  <span>{ageLabel(a)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="vd-fieldset">
            <legend>情感</legend>
            <div className="vd-chip-group" role="radiogroup">
              {EMOTIONS.map((e) => (
                <label key={e} className={`vd-chip ${params.emotion === e ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="emotion"
                    value={e}
                    checked={params.emotion === e}
                    onChange={() => updateParam('emotion', e as Emotion)}
                  />
                  <span>{emotionLabel(e)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="vd-fieldset">
            <legend>风格</legend>
            <div className="vd-chip-group" role="radiogroup">
              {STYLES.map((s) => (
                <label key={s} className={`vd-chip ${params.style === s ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="style"
                    value={s}
                    checked={params.style === s}
                    onChange={() => updateParam('style', s as Style)}
                  />
                  <span>{styleLabel(s)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="vd-fieldset">
            <legend>语速 {params.speed.toFixed(2)}x</legend>
            <input
              type="range"
              min={SPEED_RANGE[0]}
              max={SPEED_RANGE[1]}
              step={0.05}
              value={params.speed}
              onChange={(e) => updateParam('speed', Number(e.target.value))}
              aria-label="speed"
              className="vd-slider"
            />
          </fieldset>

          <fieldset className="vd-fieldset">
            <legend>音调 {params.pitch.toFixed(2)}x</legend>
            <input
              type="range"
              min={PITCH_RANGE[0]}
              max={PITCH_RANGE[1]}
              step={0.05}
              value={params.pitch}
              onChange={(e) => updateParam('pitch', Number(e.target.value))}
              aria-label="pitch"
              className="vd-slider"
            />
          </fieldset>

          <fieldset className="vd-fieldset">
            <legend>音量 {params.volume}</legend>
            <input
              type="range"
              min={VOLUME_RANGE[0]}
              max={VOLUME_RANGE[1]}
              step={1}
              value={params.volume}
              onChange={(e) => updateParam('volume', Number(e.target.value))}
              aria-label="volume"
              className="vd-slider"
            />
          </fieldset>

          <button
            type="button"
            className="vd-reset-btn"
            onClick={handleReset}
          >
            重置参数
          </button>
        </section>

        {/* ==== 中栏: 文本输入 + 操作 ==== */}
        <section className="vd-input" aria-label="合成文本">
          <label htmlFor="vd-textarea" className="vd-input-label">
            试听文本 ({params.text.length}/{DEFAULT_VOICE_PARAMS && 300})
          </label>
          <textarea
            id="vd-textarea"
            className="vd-textarea"
            placeholder="输入要合成的文本 (最多 300 字)"
            value={params.text}
            onChange={(e) => updateParam('text', e.target.value)}
            maxLength={300}
            rows={6}
          />
          <div className="vd-actions">
            <button
              type="button"
              className="vd-generate-btn"
              onClick={handleGenerate}
              disabled={isGenerating || !params.text.trim()}
              aria-busy={isGenerating}
            >
              {isGenerating ? '生成中…' : '试听生成'}
            </button>
            <button
              type="button"
              className="vd-save-btn"
              onClick={() => setShowSaveModal(true)}
              disabled={!lastResult?.ok || isSaving}
            >
              保存音色
            </button>
          </div>
          {error && (
            <div className="vd-error" role="alert">
              {(error as any).field
                ? `${(error as any).field}: ${(error as any).message}`
                : ((error as any).message || '生成失败')}
            </div>
          )}
          {savedVoiceId && (
            <div className="vd-success" role="status">
              已保存为 voice_id: <code>{savedVoiceId}</code>
            </div>
          )}
        </section>

        {/* ==== 右栏: 波形 + 播放控制 ==== */}
        <section className="vd-preview" aria-label="波形预览">
          <canvas
            ref={canvasRef}
            width={420}
            height={120}
            className="vd-waveform"
            aria-label="音频波形"
          />
          <audio
            ref={audioRef}
            controls
            className="vd-audio"
            aria-label="试听播放器"
          />
          {lastResult?.ok && (
            <div className="vd-meta">
              时长: <strong>{(lastResult.duration_ms || 0) / 1000}s</strong>
              {' · '}采样率: <strong>{lastResult.sample_rate}Hz</strong>
            </div>
          )}
          {!lastResult && (
            <div className="vd-empty">调整参数 + 点击 "试听生成" 生成音频</div>
          )}
        </section>
      </div>

      {/* ==== 保存音色模态框 ==== */}
      {showSaveModal && (
        <div className="vd-modal-backdrop" role="dialog" aria-modal="true" aria-label="保存音色">
          <div className="vd-modal">
            <h3 className="vd-modal-title">保存自定义音色</h3>
            <div className="vd-modal-field">
              <label htmlFor="vd-voice-name" className="vd-modal-label">音色名</label>
              <input
                id="vd-voice-name"
                type="text"
                className="vd-modal-input"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                placeholder="例如: 我的主播音色"
                aria-label="音色名"
                autoFocus
              />
            </div>
            <div className="vd-modal-field">
              <label htmlFor="vd-voice-desc" className="vd-modal-label">描述 (可选)</label>
              <textarea
                id="vd-voice-desc"
                className="vd-modal-input"
                value={voiceDesc}
                onChange={(e) => setVoiceDesc(e.target.value)}
                placeholder="音色特点 / 适用场景"
                rows={3}
                aria-label="音色描述"
              />
            </div>
            {savedVoiceId ? (
              <div className="vd-success" role="status">
                已保存: <code>{savedVoiceId}</code>
              </div>
            ) : (
              <div className="vd-modal-actions">
                <button
                  type="button"
                  className="vd-cancel-btn"
                  onClick={() => setShowSaveModal(false)}
                  disabled={isSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="vd-confirm-btn"
                  onClick={handleSave}
                  disabled={!voiceName.trim() || isSaving}
                  aria-busy={isSaving}
                >
                  {isSaving ? '保存中…' : '确认保存'}
                </button>
              </div>
            )}
            {error && !savedVoiceId && (
              <div className="vd-error" role="alert">
                {(error as any).message || '保存失败'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

VoiceDesigner.displayName = 'VoiceDesigner';

// ============================================================================
// 工具: base64 → Uint8Array
// ============================================================================
function base64ToBytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/** jsdom 下 URL.createObjectURL 不存在, 用 dataURL 兜底 */
function safeCreateObjectURL(blob: Blob): string | null {
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(blob);
    }
    // 退路: 用 FileReader (同步转 dataURL)
    return null;
  } catch {
    return null;
  }
}

function safeRevokeObjectURL(url: string | null): void {
  if (!url) return;
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    /* noop */
  }
}

// ============================================================================
// 文案 label
// ============================================================================
function ageLabel(a: string): string {
  switch (a) {
    case 'child': return '儿童';
    case 'young': return '青年';
    case 'middle-aged': return '中年';
    case 'senior': return '老年';
    default: return a;
  }
}

function emotionLabel(e: string): string {
  switch (e) {
    case 'neutral': return '中性';
    case 'happy': return '开心';
    case 'sad': return '悲伤';
    case 'angry': return '愤怒';
    case 'surprised': return '惊讶';
    case 'fearful': return '害怕';
    case 'disgusted': return '厌恶';
    default: return e;
  }
}

function styleLabel(s: string): string {
  switch (s) {
    case 'assistant': return '助手';
    case 'narrator': return '叙述';
    case 'chat': return '聊天';
    case 'news': return '新闻';
    case 'advertisement': return '广告';
    case 'storyteller': return '故事';
    case 'customer_service': return '客服';
    case 'game': return '游戏';
    default: return s;
  }
}