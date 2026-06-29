/**
 * extractUtterances — 从 final 响应里抽 utterances + speakers
 * 对照 server/volcengine_engine.py:extract_utterances, 行为等价.
 */
export interface ExtractedWord {
  word?: string;
  start?: number;
  end?: number;
  confidence?: number;
  [k: string]: unknown;
}

export interface ExtractedUtterance {
  text: string;
  start_time: number;
  end_time: number;
  speaker_id: string | null;
  words: ExtractedWord[];
  definite: boolean;
}

export interface ExtractedSpeaker {
  id: string;
  label: string;
}

export interface ExtractResult {
  utterances: ExtractedUtterance[];
  speakers: ExtractedSpeaker[];
}

export function extractUtterances(
  finalPayload: Record<string, any>,
): ExtractResult {
  // 兼容两种入参: 完整 {result:{utterances:[...]}} 或直接 {utterances:[...]}
  const result =
    'utterances' in finalPayload
      ? finalPayload
      : finalPayload.result ?? {};

  const rawUtts: any[] = result.utterances ?? [];
  const utterances: ExtractedUtterance[] = [];
  const speakerIdToLabel: Record<string, string> = {};
  const speakers: ExtractedSpeaker[] = [];

  for (const u of rawUtts) {
    const additions = u.additions ?? {};
    const sid =
      additions.speaker_id ??
      u.speaker_id ??
      null;

    if (sid && !(sid in speakerIdToLabel)) {
      speakerIdToLabel[sid] = `发言人 ${speakers.length + 1}`;
      speakers.push({ id: sid, label: speakerIdToLabel[sid] });
    }

    utterances.push({
      text: u.text ?? '',
      start_time: u.start_time ?? 0,
      end_time: u.end_time ?? 0,
      speaker_id: sid,
      words: u.words ?? [],
      definite: u.definite ?? false,
    });
  }

  return { utterances, speakers };
}
