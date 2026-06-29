/**
 * useVoiceCloning — 声音复刻 2.0 主流程 hook
 *
 * 状态机 (reducer-driven):
 *   idle → recording → uploading → training → ready
 *                                 ↘ failed (任意阶段可 ERROR)
 *
 * 流程:
 *   1. startRecording() → phase=recording (consumer 用 AudioCapture 录音)
 *   2. onRecordingDone(blob) → 自动 upload → train → pollUntilTerminal
 *   3. 成功 → phase=ready, voiceId 持久化到 localStorage (key: voice-portfolio:voice-cloning:active)
 *
 * 暴露:
 *   state: VoiceState
 *   startRecording()
 *   onRecordingDone(blob)
 *   reset()
 *   setVoiceName(name)
 *
 * 模型: MiniMax-M3
 */
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import {
  voiceCloningReducer,
  initialVoiceState,
  type VoiceState,
} from '../state/voiceCloningReducer';
import {
  uploadAudio,
  trainVoice,
  fetchTrainStatus,
  pollUntilTerminal,
  listVoices as _listVoices,
  deleteVoice as _deleteVoice,
  type VoiceInfo,
} from '../utils/voiceCloningApi';

const STORAGE_KEY = 'voice-portfolio:voice-cloning:active';

export interface UseVoiceCloningOpts {
  /** 用户/说话人 id, 用于音色归属 */
  speakerId: string;
  /** 采样率 (默认 16000) */
  sampleRate?: number;
  /** 轮询间隔 (ms, 默认 2000) */
  pollIntervalMs?: number;
  /** 最大等待时间 (ms, 默认 10min) */
  maxWaitMs?: number;
  /** 音色默认名称 */
  defaultVoiceName?: string;
}

export interface UseVoiceCloningReturn {
  state: VoiceState;
  voices: VoiceInfo[];
  startRecording: () => void;
  onRecordingDone: (blob: Blob) => Promise<void>;
  reset: () => void;
  setVoiceName: (name: string) => void;
  refreshVoices: () => Promise<void>;
  deleteVoice: (voiceId: string) => Promise<void>;
  setActiveVoice: (voiceId: string | null) => void;
  activeVoiceId: string | null;
}

export function useVoiceCloning(opts: UseVoiceCloningOpts): UseVoiceCloningReturn {
  const [state, dispatch] = useReducer(voiceCloningReducer, initialVoiceState);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(
    () => readActiveVoiceId(),
  );

  // 初始化时拉一次音色列表
  const refreshVoices = useCallback(async () => {
    try {
      const list = await _listVoices(opts.speakerId);
      setVoices(list);
    } catch (e) {
      console.warn('[VoiceCloning] listVoices failed:', e);
    }
  }, [opts.speakerId]);

  useEffect(() => {
    refreshVoices();
  }, [refreshVoices]);

  const startRecording = useCallback(() => {
    dispatch({ type: 'START_RECORDING' });
  }, []);

  const onRecordingDone = useCallback(
    async (blob: Blob) => {
      dispatch({ type: 'RECORDING_DONE', blob });

      try {
        // Step 2: upload
        const upload = await uploadAudio(blob, {
          speakerId: opts.speakerId,
          sampleRate: opts.sampleRate ?? 16000,
        });

        // Step 3: train
        const train = await trainVoice({
          audioId: upload.audio_id,
          voiceName: opts.defaultVoiceName ?? '我的声音',
          speakerId: opts.speakerId,
        });
        dispatch({
          type: 'UPLOAD_DONE',
          audioId: upload.audio_id,
          taskId: train.task_id,
        });

        // Step 4: poll
        const final = await pollUntilTerminal(train.task_id, {
          fetchStatus: (tid) => fetchTrainStatus(tid),
          intervalMs: opts.pollIntervalMs ?? 2000,
          maxWaitMs: opts.maxWaitMs ?? 600_000,
          onPoll: (s) => {
            dispatch({
              type: 'SET_STATUS',
              statusText: s.status === 'training' ? '正在训练...' : `状态: ${s.status}`,
            });
          },
        });

        if (final.status === 'success' && final.voice_id) {
          dispatch({ type: 'TRAIN_DONE', voiceId: final.voice_id });
          setActiveVoice(final.voice_id);
          await refreshVoices();
        } else {
          dispatch({
            type: 'ERROR',
            message:
              final.status === 'timeout'
                ? '训练超时, 请重试'
                : (final as any).error?.message ?? '训练失败',
          });
        }
      } catch (e: any) {
        dispatch({ type: 'ERROR', message: e?.message ?? String(e) });
      }
    },
    [opts.speakerId, opts.sampleRate, opts.defaultVoiceName, opts.pollIntervalMs, opts.maxWaitMs, refreshVoices],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const setVoiceName = useCallback((name: string) => {
    dispatch({ type: 'SET_VOICE_NAME', voiceName: name });
  }, []);

  const deleteVoiceById = useCallback(
    async (voiceId: string) => {
      try {
        await _deleteVoice(voiceId);
        await refreshVoices();
        if (activeVoiceId === voiceId) {
          setActiveVoice(null);
        }
      } catch (e) {
        console.warn('[VoiceCloning] delete failed:', e);
      }
    },
    [refreshVoices, activeVoiceId],
  );

  const setActiveVoice = useCallback((voiceId: string | null) => {
    setActiveVoiceId(voiceId);
    if (voiceId) {
      try {
        localStorage.setItem(STORAGE_KEY, voiceId);
      } catch {
        // ignore quota errors
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  return {
    state,
    voices,
    startRecording,
    onRecordingDone,
    reset,
    setVoiceName,
    refreshVoices,
    deleteVoice: deleteVoiceById,
    setActiveVoice,
    activeVoiceId,
  };
}

// 工具: 读 localStorage
function readActiveVoiceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
