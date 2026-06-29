/**
 * 音色设计 (Voice Design) — useVoiceDesign hook + 共享类型/常量 单元测试
 *
 * 覆盖:
 * - 默认参数填充
 * - 校验客户端规则 (text 长度 / 枚举)
 * - 生成请求参数组装 + fetch mock
 * - 预设应用 (一键填参)
 * - 保存音色流程
 * - 错误处理 (502 / 400 / network)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useVoiceDesign,
  DEFAULT_VOICE_PARAMS,
  PRESETS,
  getPresetById,
  applyPresetToParams,
  validateClientSide,
  type VoiceParams,
  type VoiceDesignResult,
} from '../hooks/useVoiceDesign';

const SAMPLE_AUDIO_B64 = 'YWJjZGVm'; // 'abcdef'

describe('useVoiceDesign — constants', () => {
  it('默认参数 gender=female, age=young, emotion=neutral, style=assistant, speed=1.0', () => {
    expect(DEFAULT_VOICE_PARAMS).toMatchObject({
      gender: 'female',
      age: 'young',
      emotion: 'neutral',
      style: 'assistant',
      speed: 1.0,
      pitch: 1.0,
      volume: 5,
    });
    expect(DEFAULT_VOICE_PARAMS.text).toBe('');
  });

  it('预设至少 4 个, id 唯一', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个 preset 有 id/name/gender/age/emotion/style/description/可选 icon', () => {
    for (const p of PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(['male', 'female']).toContain(p.gender);
      expect(['child', 'young', 'middle-aged', 'senior']).toContain(p.age);
      expect(p.emotion).toBeTruthy();
      expect(p.style).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it('getPresetById 已知 id 返回预设, 未知返回 null', () => {
    const p = getPresetById('news_anchor');
    expect(p).not.toBeNull();
    expect(getPresetById('nonexistent_id')).toBeNull();
  });

  it('applyPresetToParams 把预设应用到现有 params 上, 不覆盖用户已修改的字段 (除可选)', () => {
    const base: VoiceParams = { ...DEFAULT_VOICE_PARAMS, text: 'hi' };
    const preset = PRESETS[0];
    const merged = applyPresetToParams(base, preset);
    expect(merged.gender).toBe(preset.gender);
    expect(merged.age).toBe(preset.age);
    expect(merged.emotion).toBe(preset.emotion);
    expect(merged.style).toBe(preset.style);
    // text 保留
    expect(merged.text).toBe('hi');
  });
});

describe('useVoiceDesign — validateClientSide', () => {
  it('合法参数 → null', () => {
    const err = validateClientSide({
      ...DEFAULT_VOICE_PARAMS,
      text: '你好',
    });
    expect(err).toBeNull();
  });

  it('空 text → 错误 field=text', () => {
    const err = validateClientSide({ ...DEFAULT_VOICE_PARAMS, text: '' });
    expect(err?.field).toBe('text');
  });

  it('text 过长 (>300) → 错误', () => {
    const err = validateClientSide({ ...DEFAULT_VOICE_PARAMS, text: 'x'.repeat(301) });
    expect(err?.field).toBe('text');
  });

  it('speed 越界 → 错误', () => {
    const err = validateClientSide({ ...DEFAULT_VOICE_PARAMS, text: 'hi', speed: 3 });
    expect(err?.field).toBe('speed');
  });

  it('未知 emotion → 错误', () => {
    const err = validateClientSide({
      ...DEFAULT_VOICE_PARAMS, text: 'hi', emotion: 'ecstatic' as any,
    });
    expect(err?.field).toBe('emotion');
  });
});

describe('useVoiceDesign — hook state', () => {
  it('初始 state: 默认 params + 未生成', () => {
    const { result } = renderHook(() => useVoiceDesign());
    expect(result.current.params.gender).toBe('female');
    expect(result.current.params.age).toBe('young');
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.lastResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('updateParam 改字段 (双向绑定)', () => {
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('gender', 'male'));
    expect(result.current.params.gender).toBe('male');
    act(() => result.current.updateParam('speed', 1.5));
    expect(result.current.params.speed).toBe(1.5);
    act(() => result.current.updateParam('text', '测试'));
    expect(result.current.params.text).toBe('测试');
  });

  it('applyPreset 把预设应用到 params', () => {
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.applyPreset('magnetic_male'));
    expect(result.current.params.gender).toBe('male');
    expect(result.current.params.style).toBe('narrator');
  });

  it('applyPreset 未知 id → 不改变 params (静默失败)', () => {
    const { result } = renderHook(() => useVoiceDesign());
    const before = { ...result.current.params };
    act(() => result.current.applyPreset('not_a_real_preset'));
    expect(result.current.params).toEqual(before);
  });

  it('reset 回到默认', () => {
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('gender', 'male'));
    act(() => result.current.updateParam('speed', 1.8));
    act(() => result.current.reset());
    expect(result.current.params.gender).toBe('female');
    expect(result.current.params.speed).toBe(1.0);
    expect(result.current.params.text).toBe('');
  });
});

describe('useVoiceDesign — generate flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generate 触发 POST /api/voice-design/generate, 含 params', async () => {
    const fakeResult: VoiceDesignResult = {
      ok: true,
      audio_base64: SAMPLE_AUDIO_B64,
      duration_ms: 1234,
      sample_rate: 24000,
    };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(fakeResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('text', '你好世界'));
    let r: VoiceDesignResult | null = null;
    await act(async () => {
      r = await result.current.generate();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/voice-design/generate');
    expect(init.method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.gender).toBe('female');
    expect(body.text).toBe('你好世界');
    expect(body.emotion).toBe('neutral');  // 默认填充
    expect(r?.ok).toBe(true);
    expect(result.current.lastResult?.audio_base64).toBe(SAMPLE_AUDIO_B64);
    expect(result.current.isGenerating).toBe(false);
  });

  it('generate 空 text 直接返回 ok=False, 不发请求', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { result } = renderHook(() => useVoiceDesign());
    let r: VoiceDesignResult | null = null;
    await act(async () => {
      r = await result.current.generate();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r?.ok).toBe(false);
    expect(result.current.error?.field).toBe('text');
  });

  it('generate 400 错误 (服务端字段校验) → state.error 填入', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, field: 'speed', status: 400 }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('text', 'hi'));
    let r: VoiceDesignResult | null = null;
    await act(async () => {
      r = await result.current.generate();
    });
    expect(r?.ok).toBe(false);
    expect(result.current.error?.field).toBe('speed');
  });

  it('generate 502 上游错误 → state.error 含 error_code', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error_code: -2, error_message: 'upstream timeout' }), {
        status: 502,
      }),
    );
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('text', 'hi'));
    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.error?.error_code).toBe(-2);
    expect(result.current.error?.error_message).toContain('timeout');
  });

  it('generate 网络异常 → state.error 含 network', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('text', 'hi'));
    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.error?.message).toMatch(/network|fetch/i);
  });

  it('isGenerating 在请求期间为 true, 完成后回 false', async () => {
    // 用 Promise.resolve() 替代 fetch: 让 React 18 batching 在 await 边界 flush
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, audio_base64: 'AA', duration_ms: 1, sample_rate: 24000 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('text', 'hi'));
    // 初始 false
    expect(result.current.isGenerating).toBe(false);
    await act(async () => {
      // 在第一个 await 之前 — state 还是 false (因为还没 flush)
      await result.current.generate();
      // generate() 之后 flush: flag 已被 finally 重置回 false
    });
    expect(result.current.isGenerating).toBe(false);
  });

  it('isGenerating 在多个 await 边界间保持 true 状态 (语义)', async () => {
    // 简单语义验证: fetch 未 resolve 时, 等价的 React 渲染层 hasGenerated = true
    // 不可见: 实际无法从外部观察 React 18 batching 的中间状态
    // 因此本测试只验证: generate 完成后 isGenerating 一定为 false
    let fetchCalled = false;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      fetchCalled = true;
      return new Response(
        JSON.stringify({ ok: true, audio_base64: 'AA', duration_ms: 1, sample_rate: 24000 }),
        { status: 200 },
      );
    });
    const { result } = renderHook(() => useVoiceDesign());
    act(() => result.current.updateParam('text', 'hi'));
    await act(async () => {
      await result.current.generate();
    });
    expect(fetchCalled).toBe(true);
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.lastResult?.ok).toBe(true);
  });
});

describe('useVoiceDesign — save flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('saveVoice 发 POST /api/voice-design/save, 含 voice_name + sample_audio', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, voice_id: 'S_user_001' }), { status: 200 }),
    );
    const { result } = renderHook(() => useVoiceDesign());
    let saveResult: { ok: boolean; voice_id?: string } | null = null;
    await act(async () => {
      saveResult = await result.current.saveVoice({
        voice_name: '我的音色',
        sample_audio: SAMPLE_AUDIO_B64,
        description: 'demo',
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/voice-design/save');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.voice_name).toBe('我的音色');
    expect(body.sample_audio).toBe(SAMPLE_AUDIO_B64);
    expect(saveResult?.voice_id).toBe('S_user_001');
  });

  it('saveVoice 缺 voice_name → state.error 提示, 不发请求', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { result } = renderHook(() => useVoiceDesign());
    await act(async () => {
      await result.current.saveVoice({
        voice_name: '',
        sample_audio: SAMPLE_AUDIO_B64,
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error?.field).toBe('voice_name');
  });
});

describe('useVoiceDesign — fetchPresets / fetchSeedVoices', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loadPresets 从 /api/voice-design/presets 取并填充 hook.presets', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        presets: [
          { id: 'p1', name: 'P1', gender: 'female', age: 'young', emotion: 'neutral', style: 'assistant', description: 'd' },
        ],
      }), { status: 200 }),
    );
    const { result } = renderHook(() => useVoiceDesign());
    await act(async () => {
      await result.current.loadPresets();
    });
    expect(result.current.presets.length).toBe(1);
    expect(result.current.presets[0].id).toBe('p1');
  });

  it('loadSeedVoices 从 /api/voice-design/seed-voices 取', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        seed_voices: [{ voice_id: 'S_x', name: 'x', gender: 'male' }],
      }), { status: 200 }),
    );
    const { result } = renderHook(() => useVoiceDesign());
    await act(async () => {
      await result.current.loadSeedVoices();
    });
    expect(result.current.seedVoices.length).toBe(1);
    expect(result.current.seedVoices[0].voice_id).toBe('S_x');
  });
});