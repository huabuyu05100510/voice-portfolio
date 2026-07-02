/**
 * useFileAsr — 录音文件识别 2.0 客户端 hook
 *
 * 职责:
 *   - submit(file)             POST /api/file-asr/upload (multipart) — streaming ASR
 *   - poll(task_id)            GET  /api/file-asr/status/<id>  (轮询, legacy)
 *   - result(task_id)          GET  /api/file-asr/result/<id>  (final, legacy)
 *   - 把 final result 通过 dispatch(TRANSCRIPT_FINAL) 注入到 transcriptionReducer,
 *     与实时转写统一在 Hero 区展示.
 *
 * 状态机 (per task):
 *   uploading → submitted → running → done
 *                    ↓           ↓
 *                  failed    failed
 *   cancelled (cancel 保留记录, 不删除)
 *
 * Author: MiniMax-M3 (2026-06-27)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
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
  local_id: string;
  task_id?: string;
  filename: string;
  size_bytes: number;
  format: string;
  status: FileAsrStatus;
  error?: string;
  progress?: number;
  finished_at?: number;
  created_at: number;
  result?: { text: string; utterances: Utterance[] };
  merged_dispatch_payload?: TranscriptionAction;
}

export interface UseFileAsrOptions {
  dispatch: Dispatch<TranscriptionAction>;
  pollIntervalMs?: number;
  maxRetries?: number;
  basePath?: string;
  fileRef?: MutableRefObject<Map<string, File>>;
}

export interface UseFileAsrReturn {
  tasks: FileAsrTask[];
  isUploading: boolean;
  submit: (
    file: File | string,
    meta: { filename: string; size_bytes: number; format?: string },
  ) => Promise<FileAsrTask>;
  retry: (local_id: string, fileUrl: string) => Promise<void>;
  cancel: (local_id: string) => void;
  clearFinished: () => void;
}

interface SubmitResponse { task_id: string; status: string; }
interface StatusResponse {
  task_id: string; status: string; error?: string; progress?: number;
  utterances?: Array<{
    text: string; start_time: number; end_time: number;
    speaker_id: string; words?: any[]; definite?: boolean;
  }>;
}

function _uuid(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
    return (crypto as any).randomUUID();
  return 'loc-' + Math.random().toString(36).slice(2, 10);
}
function _now(): number { return Date.now(); }

export const useFileAsr = (opts: UseFileAsrOptions): UseFileAsrReturn => {
  const {
    dispatch, pollIntervalMs = 2000, maxRetries = 3,
    basePath = '/api', fileRef,
  } = opts;
  const [tasks, setTasks] = useState<FileAsrTask[]>([]);
  const tasksRef = useRef<FileAsrTask[]>([]);
  const pollTimersRef = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const retryCountRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => () => {
    mountedRef.current = false;
    for (const t of pollTimersRef.current.values()) clearTimeout(t);
    pollTimersRef.current.clear();
  }, []);

  const isUploading = tasks.some((t) => t.status === 'uploading');

  const _update = useCallback((local_id: string, patch: Partial<FileAsrTask>) => {
    setTasks((prev) => prev.map((t) => (t.local_id === local_id ? { ...t, ...patch } : t)));
  }, []);

  // ---- Poll (must be before submit) ----
  const _schedulePoll = useCallback(
    (local_id: string, task_id: string) => {
      const tick = async () => {
        if (!mountedRef.current) return;
        try {
          const resp = await fetch(`${basePath}/file-asr/status/${task_id}`);
          const data = (await resp.json()) as StatusResponse;
          if (!resp.ok) {
            const tries = (retryCountRef.current.get(task_id) || 0) + 1;
            retryCountRef.current.set(task_id, tries);
            if (tries > maxRetries) {
              _update(local_id, { status: 'failed', error: data?.error || `HTTP ${resp.status}` });
              return;
            }
            pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
            return;
          }
          retryCountRef.current.set(task_id, 0);
          const status = (data.status || '').toLowerCase();
          if (status === 'queued' || status === 'running') {
            const serverProgress = data.progress;
            _update(local_id, { status: 'running',
              progress: serverProgress != null ? serverProgress :
                (tasksRef.current.find((t) => t.local_id === local_id)?.progress || 0.3) });
            pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
            return;
          }
          if (status === 'done' || status === 'succeeded' || status === 'completed') {
            let utterances = data.utterances;
            if (!utterances || utterances.length === 0) {
              try {
                const r = await fetch(`${basePath}/file-asr/result/${task_id}`);
                const rd = await r.json();
                utterances = rd.utterances;
              } catch { /* ignore */ }
            }
            const utts: Utterance[] = (utterances || []).map((u: any) => ({
              text: u.text || '', start_time: u.start_time || 0, end_time: u.end_time || 0,
              speaker_id: u.speaker_id || 'unknown',
              definite: u.definite !== undefined ? u.definite : true,
            }));
            const text = utts.map((u) => u.text).join('');
            const dp: TranscriptionAction = { type: 'TRANSCRIPT_FINAL',
              result: { text, isFinal: true, fullText: text, utterances: utts, isCumulative: false } as TranscriptionResult };
            dispatch(dp);
            _update(local_id, { status: 'done', progress: 1, finished_at: _now(),
              result: { text, utterances: utts }, merged_dispatch_payload: dp });
            return;
          }
          if (status === 'failed') {
            _update(local_id, { status: 'failed', error: data.error || 'task failed', finished_at: _now() });
            return;
          }
          pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
        } catch (e: any) {
          const tries = (retryCountRef.current.get(task_id) || 0) + 1;
          retryCountRef.current.set(task_id, tries);
          if (tries > maxRetries) {
            _update(local_id, { status: 'failed', error: e?.message || 'poll network error' });
            return;
          }
          pollTimersRef.current.set(task_id, setTimeout(tick, pollIntervalMs) as any);
        }
      };
      pollTimersRef.current.set(task_id, setTimeout(tick, 200) as any);
    },
    [basePath, dispatch, maxRetries, pollIntervalMs, _update],
  );

  // ---- Submit (multipart file → streaming ASR) ----
  const submit = useCallback(
    async (fileOrUrl: File | string, meta: { filename: string; size_bytes: number; format?: string }): Promise<FileAsrTask> => {
      const local_id = _uuid();
      const task: FileAsrTask = { local_id, filename: meta.filename, size_bytes: meta.size_bytes,
        format: meta.format || 'mp3', status: 'uploading', created_at: _now() };
      setTasks((prev) => [task, ...prev]);

      const progressInterval = setInterval(() => {
        setTasks((prev) => prev.map((t) => {
          if (t.local_id !== local_id || (t.progress != null && t.progress >= 0.9)) return t;
          return { ...t, progress: Math.min((t.progress || 0) + 0.05, 0.9) };
        }));
      }, 400);

      try {
        let resp: Response;
        if (fileOrUrl instanceof File) {
          const formData = new FormData();
          formData.append('file', fileOrUrl, meta.filename);
          resp = await fetch(`${basePath}/file-asr/upload`, { method: 'POST', body: formData });
        } else {
          resp = await fetch(`${basePath}/file-asr/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_url: fileOrUrl, enable_diarization: true,
              speaker_count: -1, enable_itn: true, enable_punc: true }),
          });
        }
        clearInterval(progressInterval);
        const data = await resp.json();
        if (!resp.ok) {
          const msg = data?.error || `submit failed: HTTP ${resp.status}`;
          _update(local_id, { status: 'failed', error: msg, progress: undefined });
          return { ...task, status: 'failed', error: msg };
        }
        if (data.ok && data.utterances !== undefined) {
          const utts: Utterance[] = (data.utterances || []).map((u: any) => ({
            text: u.text || '', start_time: u.start_time || 0, end_time: u.end_time || 0,
            speaker_id: u.speaker_id || 'unknown',
            definite: u.definite !== undefined ? u.definite : true,
          }));
          const text = utts.map((u) => u.text).join('');
          const dp: TranscriptionAction = { type: 'TRANSCRIPT_FINAL',
            result: { text, isFinal: true, fullText: text, utterances: utts, isCumulative: false } as TranscriptionResult };
          dispatch(dp);
          _update(local_id, { status: 'done', progress: 1, finished_at: _now(),
            result: { text, utterances: utts }, merged_dispatch_payload: dp });
          return { ...task, status: 'done', task_id: data.task_id };
        }
        const sr = data as SubmitResponse;
        _update(local_id, { status: 'submitted', task_id: sr.task_id, progress: 0 });
        _schedulePoll(local_id, sr.task_id);
        return { ...task, status: 'submitted', task_id: sr.task_id };
      } catch (e: any) {
        clearInterval(progressInterval);
        const msg = e?.message || 'submit network error';
        _update(local_id, { status: 'failed', error: msg, progress: undefined });
        return { ...task, status: 'failed', error: msg };
      }
    },
    [basePath, dispatch, _update, _schedulePoll],
  );

  // ---- Retry ----
  const retry = useCallback(
    async (local_id: string, _fileUrl: string) => {
      const t = tasksRef.current.find((x) => x.local_id === local_id);
      if (!t) return;
      if (t.task_id) {
        const tm = pollTimersRef.current.get(t.task_id);
        if (tm) { clearTimeout(tm); pollTimersRef.current.delete(t.task_id); }
      }
      _update(local_id, { status: 'uploading', error: undefined, task_id: undefined, progress: 0 });
      const f = fileRef?.current?.get(local_id);
      if (f) {
        try {
          const formData = new FormData();
          formData.append('file', f, t.filename);
          const resp = await fetch(`${basePath}/file-asr/upload`, { method: 'POST', body: formData });
          const data = await resp.json();
          if (!resp.ok) { _update(local_id, { status: 'failed', error: data?.error || `HTTP ${resp.status}`, progress: undefined }); return; }
          if (data.ok && data.utterances !== undefined) {
            const utts: Utterance[] = (data.utterances || []).map((u: any) => ({
              text: u.text || '', start_time: u.start_time || 0, end_time: u.end_time || 0,
              speaker_id: u.speaker_id || 'unknown', definite: u.definite !== undefined ? u.definite : true,
            }));
            const text = utts.map((u) => u.text).join('');
            const dp: TranscriptionAction = { type: 'TRANSCRIPT_FINAL',
              result: { text, isFinal: true, fullText: text, utterances: utts, isCumulative: false } as TranscriptionResult };
            dispatch(dp);
            _update(local_id, { status: 'done', progress: 1, finished_at: _now(),
              result: { text, utterances: utts }, merged_dispatch_payload: dp });
            return;
          }
          _update(local_id, { status: 'submitted', task_id: data.task_id, progress: 0 });
          _schedulePoll(local_id, data.task_id);
          return;
        } catch (e: any) {
          _update(local_id, { status: 'failed', error: e?.message || 'retry network error', progress: undefined });
          return;
        }
      }
      try {
        const resp = await fetch(`${basePath}/file-asr/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_url: _fileUrl, enable_diarization: true,
            speaker_count: -1, enable_itn: true, enable_punc: true }),
        });
        const data = await resp.json();
        if (!resp.ok) { _update(local_id, { status: 'failed', error: data?.error || `HTTP ${resp.status}`, progress: undefined }); return; }
        const sr = data as SubmitResponse;
        _update(local_id, { status: 'submitted', task_id: sr.task_id, progress: 0 });
        _schedulePoll(local_id, sr.task_id);
      } catch (e: any) {
        _update(local_id, { status: 'failed', error: e?.message || 'retry network error', progress: undefined });
      }
    },
    [basePath, dispatch, _update, _schedulePoll, fileRef],
  );

  // ---- Cancel (mark cancelled, keep in list) ----
  const cancel = useCallback(
    (local_id: string) => {
      const t = tasksRef.current.find((x) => x.local_id === local_id);
      if (t?.task_id) {
        const tm = pollTimersRef.current.get(t.task_id);
        if (tm) { clearTimeout(tm); pollTimersRef.current.delete(t.task_id); }
      }
      _update(local_id, { status: 'cancelled', finished_at: _now() });
    }, [_update]);

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled'));
  }, []);

  return { tasks, isUploading, submit, retry, cancel, clearFinished };
};