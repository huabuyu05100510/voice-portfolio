/**
 * useVoiceDesign — 音色设计 React Hook
 *
 * 提供:
 * - params (VoiceParams) 单参状态
 * - updateParam / reset / applyPreset
 * - generate() — POST /api/voice-design/generate, 返回 base64 音频
 * - saveVoice() — POST /api/voice-design/save, 把生成的音色注册成 voice_id
 * - loadPresets / loadSeedVoices
 * - lastResult / isGenerating / error 状态
 *
 * 设计要点:
 * - 默认参数集中在 DEFAULT_VOICE_PARAMS
 * - PRESETS 在客户端内置 (与服务端 PRESETS 同步, 由 loadPresets() 覆盖)
 * - 不依赖 React 上下文, 可在任意组件内使用
 */
import { useCallback, useRef, useState } from 'react';

// ============================================================================
// 类型 / 枚举
// ============================================================================
export type Gender = 'male' | 'female';
export type Age = 'child' | 'young' | 'middle-aged' | 'senior';
export type Emotion =
  | 'neutral' | 'happy' | 'sad' | 'angry'
  | 'surprised' | 'fearful' | 'disgusted';
export type Style =
  | 'assistant' | 'narrator' | 'chat' | 'news'
  | 'advertisement' | 'storyteller' | 'customer_service' | 'game';

export const GENDERS: Gender[] = ['male', 'female'];
export const AGES: Age[] = ['child', 'young', 'middle-aged', 'senior'];
export const EMOTIONS: Emotion[] = [
  'neutral', 'happy', 'sad', 'angry',
  'surprised', 'fearful', 'disgusted',
];
export const STYLES: Style[] = [
  'assistant', 'narrator', 'chat', 'news',
  'advertisement', 'storyteller', 'customer_service', 'game',
];
export const SPEED_RANGE: [number, number] = [0.5, 2.0];
export const PITCH_RANGE: [number, number] = [0.5, 2.0];
export const VOLUME_RANGE: [number, number] = [0, 10];
export const TEXT_MAX_LEN = 300;

export interface VoiceParams {
  gender: Gender;
  age: Age;
  emotion: Emotion;
  style: Style;
  speed: number;
  pitch: number;
  volume: number;
  text: string;
  /** 可选 seed voice (从火山引擎 seed-voices 列表选) */
  voice_id?: string;
}

export interface VoicePreset {
  id: string;
  name: string;
  description: string;
  icon?: string;
  gender: Gender;
  age: Age;
  emotion: Emotion;
  style: Style;
  speed: number;
  pitch: number;
  volume: number;
}

export interface VoiceDesignResult {
  ok: boolean;
  audio_base64?: string;
  duration_ms?: number;
  sample_rate?: number;
  error_code?: number;
  error_message?: string;
  field?: string;
  message?: string;
}

export interface VoiceSaveArgs {
  voice_name: string;
  sample_audio: string;  // base64
  description?: string;
  preview_text?: string;
  format?: string;
  sample_rate?: number;
}

export interface VoiceSaveResult {
  ok: boolean;
  voice_id?: string;
  error_code?: number;
  error_message?: string;
}

export interface SeedVoice {
  voice_id: string;
  name: string;
  gender: Gender;
}

// ============================================================================
// 默认值 / 预设
// ============================================================================
export const DEFAULT_VOICE_PARAMS: VoiceParams = {
  gender: 'female',
  age: 'young',
  emotion: 'neutral',
  style: 'assistant',
  speed: 1.0,
  pitch: 1.0,
  volume: 5,
  text: '',
};

export const PRESETS: VoicePreset[] = [
  {
    id: 'news_anchor',
    name: '新闻播报',
    description: '专业稳重的新闻主播风格, 节奏明快',
    icon: 'news',
    gender: 'female', age: 'middle-aged', emotion: 'neutral', style: 'news',
    speed: 1.05, pitch: 1.0, volume: 6,
  },
  {
    id: 'gentle_female',
    name: '温柔女声',
    description: '温柔亲切, 适合客服 / 陪伴场景',
    icon: 'heart',
    gender: 'female', age: 'young', emotion: 'neutral', style: 'assistant',
    speed: 0.95, pitch: 1.1, volume: 5,
  },
  {
    id: 'magnetic_male',
    name: '磁性男声',
    description: '低沉浑厚, 适合纪录片 / 广告',
    icon: 'mic',
    gender: 'male', age: 'middle-aged', emotion: 'neutral', style: 'narrator',
    speed: 0.95, pitch: 0.85, volume: 6,
  },
  {
    id: 'child',
    name: '儿童',
    description: '活泼俏皮, 适合儿童读物 / 教学',
    icon: 'star',
    gender: 'female', age: 'child', emotion: 'happy', style: 'storyteller',
    speed: 1.1, pitch: 1.3, volume: 5,
  },
  {
    id: 'energetic_young',
    name: '活力青年',
    description: '青春阳光, 适合 vlog / 短视频',
    icon: 'bolt',
    gender: 'male', age: 'young', emotion: 'happy', style: 'chat',
    speed: 1.1, pitch: 1.05, volume: 6,
  },
  {
    id: 'mature_news',
    name: '成熟男声新闻',
    description: '权威稳重, 适合财经 / 时政播报',
    icon: 'shield',
    gender: 'male', age: 'senior', emotion: 'neutral', style: 'news',
    speed: 1.0, pitch: 0.9, volume: 7,
  },
];

