/**
 * textBuffer — 智能拼接 final 文本
 * 对照 server/text_buffer.py:smart_append, 行为等价
 */

export interface SmartAppendResult {
  buffer: string;
  changed: boolean;
}

export function smartAppend(buffer: string, newText: string): SmartAppendResult {
  if (!newText) return { buffer, changed: false };
  if (!buffer) return { buffer: newText + ' ', changed: true };

  const bufStripped = buffer.replace(/\s+$/, '');

  // 累积模式: newText 是 buffer 的扩展
  if (newText.length > bufStripped.length && newText.startsWith(bufStripped)) {
    return { buffer: newText + ' ', changed: true };
  }

  // 重复推送: newText 是 buffer 的子串
  if (bufStripped.includes(newText)) {
    return { buffer, changed: false };
  }

  // 部分重叠
  if (newText.length > 0 && bufStripped.length > 0) {
    let common = 0;
    const maxCheck = Math.min(newText.length, bufStripped.length);
    while (common < maxCheck && newText[common] === bufStripped[common]) {
      common += 1;
    }
    if (common >= 10) return { buffer: newText + ' ', changed: true };
    const tail = bufStripped.slice(-30);
    if (tail && newText.includes(tail)) {
      return { buffer: newText + ' ', changed: true };
    }
  }

  // 完全独立, 追加
  const last = bufStripped[bufStripped.length - 1];
  const sep =
    !bufStripped || '。？！\n'.includes(last ?? '') ? '' : ' ';
  return { buffer: buffer + sep + newText + ' ', changed: true };
}

export function getLastSpeaker(
  utterances: Array<Record<string, any>>,
): string | null {
  if (!utterances?.length) return null;
  for (let i = utterances.length - 1; i >= 0; i--) {
    const u = utterances[i];
    const sid = u.speaker_id ?? u.additions?.speaker_id;
    if (sid) return sid;
  }
  return null;
}

export function extractTextFromUtterances(
  utterances: Array<Record<string, any>>,
): string {
  const parts: string[] = [];
  for (const u of utterances ?? []) {
    const t = (u.text ?? '').trim();
    if (t) parts.push(t);
  }
  return parts.join(' ');
}
