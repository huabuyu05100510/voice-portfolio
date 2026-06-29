/**
 * 导出会议纪要 — 纯函数
 *
 * 把 TranscriptionResult[] + Speaker[] 转成 TXT / Markdown 文本,
 * 按说话人分段合并连续句子, 带时间戳。
 *
 * 设计要点:
 * - 纯函数, 同输入同输出 (TDD 友好)
 * - 不依赖 DOM (下载触发在调用方)
 * - 用 Speaker.userEdited 标记后的 label (用户改名优先)
 */
import type { TranscriptionResult, Speaker } from '../types';

export type MinutesFormat = 'txt' | 'md';

export interface MinutesOptions {
  format: MinutesFormat;
  /** 会议标题 (可选) */
  title?: string;
}

const UNKNOWN_LABEL = '未识别';

function formatTime(ts?: string): string {
  if (!ts) return '--:--:--';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--:--:--';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '--:--:--';
  }
}

function speakerLabel(id: string | null | undefined, speakers: Speaker[]): string {
  if (!id) return UNKNOWN_LABEL;
  const s = speakers.find((sp) => sp.id === id);
  return s?.label || UNKNOWN_LABEL;
}

interface Segment {
  speakerId: string | null | undefined;
  speakerLabel: string;
  startTime: string;
  texts: string[];
}

function segmentBySpeaker(results: TranscriptionResult[], speakers: Speaker[]): Segment[] {
  const segments: Segment[] = [];
  for (const r of results) {
    const label = speakerLabel(r.speaker_id, speakers);
    const last = segments[segments.length - 1];
    if (last && last.speakerId === r.speaker_id) {
      // 合并连续同一说话人
      last.texts.push(r.text || '');
    } else {
      segments.push({
        speakerId: r.speaker_id,
        speakerLabel: label,
        startTime: formatTime(r.timestamp),
        texts: [r.text || ''],
      });
    }
  }
  return segments;
}

export function formatMinutes(
  results: TranscriptionResult[],
  speakers: Speaker[],
  opts: MinutesOptions,
): string {
  if (results.length === 0) {
    return opts.format === 'md'
      ? `# ${opts.title ?? '会议纪要'}\n\n_暂无转写内容_\n`
      : `${opts.title ?? '会议纪要'}\n\n暂无转写内容\n`;
  }

  const segments = segmentBySpeaker(results, speakers);
  const title = opts.title ?? '会议纪要';
  const date = new Date().toLocaleString('zh-CN');

  if (opts.format === 'md') {
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push('');
    lines.push(`> 生成时间: ${date} · 共 ${results.length} 句 · ${speakers.length} 位说话人`);
    lines.push('');
    lines.push('## 发言记录');
    lines.push('');
    for (const seg of segments) {
      lines.push(`### ${seg.speakerLabel} · \`${seg.startTime}\``);
      lines.push('');
      for (const t of seg.texts) {
        if (t.trim()) lines.push(`- ${t}`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push('## 说话人');
    lines.push('');
    for (const s of speakers) {
      lines.push(`- **${s.label}** (\`${s.id}\`${s.userEdited ? ' · 已重命名' : ''})`);
    }
    return lines.join('\n');
  }

  // TXT
  const lines: string[] = [];
  lines.push(`${title}`);
  lines.push(`生成时间: ${date}  共 ${results.length} 句  ${speakers.length} 位说话人`);
  lines.push('='.repeat(48));
  lines.push('');
  for (const seg of segments) {
    lines.push(`[${seg.startTime}] ${seg.speakerLabel}:`);
    for (const t of seg.texts) {
      if (t.trim()) lines.push(`  ${t}`);
    }
    lines.push('');
  }
  lines.push('-'.repeat(48));
  lines.push('说话人:');
  for (const s of speakers) {
    lines.push(`  - ${s.label} (id=${s.id})`);
  }
  return lines.join('\n');
}

/**
 * 在浏览器触发下载 — 唯一有副作用的函数 (单独放这, 便于隔离测试)
 */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟回收, 避免有些浏览器下载未完成就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function defaultFilename(format: MinutesFormat): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `会议纪要_${stamp}.${format}`;
}
