/**
 * VoiceLibrary — 音色库管理 UI
 *
 * 每个音色一张卡片:
 *   - 头像 (首字母)
 *   - 名称 + voice_id
 *   - 状态徽章 (ready / training / failed)
 *   - 试听按钮 (TTS 合成 → <audio> 播放)
 *   - 删除按钮
 *
 * 空态: "还没有音色, 点击上方「开始录制」"
 *
 * 模型: MiniMax-M3
 */
import React from 'react';
import type { VoiceInfo } from '../utils/voiceCloningApi';

export interface VoiceLibraryProps {
  voices: VoiceInfo[];
  /** 当前激活的 voice_id (高亮) */
  activeVoiceId?: string | null;
  /** 删除回调 */
  onDelete: (voiceId: string) => void;
  /** 试听回调 (consumer 用此触发 TTS) */
  onPreview: (voiceId: string) => void;
  /** 设为默认音色 (可选) */
  onSetActive?: (voiceId: string) => void;
}

export const VoiceLibrary: React.FC<VoiceLibraryProps> = (p) => {
  if (p.voices.length === 0) {
    return (
      <div className="voice-library voice-library-empty" role="status">
        <div className="voice-library-empty-icon" aria-hidden="true">
          ♪
        </div>
        <p className="voice-library-empty-text">
          还没有音色. 在上方「开始录制」一段 30 秒样本, 系统会为你训练专属音色.
        </p>
      </div>
    );
  }

  return (
    <ul className="voice-library" role="list" aria-label="音色库">
      {p.voices.map((v) => (
        <li
          key={v.voice_id}
          className={`voice-card ${
            p.activeVoiceId === v.voice_id ? 'is-active' : ''
          } voice-card-status-${v.status}`}
        >
          <div className="voice-card-avatar" aria-hidden="true">
            {(v.name || v.voice_id).charAt(0).toUpperCase()}
          </div>
          <div className="voice-card-info">
            <div className="voice-card-name" title={v.voice_id}>
              {v.name}
            </div>
            <div className="voice-card-id">{v.voice_id}</div>
            <div className={`voice-card-badge voice-card-badge-${v.status}`}>
              {statusLabel(v.status)} ({v.status})
            </div>
          </div>
          <div className="voice-card-actions">
            <button
              type="button"
              className="voice-card-btn voice-card-btn-preview"
              onClick={() => p.onPreview(v.voice_id)}
              aria-label={`试听 ${v.name}`}
              disabled={v.status !== 'ready'}
              title={v.status === 'ready' ? '试听' : '训练完成后可试听'}
            >
              试听
            </button>
            {p.onSetActive && v.status === 'ready' && (
              <button
                type="button"
                className="voice-card-btn voice-card-btn-set"
                onClick={() => p.onSetActive?.(v.voice_id)}
                aria-label={`设为默认 ${v.name}`}
              >
                {p.activeVoiceId === v.voice_id ? '已默认' : '设为默认'}
              </button>
            )}
            <button
              type="button"
              className="voice-card-btn voice-card-btn-delete"
              onClick={() => p.onDelete(v.voice_id)}
              aria-label={`删除 ${v.name}`}
            >
              删除
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};

function statusLabel(status: VoiceInfo['status']): string {
  switch (status) {
    case 'ready':
      return '就绪';
    case 'training':
      return '训练中';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

VoiceLibrary.displayName = 'VoiceLibrary';
