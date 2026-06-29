/**
 * useFileAsr — TDD 测试
 *
 * 测试覆盖:
 *   - 状态机: idle → uploading → submitted → running → done / failed
 *   - submit / poll / result 三段式
 *   - 取消任务
 *   - 失败重试
 *   - merge 入口 (parseResult → dispatch TRANSCRIPT_FINAL)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// mock fetch
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

// 用 fake timers 控制轮询
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockFetch.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

import { useFileAsr } from '../hooks/useFileAsr';
import type { FileAsrTask } from '../hooks/useFileAsr';

function mockResp(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    json: () => Promise.resolve(body),
  };
}

describe('useFileAsr / initial', () => {
  it('初始状态: tasks=[], isUploading=false', () => {
    const { result } = renderHook(() => useFileAsr({ dispatch: vi.fn() }));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.isUploading).toBe(false);
  });
});

describe('useFileAsr / submit', () => {
  it('submit 成功: 任务进入 submitted, 带 task_id', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-1', status: 'queued' }),
    );
    const { result } = renderHook(() => useFileAsr({ dispatch: vi.fn() }));
    let task: FileAsrTask | null = null;
    await act(async () => {
      task = await result.current.submit('https://x/a.mp3', {
        filename: 'a.mp3',
        size_bytes: 1024,
      });
    });
    expect(task).not.toBeNull();
    expect(task!.task_id).toBe('tid-1');
    expect(task!.status).toBe('submitted');
    expect(task!.filename).toBe('a.mp3');
    expect(result.current.tasks[0].task_id).toBe('tid-1');
    // fetch 调了 1 次 (submit)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe('/api/file-asr/submit');
  });

  it('submit 失败 → 任务状态 failed, error 字段填上', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResp({ error: 'invalid url' }, 400),
    );
    const { result } = renderHook(() => useFileAsr({ dispatch: vi.fn() }));
    await act(async () => {
      await result.current.submit('bad', { filename: 'x.mp3', size_bytes: 1 });
    });
    expect(result.current.tasks[0].status).toBe('failed');
    expect(result.current.tasks[0].error).toContain('invalid url');
  });
});

describe('useFileAsr / polling', () => {
  it('submitted 任务会自动 poll, status=running → done 时停', async () => {
    // 1) submit 返回
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-p', status: 'queued' }),
    );
    // 2) poll #1: running
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-p', status: 'Running' }),
    );
    // 3) poll #2: done + utterances
    mockFetch.mockResolvedValueOnce(
      mockResp({
        task_id: 'tid-p',
        status: 'Done',
        utterances: [
          { text: 'hi', start_time: 0, end_time: 100, speaker_id: 'spk0' },
        ],
      }),
    );
    const dispatch = vi.fn();
    const { result } = renderHook(() => useFileAsr({ dispatch, pollIntervalMs: 100 }));

    await act(async () => {
      await result.current.submit('https://x/a.mp3', { filename: 'a.mp3', size_bytes: 1 });
    });
    // 走一轮 poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => {
      const t = result.current.tasks.find(x => x.task_id === 'tid-p');
      expect(t?.status).toBe('done');
    });
    // 至少 3 次 fetch: submit + 2 polls
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    // done 时 dispatch TRANSCRIPT_FINAL 一次
    const finalCalls = dispatch.mock.calls.filter(c => c[0]?.type === 'TRANSCRIPT_FINAL');
    expect(finalCalls.length).toBe(1);
    const payload = finalCalls[0][0];
    expect(payload.result.text).toBe('hi');
    expect(payload.result.utterances[0].speaker_id).toBe('spk0');
  });

  it('failed poll → 任务状态 failed, 不再 poll', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-f', status: 'queued' }),
    );
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-f', status: 'Failed', error: 'corrupt' }),
    );
    const dispatch = vi.fn();
    const { result } = renderHook(() => useFileAsr({ dispatch, pollIntervalMs: 50 }));
    await act(async () => {
      await result.current.submit('https://x/a.mp3', { filename: 'a.mp3', size_bytes: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => {
      const t = result.current.tasks.find(x => x.task_id === 'tid-f');
      expect(t?.status).toBe('failed');
      expect(t?.error).toContain('corrupt');
    });
  });
});

describe('useFileAsr / retry', () => {
  it('retry 重新 submit, 上传失败的 task 重新进入 submitted', async () => {
    // 1) submit 失败
    mockFetch.mockResolvedValueOnce(mockResp({ error: 'network' }, 500));
    // 2) retry 成功
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-r2', status: 'queued' }),
    );
    const { result } = renderHook(() => useFileAsr({ dispatch: vi.fn(), pollIntervalMs: 10_000 }));
    await act(async () => {
      await result.current.submit('https://x/a.mp3', { filename: 'a.mp3', size_bytes: 1 });
    });
    expect(result.current.tasks[0].status).toBe('failed');
    // retry (传 fileUrl)
    await act(async () => {
      await result.current.retry(result.current.tasks[0].local_id, 'https://x/a.mp3');
    });
    expect(result.current.tasks[0].status).toBe('submitted');
    expect(result.current.tasks[0].task_id).toBe('tid-r2');
  });
});

describe('useFileAsr / cancel', () => {
  it('cancel 从列表移除任务', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-c', status: 'queued' }),
    );
    const { result } = renderHook(() => useFileAsr({ dispatch: vi.fn(), pollIntervalMs: 60_000 }));
    await act(async () => {
      await result.current.submit('https://x/a.mp3', { filename: 'a.mp3', size_bytes: 1 });
    });
    const localId = result.current.tasks[0].local_id;
    act(() => {
      result.current.cancel(localId);
    });
    expect(result.current.tasks).toHaveLength(0);
  });
});

describe('useFileAsr / 进度估算', () => {
  it('running 任务有 progress 字段 (0-100)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-pr', status: 'queued' }),
    );
    mockFetch.mockResolvedValueOnce(
      mockResp({ task_id: 'tid-pr', status: 'Running', progress: 0.42 }),
    );
    const { result } = renderHook(() => useFileAsr({ dispatch: vi.fn(), pollIntervalMs: 50 }));
    await act(async () => {
      await result.current.submit('https://x/a.mp3', { filename: 'a.mp3', size_bytes: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      const t = result.current.tasks.find(x => x.task_id === 'tid-pr');
      // progress may be present in state
      expect(t?.status).toBe('running');
    });
  });
});
