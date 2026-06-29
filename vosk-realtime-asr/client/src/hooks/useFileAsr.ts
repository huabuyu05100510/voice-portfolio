/**
 * useFileAsr — 录音文件识别 2.0 客户端 hook
 *
 * 职责:
 *   - submit(file_url)         POST /api/file-asr/submit
 *   - poll(task_id)            GET  /api/file-asr/status/<id>  (轮询)
 *   - result(task_id)          GET  /api/file-asr/result/<id>  (final)
 *   - 把 final result 通过 dispatch(TRANSCRIPT_FINAL) 注入到 transcriptionReducer,
 *     与实时转写统一在 Hero 区展示. 不破坏 reducer 现有逻辑 — 仅追加 merge 入口.
 *
 * 状态机 (per task):
 *   uploading → submitted → running → done
 *                    ↓           ↓
 *                  failed    failed
 *
 * Author: MiniMax-M3 (2026-06-27)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { TranscriptionResult, TranscriptionAction, Utterance } from '../types';

export type FileAsrStatus =
  | 'idle'
  | 'uploading'
  | 'submitted'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface FileAsrTask {
  /** 本地唯一 id (用 crypto.randomUUID, 与服务端 task_id 区分) */
  local_id: string;
  /** 服务端 task_id (submit 后才有) */
  task_id?: string;
  /** 文件元信息 */
  filename: string;
  size_bytes: number;
  format: string;
  /** 状态机 */
  status: FileAsrStatus;
  /** 服务端 raw 错误 (status=failed 时) */
  error?: string;
  /** 服务端进度 (0-1) — running 时 */
  progress?: number;
  /** 完成时间戳 */
  finished_at?: number;
  /** 创建时间戳 */
  created_at: number;
  /** 解析后的转写 (done 时) */
  result?: {
    text: string;
    utterances: Utterance[];
  };
  /** 用于合并 reducer 的 dispatch payload (done 时) */
  merged_dispatch_payload?: TranscriptionAction;
}

export interface UseFileAsrOptions {
  /** 转写 reducer 的 dispatch — 用它把结果 merge 进实时转写 */
  dispatch: Dispatch<TranscriptionAction>;
  /** 轮询间隔 (ms), 默认 2000 */
  pollIntervalMs?: number;
  /** 失败重试上限, 默认 3 */
  maxRetries?: number;
  /** 服务端 base, 默认 '/api' (走 Vite proxy) */
  basePath?: string;
}

export interface UseFileAsrReturn {
  tasks: FileAsrTask[];
  isUploading: boolean;
  /** 提交一个 URL 音频/视频做异步识别 */
  submit: (
    fileUrl: string,
    meta: { filename: string; size_bytes: number; format?: string },
  ) => Promise<FileAsrTask>;
  /** 重试失败任务 (需要原 fileUrl — caller 自己缓存) */
  retry: (local_id: string, fileUrl: string) => Promise<void>;
  /** 取消任务 (本地从列表移除, 不影响服务端) */
  cancel: (local_id: string) => void;
  /** 清空已完成任务 */
  clearFinished: () => void;
}

interface SubmitResponse {
  task_id: string;
  status: string;
}

interface StatusResponse {
  task_id: string;
  status: string;
  error?: string;
  utterances?: Array<{
    text: string;
    start_time: number;
    end_time: number;
    speaker_id: string;
    words?: any[];
    definite?: boolean;
  }>;
}

function _uuid(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return 'loc-' + Math.random().toString(36).slice(2, 10);
}

function _now(): number {
  return Date.now();
}

