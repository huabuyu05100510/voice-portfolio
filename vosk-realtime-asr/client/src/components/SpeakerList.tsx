/**
 * SpeakerList — Sprint 9
 * 说话人列表, 按颜色编码, 当前说话人高亮
 *
 * Author: Claude Opus 4.8
 */
import React from 'react';
import type { Speaker } from '../types';
import { SpeakerCard } from './SpeakerCard';

export interface SpeakerListProps {
  speakers: Speaker[];
  currentSpeakerId: string | null;
  isRecording: boolean;
}

export const SpeakerList: React.FC<SpeakerListProps> = React.memo((p) => {
  if (p.speakers.length === 0) {
    return (
      <div className="speaker-empty">
        {p.isRecording ? '正在识别说话人...' : '尚未识别说话人'}
      </div>
    );
  }

  return (
    <div className="speaker-list" role="list">
      {p.speakers.map((s, idx) => (
        <SpeakerCard
          key={s.id}
          speaker={s}
          index={idx}
          active={s.id === p.currentSpeakerId}
        />
      ))}
    </div>
  );
});

SpeakerList.displayName = 'SpeakerList';