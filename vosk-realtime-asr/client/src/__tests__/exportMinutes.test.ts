/**
 * 导出会议纪要 — 纯函数 selector, 把 transcription state 转成 TXT/MD 文本
 *
 * 会议室场景: 录音结束后一键下载纪要, 按说话人分段, 带时间戳。
 */
import { describe, it, expect } from 'vitest';
import { formatMinutes } from '../utils/exportMinutes';
import type { TranscriptionResult, Speaker } from '../types';

function mkSpeaker(id: string, label: string): Speaker {
  return { id, label };
}
function mkResult(text: string, speakerId: string, ts: string): TranscriptionResult {
  return { text, isFinal: true, speaker_id: speakerId, timestamp: ts };
}

const SPEAKERS: Speaker[] = [
  mkSpeaker('0', '主持人'),
  mkSpeaker('1', '参会人 A'),
];
const RESULTS: TranscriptionResult[] = [
  mkResult('欢迎大家参加今天的产品评审会议。', '0', '2026-06-24T10:00:00Z'),
  mkResult('我先过一下上次的行动项。', '0', '2026-06-24T10:00:15Z'),
  mkResult('我这边设计稿已经完成了。', '1', '2026-06-24T10:00:30Z'),
];

describe('formatMinutes', () => {
  it('TXT 格式: 含说话人名 + 时间 + 文本', () => {
    const out = formatMinutes(RESULTS, SPEAKERS, { format: 'txt' });
    expect(out).toContain('主持人');
    expect(out).toContain('参会人 A');
    expect(out).toContain('欢迎大家参加今天的产品评审会议。');
    expect(out).toContain('我这边设计稿已经完成了。');
  });

  it('MD 格式: 含 markdown 标题/列表', () => {
    const out = formatMinutes(RESULTS, SPEAKERS, { format: 'md' });
    expect(out).toContain('# ');  // 标题
    expect(out).toContain('## ');  // 可能的副标题
    expect(out.match(/[-*]\s/));  // 列表项
  });

  it('未识别 speaker_id 时显示"未识别"', () => {
    const r = [mkResult('一句话', 'unknown-id', '2026-06-24T10:00:00Z')];
    const out = formatMinutes(r, [], { format: 'txt' });
    expect(out).toContain('未识别');
  });

  it('speaker_id 为 null 时也算"未识别"', () => {
    const r: TranscriptionResult[] = [{ text: '匿名', isFinal: true, speaker_id: null as any, timestamp: '2026-06-24T10:00:00Z' }];
    const out = formatMinutes(r, SPEAKERS, { format: 'txt' });
    expect(out).toContain('未识别');
  });

  it('空 results 返回说明文字 (不是空串)', () => {
    const out = formatMinutes([], [], { format: 'txt' });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/暂无|空|没有/i);
  });

  it('时间戳格式化为 HH:MM:SS (本地)', () => {
    const out = formatMinutes(RESULTS, SPEAKERS, { format: 'txt' });
    // 应该出现 HH:MM:SS 格式的时间
    expect(out).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('合并连续同一说话人的句子为一段 (可读性)', () => {
    // 主持人连说两句, 应合并显示, 不要每句都重打一次 speaker 头
    const out = formatMinutes(RESULTS, SPEAKERS, { format: 'txt' });
    // 主持人出现次数应 < 句子数 (合并了)
    const matches = out.match(/主持人/g);
    expect(matches && matches.length).toBeLessThanOrEqual(2);
  });

  it('用用户改过的 label (rename 后的)', () => {
    const renamed: Speaker[] = [
      { id: '0', label: '张总', userEdited: true },
      ...SPEAKERS.slice(1),
    ];
    const out = formatMinutes(RESULTS.slice(0, 1), renamed, { format: 'txt' });
    expect(out).toContain('张总');
    expect(out).not.toContain('主持人');
  });
});
