/**
 * voiceCloningReducer — 声音复刻 2.0 客户端状态机 (pure reducer)
 *
 * Phase 状态机:
 *   idle → recording → uploading → training → ready
 *                                 ↘ failed (任意阶段可 ERROR)
 *   ready/failed → idle (RESET)
 *
 * 关键 invariant:
 *   - blob 仅在 uploading 阶段保留 (录音结束后, 上传前)
 *   - voiceId 仅在 ready 阶段存在
 *   - reducer 纯函数: 同一 (state, action) → 同一 next
 *
 * 模型: MiniMax-M3
 */

export type VoicePhase =
  | 'idle'
  | 'recording'
  | 'uploading'
  | 'training'
  | 'ready'
  | 'failed';

export interface VoiceState {
  phase: VoicePhase;
  /** 录音得到的 PCM/WAV Blob (uploading 阶段保留) */
  blob: Blob | null;
  /** 服务端返回的 audio_id */
  audioId: string | null;
  /** 服务端返回的 task_id */
  taskId: string | null;
  /** 训练成功的 voice_id (S_xxx) */
  voiceId: string | null;
  /** 用户取的音色名称 */
  voiceName: string | null;
  /** 当前训练状态文字 (轮询更新: '训练中: 60%') */
  statusText: string | null;
  /** 错误信息 (phase=failed 时) */
  error: string | null;
}

export type VoiceCloningAction =
  | { type: 'START_RECORDING' }
  | { type: 'RECORDING_DONE'; blob: Blob }
  | { type: 'UPLOAD_DONE'; audioId: string; taskId?: string }
  | { type: 'TRAIN_DONE'; voiceId: string }
  | { type: 'SET_STATUS'; statusText: string }
  | { type: 'SET_VOICE_NAME'; voiceName: string }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

export const initialVoiceState: VoiceState = {
  phase: 'idle',
  blob: null,
  audioId: null,
  taskId: null,
  voiceId: null,
  voiceName: null,
  statusText: null,
  error: null,
};

export function voiceCloningReducer(state: VoiceState, action: VoiceCloningAction): VoiceState {
  switch (action.type) {
    case 'START_RECORDING':
      return { ...state, phase: 'recording', error: null };

    case 'RECORDING_DONE':
      return { ...state, phase: 'uploading', blob: action.blob, error: null };

    case 'UPLOAD_DONE':
      return {
        ...state,
        phase: 'training',
        audioId: action.audioId,
        taskId: action.taskId ?? state.taskId,
        statusText: '正在训练...',
      };

    case 'TRAIN_DONE':
      return {
        ...state,
        phase: 'ready',
        voiceId: action.voiceId,
        statusText: '训练完成',
        blob: null,
        error: null,
      };

    case 'SET_STATUS':
      return { ...state, statusText: action.statusText };

    case 'SET_VOICE_NAME':
      return { ...state, voiceName: action.voiceName };

    case 'ERROR':
      return { ...state, phase: 'failed', error: action.message };

    case 'RESET':
      return initialVoiceState;

    default:
      return state;
  }
}
