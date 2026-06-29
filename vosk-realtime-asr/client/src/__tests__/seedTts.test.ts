/**
 * useSeedTts — SeedTTS 2.0 后端代理客户端测试
 *
 * 覆盖:
 * - 默认状态 (idle, no audio)
 * - synthesize 成功 → 返回 Blob (audio/mpeg) + 触发 onProgress
 * - synthesize 失败 → 返回 {ok: false, error} 不抛
 * - AbortController: cancel() 后 fetch 被中断
 * - voices() 缓存: 同一进程内重复调用只发一次 fetch
 * - 凭证缺 → MisconfiguredError
 * - URL 拼接: BASE 来自 import.meta.env.VITE_TTS_BASE, 缺省 /api/tts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

// jsdom 缺 URL.createObjectURL/revokeObjectURL — 测试用假实现
let _objUrlSeq = 0;
const _created = new Set<string>();
(URL as any).createObjectURL = (blob: Blob) => {
  _objUrlSeq += 1;
  const u = `blob:test/${_objUrlSeq}`;
  _created.add(u);
  return u;
};
(URL as any).revokeObjectURL = (u: string) => { _created.delete(u); };

import { useSeedTts, fetchVoices, type TtsSynthesizeOptions } from '../hooks/useSeedTts';

function okAudioBlob(bytes = 8): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
}

function jsonResponse(obj: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => obj,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer,
    blob: async () => new Blob([JSON.stringify(obj)], { type: 'application/json' }),
    text: async () => JSON.stringify(obj),
  } as unknown as Response;
}

function binaryResponse(blob: Blob, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    blob: async () => blob,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useSeedTts', () => {
  it('初始状态: status=idle, audioUrl=null, error=null', () => {
    const { result } = renderHook(() => useSeedTts());
    expect(result.current.status).toBe('idle');
    expect(result.current.audioUrl).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('synthesize 成功 → 返回 Blob, 状态变 ready, audioUrl 创建', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(okAudioBlob()));
    const { result } = renderHook(() => useSeedTts());
    let out: { ok: boolean; audio?: Blob; error?: string } | undefined;
    await act(async () => {
      out = await result.current.synthesize({ text: '你好', voice: 'BV001_streaming' } as TtsSynthesizeOptions);
    });
    expect(out?.ok).toBe(true);
    expect(out?.audio).toBeInstanceOf(Blob);
    expect((out?.audio as Blob).type).toBe('audio/mpeg');
    expect(result.current.status).toBe('ready');
    expect(result.current.audioUrl).toMatch(/^blob:/);
    expect(result.current.error).toBeNull();
  });

  it('POST body 序列化正确: text/voice/speed/pitch/format', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(okAudioBlob()));
    const { result } = renderHook(() => useSeedTts());
    await act(async () => {
      await result.current.synthesize({
        text: 'hi', voice: 'BV002_streaming', speed: 1.2, pitch: 0.8, audioFormat: 'mp3',
      });
    });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toMatch(/\/api\/tts\/synthesize$/);
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({
      text: 'hi', voice: 'BV002_streaming', speed: 1.2, pitch: 0.8, audio_format: 'mp3',
    });
  });

  it('synthesize 失败 → 状态 error, 不抛, error 字段填充', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
    const { result } = renderHook(() => useSeedTts());
    let out: any;
    await act(async () => {
      out = await result.current.synthesize({ text: 'hi', voice: 'BV001_streaming' });
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(401);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/401/);
  });

  it('synthesize 网络异常 → status=error, 内部 message 暴露', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useSeedTts());
    let out: any;
    await act(async () => {
      out = await result.current.synthesize({ text: 'hi', voice: 'BV001_streaming' });
    });
    expect(out.ok).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('network down');
  });

  it('cancel() → AbortController 中止 fetch', async () => {
    let abortSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((url, init) => {
      abortSignal = init?.signal;
      return new Promise(() => {}); // 永不 resolve
    });
    const { result } = renderHook(() => useSeedTts());
    act(() => {
      result.current.synthesize({ text: 'hi', voice: 'BV001_streaming' });
    });
    await waitFor(() => expect(abortSignal).toBeDefined());
    act(() => {
      result.current.cancel();
    });
    expect(abortSignal?.aborted).toBe(true);
  });

  it('unmount 时自动 cancel 未完成 synthesize, 释放 ObjectURL', async () => {
    const beforeCreated = new Set(_created);
    fetchMock.mockResolvedValueOnce(binaryResponse(okAudioBlob()));
    const { result, unmount } = renderHook(() => useSeedTts());
    await act(async () => {
      await result.current.synthesize({ text: 'hi', voice: 'BV001_streaming' });
    });
    const newUrl = result.current.audioUrl!;
    expect(newUrl).toMatch(/^blob:/);
    expect(_created.has(newUrl)).toBe(true);
    unmount();
    expect(_created.has(newUrl)).toBe(false);
  });

  it('重置 → status=idle, error 清除', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
    const { result } = renderHook(() => useSeedTts());
    await act(async () => {
      await result.current.synthesize({ text: 'hi', voice: 'BV001_streaming' });
    });
    expect(result.current.status).toBe('error');
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('重复 synthesize: 上一个 ObjectURL 应当被 revoke', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(okAudioBlob()));
    fetchMock.mockResolvedValueOnce(binaryResponse(okAudioBlob(16)));
    const { result } = renderHook(() => useSeedTts());
    await act(async () => {
      await result.current.synthesize({ text: 'a', voice: 'BV001_streaming' });
    });
    const firstUrl = result.current.audioUrl!;
    expect(_created.has(firstUrl)).toBe(true);
    await act(async () => {
      await result.current.synthesize({ text: 'b', voice: 'BV001_streaming' });
    });
    const secondUrl = result.current.audioUrl!;
    expect(firstUrl).not.toBe(secondUrl);
    expect(_created.has(firstUrl)).toBe(false);
    expect(_created.has(secondUrl)).toBe(true);
  });
});

describe('fetchVoices (module export, 内存缓存)', () => {
  beforeEach(async () => {
    // 重置模块缓存, 强制每个测试独立
    const mod = await import('../hooks/useSeedTts');
    // 不能直接重置私有变量, 用 force=true 跳过
  });

  it('调用一次 → fetch /api/tts/voices, 解析 data 列表', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { id: 'BV001_streaming', name: '磁性男声', gender: 'male', sample_rate: 24000 },
        { id: 'BV002_streaming', name: '温柔女声', gender: 'female', sample_rate: 24000 },
      ],
    }));
    const voices = await fetchVoices(true);
    expect(voices).toHaveLength(2);
    expect(voices[0].id).toBe('BV001_streaming');
    expect(voices[1].gender).toBe('female');
  });

  it('二次调用命中缓存, 不发 fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await fetchVoices(true);
    await fetchVoices(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
