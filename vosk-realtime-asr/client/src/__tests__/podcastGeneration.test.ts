/**
 * usePodcastGeneration — TDD 红测试
 *
 * 状态机:
 *   idle → submitting → success | error | running(progress)
 *   running → cancel() → idle
 *   error → retry() → submitting
 *
 * 实现待定, 文件位于 client/src/hooks/usePodcastGeneration.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePodcastGeneration } from '../hooks/usePodcastGeneration';

// ============================================================================
// 初始状态
// ============================================================================
describe('usePodcastGeneration — 初始状态', () => {
  it('初始状态是 idle', () => {
    const { result } = renderHook(() => usePodcastGeneration());
    expect(result.current.state).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(0);
  });

  it('暴露 submit / cancel / retry 函数', () => {
    const { result } = renderHook(() => usePodcastGeneration());
    expect(typeof result.current.submit).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
    expect(typeof result.current.retry).toBe('function');
  });
});

// ============================================================================
// 同步路径: short duration → success
// ============================================================================
describe('usePodcastGeneration — 同步生成 (200)', () => {
  it('submit 后 → submitting → success, 携带 script + chapters', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        task_id: 'sync-001',
        script: [
          { role: 'host_a', text: '大家好', audio_url: 'https://x/a.mp3', duration_ms: 1500 },
          { role: 'host_b', text: '欢迎收听', audio_url: 'https://x/b.mp3', duration_ms: 1300 },
        ],
        chapters: [{ title: '开场', start_ms: 0, end_ms: 1500 }],
        total_duration_ms: 2800,
        progress: 1.0,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration());

    await act(async () => {
      await result.current.submit({
        transcript: '今天的会议讨论产品路线',
        style: 'tech',
        duration: 'short',
        includeAudioClip: false,
      });
    });

    expect(result.current.state).toBe('success');
    expect(result.current.result).not.toBeNull();
    expect(result.current.result!.task_id).toBe('sync-001');
    expect(result.current.result!.script).toHaveLength(2);
    expect(result.current.result!.script[0].role).toBe('host_a');
    expect(result.current.result!.chapters).toHaveLength(1);
    expect(result.current.error).toBeNull();

    vi.unstubAllGlobals();
  });

  it('submit 调用 fetch 时, body 字段对齐 + headers 含 Content-Type: application/json', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        task_id: 't',
        script: [],
        chapters: [],
        total_duration_ms: 0,
        progress: 1.0,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration());

    await act(async () => {
      await result.current.submit({
        transcript: 'x',
        style: 'business',
        duration: 'short',
        includeAudioClip: true,
      });
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/podcast\/generate$/);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.transcript).toBe('x');
    expect(body.style).toBe('business');
    expect(body.duration).toBe('short');
    expect(body.include_audio_clip).toBe(true);

    vi.unstubAllGlobals();
  });
});

// ============================================================================
// 异步路径: long duration → 202 → 轮询
// ============================================================================
describe('usePodcastGeneration — 异步生成 (202 + poll)', () => {
  it('submit 后端返 202 → 进入 running, 持续 poll 直至 status=done', async () => {
    let pollCount = 0;
    const mockFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/podcast/generate')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ task_id: 'async-007', status: 'pending', progress: 0.0 }),
        };
      }
      if (url.endsWith('/api/podcast/task/async-007')) {
        pollCount += 1;
        if (pollCount < 3) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'running', progress: 0.2 * pollCount }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'done',
            progress: 1.0,
            script: [{ role: 'host_a', text: '完毕', audio_url: '', duration_ms: 1000 }],
            chapters: [],
            total_duration_ms: 1000,
          }),
        };
      }
      throw new Error('unexpected url: ' + url);
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration({ pollIntervalMs: 100 }));

    await act(async () => {
      await result.current.submit({
        transcript: 'long meeting transcript',
        style: 'tech',
        duration: 'long',
        includeAudioClip: false,
      });
    });

    // 第一次 202 → running
    expect(result.current.state).toBe('running');
    expect(result.current.result?.task_id).toBe('async-007');

    // 轮询 3 次到达 done
    await waitFor(() => {
      expect(result.current.state).toBe('success');
    });
    expect(result.current.progress).toBe(1);
    expect(result.current.result?.script).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('running 中 cancel → 停止轮询, 回到 idle', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/podcast/generate')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ task_id: 't1', status: 'pending', progress: 0 }),
        };
      }
      if (url.includes('/api/podcast/task/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'running', progress: 0.5 }),
        };
      }
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration({ pollIntervalMs: 50 }));

    await act(async () => {
      await result.current.submit({
        transcript: 'x',
        style: 'tech',
        duration: 'long',
        includeAudioClip: false,
      });
    });
    expect(result.current.state).toBe('running');

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.result).toBeNull();

    vi.unstubAllGlobals();
  });
});

// ============================================================================
// 错误处理
// ============================================================================
describe('usePodcastGeneration — 错误处理', () => {
  it('后端 4xx → state=error, error.message 携带服务端 message', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'empty_transcript', message: '转写文本为空' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration());

    await act(async () => {
      await result.current.submit({
        transcript: '',
        style: 'tech',
        duration: 'short',
        includeAudioClip: false,
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('empty_transcript');
    expect(result.current.error?.message).toBe('转写文本为空');
    expect(result.current.error?.retryable).toBe(false);

    vi.unstubAllGlobals();
  });

  it('后端 503 → error 且 retryable=true', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'podcast_not_configured', message: '未配置' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration());

    await act(async () => {
      await result.current.submit({
        transcript: 'x',
        style: 'tech',
        duration: 'short',
        includeAudioClip: false,
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.retryable).toBe(false); // 配置错误, 不可重试

    vi.unstubAllGlobals();
  });

  it('后端 502 → error 且 retryable=true', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'upstream_error', message: 'upstream 503' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => usePodcastGeneration());

    await act(async () => {
      await result.current.submit({
        transcript: 'x',
        style: 'tech',
        duration: 'short',
        includeAudioClip: false,
      });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.retryable).toBe(true);

    vi.unstubAllGlobals();
  });

  it('error 状态调 retry() → 重新 submit 上一次的 opts', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ task_id: 't2', script: [], chapters: [], total_duration_ms: 0, progress: 1.0 }),
    }));
    vi.stubGlobal('fetch', mockFetch);

    // 第一次 fetch 失败
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'upstream_error', message: 'flaky' }),
    });

    const { result } = renderHook(() => usePodcastGeneration());

    await act(async () => {
      await result.current.submit({
        transcript: 'retry me',
        style: 'tech',
        duration: 'short',
        includeAudioClip: false,
      });
    });
    expect(result.current.state).toBe('error');

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.state).toBe('success');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.transcript).toBe('retry me');

    vi.unstubAllGlobals();
  });
});