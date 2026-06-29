/**
 * usePodcastGeneration — 长会议转写 → 语音播客生成 hook
 *
 * 状态机:
 *   idle
 *     → submit()     → submitting
 *   submitting → 200 success | 202 running(progress) | error
 *   running    → poll 直至 status=done → success
 *            → cancel() → idle
 *   error      → retry() → submitting (复用上一次 opts)
 *
 * 不可重试错误: empty_transcript, invalid_option, podcast_not_configured, task_not_found
 * 可重试错误: upstream_error, network_error, podcast_timeout
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type PodcastStyle = 'tech' | 'business' | 'entertainment' | 'academic';
export type PodcastDuration = 'short' | 'medium' | 'long';

export interface HostTurn {
  role: 'host_a' | 'host_b' | 'host_other';
  text: string;
  audio_url: string;
  duration_ms: number;
}

export interface PodcastChapter {
  title: string;
  start_ms: number;
  end_ms: number;
}

export interface PodcastResult {
  task_id: string;
  script: HostTurn[];
  chapters: PodcastChapter[];
  total_duration_ms: number;
  progress: number;
}

export interface PodcastError {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
}

export interface SubmitOptions {
  transcript: string;
  style: PodcastStyle;
  duration: PodcastDuration;
  includeAudioClip: boolean;
}

export interface UsePodcastGenerationOptions {
  /** 轮询间隔 (ms), 默认 1500 */
  pollIntervalMs?: number;
  /** 轮询超时 (ms), 默认 5 分钟 */
  pollTimeoutMs?: number;
  /** fetch 注入点 (默认全局 fetch) */
  fetcher?: typeof fetch;
  /** API base, 默认 '/api' */
  apiBase?: string;
}

export type PodcastState =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'success'
  | 'error';

// 不需要重试的 error code (客户端配置错误)
const NON_RETRYABLE_CODES = new Set([
  'empty_transcript',
  'transcript_too_long',
  'invalid_option',
  'podcast_not_configured',
  'task_not_found',
]);

export interface UsePodcastGenerationReturn {
  state: PodcastState;
  result: PodcastResult | null;
  error: PodcastError | null;
  progress: number;
  submit: (opts: SubmitOptions) => Promise<void>;
  cancel: () => void;
  retry: () => Promise<void>;
  reset: () => void;
}

export function usePodcastGeneration(
  options: UsePodcastGenerationOptions = {},
): UsePodcastGenerationReturn {
  const {
    pollIntervalMs = 1500,
    pollTimeoutMs = 5 * 60 * 1000,
    fetcher,
    apiBase = '/api',
  } = options;
  const fetchFn: typeof fetch = fetcher ?? ((...args) => fetch(...args));

  const [state, setState] = useState<PodcastState>('idle');
  const [result, setResult] = useState<PodcastResult | null>(null);
  const [error, setError] = useState<PodcastError | null>(null);
  const [progress, setProgress] = useState(0);

  // 上一次 opts 用于 retry
  const lastOptsRef = useRef<SubmitOptions | null>(null);
  // 轮询句柄
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartedAtRef = useRef<number>(0);
  // 卸载 / cancel 标志
  const cancelledRef = useRef(false);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current != null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearPoll();
    cancelledRef.current = true;
    lastOptsRef.current = null;
    setState('idle');
    setResult(null);
    setError(null);
    setProgress(0);
  }, [clearPoll]);

  const cancel = useCallback(() => {
    clearPoll();
    cancelledRef.current = true;
    setState('idle');
    setResult(null);
    setProgress(0);
  }, [clearPoll]);

  const parseError = useCallback(
    async (res: Response): Promise<PodcastError> => {
      let body: { error?: string; message?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // 忽略 JSON 解析错误
      }
      const code = body.error || `http_${res.status}`;
      const retryable = !NON_RETRYABLE_CODES.has(code) && res.status >= 500;
      return {
        code,
        message: body.message || `${res.status} ${res.statusText}`,
        retryable,
        status: res.status,
      };
    },
    [],
  );

  const startPolling = useCallback(
    (taskId: string) => {
      cancelledRef.current = false;
      pollStartedAtRef.current = Date.now();
      const tick = async () => {
        if (cancelledRef.current) return;
        if (Date.now() - pollStartedAtRef.current > pollTimeoutMs) {
          setError({
            code: 'podcast_timeout',
            message: '轮询超时',
            retryable: true,
          });
          setState('error');
          return;
        }
        try {
          const res = await fetchFn(`${apiBase}/podcast/task/${encodeURIComponent(taskId)}`);
          if (!res.ok) {
            const e = await parseError(res);
            setError(e);
            setState('error');
            return;
          }
          const data = (await res.json()) as {
            status: string;
            progress: number;
            script?: HostTurn[];
            chapters?: PodcastChapter[];
            total_duration_ms?: number;
          };
          setProgress(data.progress ?? 0);
          if (data.status === 'done') {
            setResult({
              task_id: taskId,
              script: data.script ?? [],
              chapters: data.chapters ?? [],
              total_duration_ms: data.total_duration_ms ?? 0,
              progress: 1,
            });
            setState('success');
            return;
          }
          if (data.status === 'failed') {
            setError({
              code: 'upstream_error',
              message: '上游任务失败',
              retryable: true,
            });
            setState('error');
            return;
          }
          // running → 下一轮
          pollTimerRef.current = setTimeout(tick, pollIntervalMs);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError({
            code: 'network_error',
            message: msg,
            retryable: true,
          });
          setState('error');
        }
      };
      pollTimerRef.current = setTimeout(tick, pollIntervalMs);
    },
    [apiBase, fetchFn, parseError, pollIntervalMs, pollTimeoutMs],
  );

  const submit = useCallback(
    async (opts: SubmitOptions) => {
      lastOptsRef.current = opts;
      cancelledRef.current = false;
      setState('submitting');
      setError(null);
      setProgress(0);
      try {
        const res = await fetchFn(`${apiBase}/podcast/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: opts.transcript,
            style: opts.style,
            duration: opts.duration,
            include_audio_clip: opts.includeAudioClip,
          }),
        });

        if (!res.ok) {
          const e = await parseError(res);
          setError(e);
          setState('error');
          return;
        }

        if (res.status === 202) {
          // 异步: 拿到 task_id, 进入 running + 轮询
          const data = (await res.json()) as { task_id: string; progress?: number };
          setResult({
            task_id: data.task_id,
            script: [],
            chapters: [],
            total_duration_ms: 0,
            progress: data.progress ?? 0,
          });
          setState('running');
          startPolling(data.task_id);
          return;
        }

        // 200 同步路径
        const data = (await res.json()) as {
          task_id: string;
          script: HostTurn[];
          chapters: PodcastChapter[];
          total_duration_ms: number;
          progress?: number;
        };
        setResult({
          task_id: data.task_id,
          script: data.script ?? [],
          chapters: data.chapters ?? [],
          total_duration_ms: data.total_duration_ms ?? 0,
          progress: data.progress ?? 1,
        });
        setProgress(1);
        setState('success');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError({
          code: 'network_error',
          message: msg,
          retryable: true,
        });
        setState('error');
      }
    },
    [apiBase, fetchFn, parseError, startPolling],
  );

  const retry = useCallback(async () => {
    if (!lastOptsRef.current) return;
    await submit(lastOptsRef.current);
  }, [submit]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearPoll();
    };
  }, [clearPoll]);

  return {
    state,
    result,
    error,
    progress,
    submit,
    cancel,
    retry,
    reset,
  };
}