export const useFileAsr = (opts: UseFileAsrOptions): UseFileAsrReturn => {
  const {
    dispatch,
    pollIntervalMs = 2000,
    maxRetries = 3,
    basePath = '/api',
  } = opts;
  const [tasks, setTasks] = useState<FileAsrTask[]>([]);
  const tasksRef = useRef<FileAsrTask[]>([]);
  const pollTimersRef = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const retryCountRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      for (const t of pollTimersRef.current.values()) {
        clearTimeout(t);
      }
      pollTimersRef.current.clear();
    };
  }, []);

  const isUploading = tasks.some((t) => t.status === 'uploading');

  // ------------------------------------------------------------------
  // 内部: 改 task
  // ------------------------------------------------------------------
  const _update = useCallback((local_id: string, patch: Partial<FileAsrTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.local_id === local_id ? { ...t, ...patch } : t)),
    );
  }, []);

  // ------------------------------------------------------------------
  // Submit
  // ------------------------------------------------------------------
  const submit = useCallback(
    async (
      fileUrl: string,
      meta: { filename: string; size_bytes: number; format?: string },
    ): Promise<FileAsrTask> => {
      const local_id = _uuid();
      const task: FileAsrTask = {
        local_id,
        filename: meta.filename,
        size_bytes: meta.size_bytes,
        format: meta.format || 'mp3',
        status: 'uploading',
        created_at: _now(),
      };
      setTasks((prev) => [task, ...prev]);

      try {
        const resp = await fetch(`${basePath}/file-asr/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_url: fileUrl,
            enable_diarization: true,
            speaker_count: -1,
            enable_itn: true,
            enable_punc: true,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          const errMsg = data?.error || `submit failed: HTTP ${resp.status}`;
          _update(local_id, { status: 'failed', error: errMsg });
          return { ...task, status: 'failed', error: errMsg };
        }
        const submitResp = data as SubmitResponse;
        _update(local_id, {
          status: 'submitted',
          task_id: submitResp.task_id,
        });
        // 启动轮询
        _schedulePoll(local_id, submitResp.task_id);
        return { ...task, status: 'submitted', task_id: submitResp.task_id };
      } catch (e: any) {
        const errMsg = e?.message || 'submit network error';
        _update(local_id, { status: 'failed', error: errMsg });
        return { ...task, status: 'failed', error: errMsg };
      }
    },
    [basePath, _update],
  );

  // ------------------------------------------------------------------
  // Poll
  // ------------------------------------------------------------------
  const _schedulePoll = useCallback(
    (local_id: string, task_id: string) => {
      const tick = async () => {
        if (!mountedRef.current) return;
        try {
          const resp = await fetch(`${basePath}/file-asr/status/${task_id}`);
          const data = (await resp.json()) as StatusResponse;
          if (!resp.ok) {
            // 5xx/网络: 重试
            const tries = (retryCountRef.current.get(task_id) || 0) + 1;
            retryCountRef.current.set(task_id, tries);
            if (tries > maxRetries) {
              _update(local_id, {
                status: 'failed',
                error: data?.error || `HTTP ${resp.status}`,
              });
              return;
            }
            pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
            return;
          }
          // 成功响应
          retryCountRef.current.set(task_id, 0);
          const status = (data.status || '').toLowerCase();
          if (status === 'queued' || status === 'running') {
            _update(local_id, { status: 'running' });
            pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
            return;
          }
          if (status === 'done' || status === 'succeeded' || status === 'completed') {
            // 取完整结果 (status 端点不带 utterances 时 fallback 到 result 端点)
            let utterances = data.utterances;
            if (!utterances || utterances.length === 0) {
              try {
                const r = await fetch(`${basePath}/file-asr/result/${task_id}`);
                const rd = await r.json();
                utterances = rd.utterances;
              } catch {
                /* 忽略, 用空 */
              }
            }
            const utts: Utterance[] = (utterances || []).map((u: any) => ({
              text: u.text || '',
              start_time: u.start_time || 0,
              end_time: u.end_time || 0,
              speaker_id: u.speaker_id || 'unknown',
              definite: u.definite !== undefined ? u.definite : true,
            }));
            const text = utts.map((u) => u.text).join('');
            const dispatchPayload: TranscriptionAction = {
              type: 'TRANSCRIPT_FINAL',
              result: {
                text,
                isFinal: true,
                fullText: text,
                utterances: utts,
                // 用 0 作为累积结束信号: 文件识别是独立结果, 不与实时累积合并
                isCumulative: false,
              } as TranscriptionResult,
            };
            // merge 入口: 与实时转写统一展示
            dispatch(dispatchPayload);
            _update(local_id, {
              status: 'done',
              progress: 1,
              finished_at: _now(),
              result: { text, utterances: utts },
              merged_dispatch_payload: dispatchPayload,
            });
            return;
          }
          if (status === 'failed') {
            _update(local_id, {
              status: 'failed',
              error: data.error || 'task failed',
              finished_at: _now(),
            });
            return;
          }
          // 未知状态: 继续轮询
          pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
        } catch (e: any) {
          const tries = (retryCountRef.current.get(task_id) || 0) + 1;
          retryCountRef.current.set(task_id, tries);
          if (tries > maxRetries) {
            _update(local_id, {
              status: 'failed',
              error: e?.message || 'poll network error',
            });
            return;
          }
          pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
        }
      };
      pollTimersRef.current.set(task_id, setTimeout(tick, 200) as any);
    },
    [basePath, dispatch, maxRetries, pollIntervalMs, _update],
  );

  // ------------------------------------------------------------------
  // Retry: 用 fileUrl 重新 submit
  // ------------------------------------------------------------------
  const retry = useCallback(
    async (local_id: string, fileUrl: string) => {
      const t = tasksRef.current.find((x) => x.local_id === local_id);
      if (!t) return;
      // 取消旧 task 的轮询
      if (t.task_id) {
        const tm = pollTimersRef.current.get(t.task_id);
        if (tm) {
          clearTimeout(tm);
          pollTimersRef.current.delete(t.task_id);
        }
      }
      _update(local_id, { status: 'uploading', error: undefined, task_id: undefined });
      try {
        const resp = await fetch(`${basePath}/file-asr/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_url: fileUrl,
            enable_diarization: true,
            speaker_count: -1,
            enable_itn: true,
            enable_punc: true,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          _update(local_id, {
            status: 'failed',
            error: data?.error || `HTTP ${resp.status}`,
          });
          return;
        }
        const submitResp = data as SubmitResponse;
        _update(local_id, { status: 'submitted', task_id: submitResp.task_id });
        _schedulePoll(local_id, submitResp.task_id);
      } catch (e: any) {
        _update(local_id, {
          status: 'failed',
          error: e?.message || 'retry network error',
        });
      }
    },
    [basePath, _update, _schedulePoll],
  );

  // ------------------------------------------------------------------
  // Cancel
  // ------------------------------------------------------------------
  const cancel = useCallback(
    (local_id: string) => {
      const t = tasksRef.current.find((x) => x.local_id === local_id);
      if (t?.task_id) {
        const tm = pollTimersRef.current.get(t.task_id);
        if (tm) {
          clearTimeout(tm);
          pollTimersRef.current.delete(t.task_id);
        }
      }
      setTasks((prev) => prev.filter((x) => x.local_id !== local_id));
    },
    [],
  );

  const clearFinished = useCallback(() => {
    setTasks((prev) =>
      prev.filter((t) => t.status !== 'done' && t.status !== 'failed'),
    );
  }, []);

  return {
    tasks,
    isUploading,
    submit,
    retry,
    cancel,
    clearFinished,
  };
};