export const getPresetById = (id: string): VoicePreset | null =>
  PRESETS.find((p) => p.id === id) || null;

export const applyPresetToParams = (
  base: VoiceParams,
  preset: VoicePreset,
): VoiceParams => ({
  ...base,
  gender: preset.gender,
  age: preset.age,
  emotion: preset.emotion,
  style: preset.style,
  speed: preset.speed,
  pitch: preset.pitch,
  volume: preset.volume,
});

// ============================================================================
// 客户端校验
// ============================================================================
export interface ValidationError {
  field: string;
  message: string;
}

export const validateClientSide = (p: VoiceParams): ValidationError | null => {
  if (!p.text || !p.text.trim()) {
    return { field: 'text', message: '请输入要合成的文本' };
  }
  if (p.text.length > TEXT_MAX_LEN) {
    return { field: 'text', message: `文本过长, 最多 ${TEXT_MAX_LEN} 字` };
  }
  if (!GENDERS.includes(p.gender)) {
    return { field: 'gender', message: '性别参数不合法' };
  }
  if (!AGES.includes(p.age)) {
    return { field: 'age', message: '年龄参数不合法' };
  }
  if (!EMOTIONS.includes(p.emotion)) {
    return { field: 'emotion', message: '情感参数不合法' };
  }
  if (!STYLES.includes(p.style)) {
    return { field: 'style', message: '风格参数不合法' };
  }
  if (p.speed < SPEED_RANGE[0] || p.speed > SPEED_RANGE[1]) {
    return { field: 'speed', message: `语速必须在 ${SPEED_RANGE[0]} ~ ${SPEED_RANGE[1]}` };
  }
  if (p.pitch < PITCH_RANGE[0] || p.pitch > PITCH_RANGE[1]) {
    return { field: 'pitch', message: `音调必须在 ${PITCH_RANGE[0]} ~ ${PITCH_RANGE[1]}` };
  }
  if (p.volume < VOLUME_RANGE[0] || p.volume > VOLUME_RANGE[1]) {
    return { field: 'volume', message: `音量必须在 ${VOLUME_RANGE[0]} ~ ${VOLUME_RANGE[1]}` };
  }
  return null;
};

// ============================================================================
// Hook
// ============================================================================
export interface UseVoiceDesignState {
  params: VoiceParams;
  presets: VoicePreset[];
  seedVoices: SeedVoice[];
  isGenerating: boolean;
  isSaving: boolean;
  isLoadingPresets: boolean;
  lastResult: VoiceDesignResult | null;
  savedVoiceId: string | null;
  error: ValidationError | { message: string; error_code?: number; error_message?: string } | null;

  updateParam: <K extends keyof VoiceParams>(key: K, value: VoiceParams[K]) => void;
  reset: () => void;
  applyPreset: (presetId: string) => void;

  generate: () => Promise<VoiceDesignResult | null>;
  saveVoice: (args: VoiceSaveArgs) => Promise<VoiceSaveResult | null>;
  loadPresets: () => Promise<void>;
  loadSeedVoices: () => Promise<void>;
}

