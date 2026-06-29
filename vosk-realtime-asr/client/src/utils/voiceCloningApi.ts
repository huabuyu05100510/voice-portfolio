/**
 * voiceCloningApi — 声音复刻 2.0 后端 API 客户端 (浏览器侧)
 *
 * 4 个 endpoint:
 *   POST /api/voice/upload         multipart audio → { audio_id, duration, ... }
 *   POST /api/voice/train          JSON  { audio_id, voice_name, speaker_id } → { voice_id, task_id, status }
 *   GET  /api/voice/train/status?task_id=xxx → { status, voice_id? }
 *   GET  /api/voice/list?speaker_id=xxx      → { voices: [...] }
 *   DELETE /api/voice/delete?voice_id=xxx    → { code, message }
 *
 * 模型: MiniMax-M3
 */

const DEFAULT_BASE = '';

export interface UploadResponse {
  audio_id: string;
  duration: number;
  sample_rate: number;
}

export interface TrainResponse {
  voice_id: string;
  task_id: string;
  status: 'training' | 'success' | 'failed';
}

export interface TrainStatus {
  status: 'training' | 'success' | 'failed';
  voice_id?: string | null;
  error?: { code: number; message: string };
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  status: 'ready' | 'training' | 'failed';
  created_at: number;
}

/**
 * Blob → multipart/form-data.
 * 字段名 audio, 默认 filename=voice_sample.wav, mime=audio/wav.
 */
export function blobToFormData(
  blob: Blob,
  opts: { speakerId: string; sampleRate: number; filename?: string },
): FormData {
  const fd = new FormData();
  const filename = opts.filename ?? 'voice_sample.wav';
  const file = new File([blob], filename, { type: blob.type || 'audio/wav' });
  fd.append('audio', file, filename);
  fd.append('speaker_id', opts.speakerId);
  fd.append('sample_rate', String(opts.sampleRate));
  return fd;
}

/** POST /api/voice/upload */
export async function uploadAudio(
  blob: Blob,
  opts: { speakerId: string; sampleRate: number; filename?: string; baseUrl?: string },
  fetcher: typeof fetch = fetch,
): Promise<UploadResponse> {
  const fd = blobToFormData(blob, opts);
  const url = `${opts.baseUrl ?? DEFAULT_BASE}/api/voice/upload`;
  const resp = await fetcher(url, { method: 'POST', body: fd });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`upload failed ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

/** POST /api/voice/train */
export async function trainVoice(
  body: { audioId: string; voiceName: string; speakerId: string; baseUrl?: string },
  fetcher: typeof fetch = fetch,
): Promise<TrainResponse> {
  const url = `${body.baseUrl ?? DEFAULT_BASE}/api/voice/train`;
  const resp = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_id: body.audioId,
      voice_name: body.voiceName,
      speaker_id: body.speakerId,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`train failed ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

/** GET /api/voice/train/status?task_id=xxx */
export async function fetchTrainStatus(
  taskId: string,
  baseUrl: string = DEFAULT_BASE,
  fetcher: typeof fetch = fetch,
): Promise<TrainStatus> {
  const url = `${baseUrl}/api/voice/train/status?task_id=${encodeURIComponent(taskId)}`;
  const resp = await fetcher(url);
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`status failed ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

/** GET /api/voice/list */
export async function listVoices(
  speakerId: string,
  baseUrl: string = DEFAULT_BASE,
  fetcher: typeof fetch = fetch,
): Promise<VoiceInfo[]> {
  const url = `${baseUrl}/api/voice/list?speaker_id=${encodeURIComponent(speakerId)}`;
  const resp = await fetcher(url);
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`list failed ${resp.status}: ${t.slice(0, 200)}`);
  }
  const body = await resp.json();
  return body.voices ?? [];
}

/** DELETE /api/voice/delete */
export async function deleteVoice(
  voiceId: string,
  baseUrl: string = DEFAULT_BASE,
  fetcher: typeof fetch = fetch,
): Promise<{ code: number; message: string }> {
  const url = `${baseUrl}/api/voice/delete?voice_id=${encodeURIComponent(voiceId)}`;
  const resp = await fetcher(url, { method: 'DELETE' });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`delete failed ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * 轮询训练状态直到终态 (success / failed) 或超时.
 *
 * 返回值固定含 status: 'success' | 'failed' | 'timeout'.
 */
export async function pollUntilTerminal(
  taskId: string,
  opts: {
    fetchStatus: (taskId: string) => Promise<TrainStatus>;
    intervalMs: number;
    maxWaitMs: number;
    onPoll?: (state: TrainStatus, attempt: number) => void;
  },
): Promise<TrainStatus & { status: 'success' | 'failed' | 'timeout' }> {
  const deadline = Date.now() + opts.maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    let state: TrainStatus;
    try {
      state = await opts.fetchStatus(taskId);
    } catch (e) {
      // 轮询中网络错误不终止, 等下一轮
      await sleep(Math.min(opts.intervalMs, 1000));
      continue;
    }
    if (opts.onPoll) {
      try { opts.onPoll(state, attempt); } catch { /* ignore */ }
    }
    if (state.status === 'success' || state.status === 'failed') {
      return { ...state, status: state.status };
    }
    await sleep(opts.intervalMs);
  }
  return { status: 'timeout' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
