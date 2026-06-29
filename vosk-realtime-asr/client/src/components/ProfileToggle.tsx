/**
 * ProfileToggle — 模块 C
 *
 * 纯净模式 / 会议模式 切换. 给 Sidebar 用.
 * - 录音中禁用 (切换需要重新 init AudioContext)
 * - 当前激活 profile 有视觉高亮
 * - onChange 回调把选中的 profile id 透传给上层, 由 useRecorder 在下次 start() 时应用
 *
 * 模型: MiniMax-M3
 */
import React from 'react';
import type { AudioProfileId } from '../types';
import { AUDIO_PROFILES } from '../types';

export interface ProfileToggleProps {
  value: AudioProfileId;
  onChange?: (id: AudioProfileId) => void;
  disabled?: boolean;
  className?: string;
}

export const ProfileToggle: React.FC<ProfileToggleProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const profiles = Object.values(AUDIO_PROFILES);

  return (
    <div
      className={`profile-toggle ${className}`}
      role="radiogroup"
      aria-label="音频 profile"
      data-profile-toggle
      data-active={value}
    >
      {profiles.map((profile) => {
        const active = profile.id === value;
        return (
          <button
            key={profile.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={`profile-toggle-btn ${active ? 'is-active' : ''}`}
            onClick={() => {
              if (disabled) return;
              if (active) return;
              onChange?.(profile.id);
            }}
            title={profile.description}
            data-profile-id={profile.id}
          >
            <span className="profile-toggle-dot" aria-hidden="true" />
            <span className="profile-toggle-label">{profile.label}</span>
          </button>
        );
      })}
    </div>
  );
};

ProfileToggle.displayName = 'ProfileToggle';

export default ProfileToggle;