export const useVoiceDesign = (): UseVoiceDesignState => {
  const [params, setParams] = useState<VoiceParams>({ ...DEFAULT_VOICE_PARAMS });
  const [presets, setPresets] = useState<VoicePreset[]>(PRESETS);
  const [seedVoices, setSeedVoices] = useState<SeedVoice[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceDesignResult | null>(null);
  const [savedVoiceId, setSavedVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<UseVoiceDesignState['error']>(null);

  // 防止快速重复点 "生成"
  const inFlightRef = useRef(false);

  const updateParam = useCallback(<K extends keyof VoiceParams>(
    key: K,
    value: VoiceParams[K],
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    // 清掉旧错误
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setParams({ ...DEFAULT_VOICE_PARAMS });
    setError(null);
    setLastResult(null);
    setSavedVoiceId(null);
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = getPresetById(presetId);
    if (!preset) return;
    setParams((prev) => applyPresetToParams(prev, preset));
    setError(null);
  }, []);

  const generate = useCallback(async (): Promise<VoiceDesignResult | null> => {
    if (inFlightRef.current) return null;
    // 清掉旧的保存确认, 避免 stale display
    setSavedVoiceId(null);
    const validationErr = validateClientSide(params);
    if (validationErr) {
      setError(validationErr);
      return { ok: false, field: validationErr.field, message: validationErr.message };
    }
    setError(null);
    inFlightRef.current = true;
    setIsGenerating(true);
    try {
      const resp = await fetch('/api/voice-design/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gender: params.gender,
          age: params.age,
          emotion: params.emotion,
          style: params.style,
          speed: params.speed,
          pitch: params.pitch,
          volume: params.volume,
          text: params.text,
          voice_id: params.voice_id,
        }),
      });
      let body: VoiceDesignResult;
      try {
        body = await resp.json();
      } catch {
        body = {
          ok: false,
          error_code: resp.status,
          error_message: `non-JSON response (HTTP ${resp.status})`,
        };
      }
      setLastResult(body);
      if (!body.ok) {
        if (body.field) {
          setError({ field: body.field, message: body.message || '校验失败' });
        } else {
          setError({
            message: body.message || body.error_message || '生成失败',
            error_code: body.error_code,
            error_message: body.message || body.error_message,
          });
        }
      }
      return body;
    } catch (e: any) {
      const msg = e?.message || 'network error';
      const err: VoiceDesignResult = { ok: false, error_code: -1, error_message: msg };
      setLastResult(err);
      setError({ message: `网络异常: ${msg}` });
      return err;
    } finally {
      inFlightRef.current = false;
      setIsGenerating(false);
    }
  }, [params]);

  const saveVoice = useCallback(async (args: VoiceSaveArgs): Promise<VoiceSaveResult | null> => {
    if (!args.voice_name || !args.voice_name.trim()) {
      setError({ field: 'voice_name', message: '请填写音色名称' });
      return { ok: false };
    }
    if (!args.sample_audio) {
      setError({ field: 'sample_audio', message: '缺少音频数据' });
      return { ok: false };
    }
    setError(null);
    setIsSaving(true);
    try {
      const resp = await fetch('/api/voice-design/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_name: args.voice_name,
          sample_audio: args.sample_audio,
          description: args.description || '',
          preview_text: args.preview_text || params.text || '',
          format: args.format || 'mp3',
          sample_rate: args.sample_rate || 24000,
        }),
      });
      let body: VoiceSaveResult;
      try {
        body = await resp.json();
      } catch {
        body = { ok: false, error_code: resp.status };
      }
      if (body.ok && body.voice_id) {
        setSavedVoiceId(body.voice_id);
      } else {
        setError({ message: body.message || body.error_message || '保存失败', error_code: body.error_code });
      }
      return body;
    } catch (e: any) {
      setError({ message: `网络异常: ${e?.message || 'unknown'}` });
      return { ok: false };
    } finally {
      setIsSaving(false);
    }
  }, [params.text]);

  const loadPresets = useCallback(async () => {
    setIsLoadingPresets(true);
    try {
      const resp = await fetch('/api/voice-design/presets');
      if (!resp.ok) return;
      const body = await resp.json();
      if (body?.presets && Array.isArray(body.presets)) {
        setPresets(body.presets);
      }
    } catch (e) {
      // 静默 — 默认 PRESETS 仍可用
      // eslint-disable-next-line no-console
      console.warn('[useVoiceDesign] loadPresets failed:', e);
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  const loadSeedVoices = useCallback(async () => {
    try {
      const resp = await fetch('/api/voice-design/seed-voices');
      if (!resp.ok) return;
      const body = await resp.json();
      if (body?.seed_voices && Array.isArray(body.seed_voices)) {
        setSeedVoices(body.seed_voices);
        // 默认选中第一个
        if (body.seed_voices[0]?.voice_id) {
          setParams((prev) => prev.voice_id ? prev : { ...prev, voice_id: body.seed_voices[0].voice_id });
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[useVoiceDesign] loadSeedVoices failed:', e);
    }
  }, []);

  return {
    params,
    presets,
    seedVoices,
    isGenerating,
    isSaving,
    isLoadingPresets,
    lastResult,
    savedVoiceId,
    error,
    updateParam,
    reset,
    applyPreset,
    generate,
    saveVoice,
    loadPresets,
    loadSeedVoices,
  };
};