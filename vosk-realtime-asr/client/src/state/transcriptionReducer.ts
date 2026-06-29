/**
 * transcriptionReducer
 * --------------------
 * Pure reducer that owns all transcription state transitions.
 * Centralising this makes every state mutation unit-testable without React.
 *
 * Designed for TDD: no I/O, no timers, no globals. Same in -> same out.
 *
 * Author: Claude Opus 4.8 (Sprint 5 refactor)
 * Updated: 火山引擎分角色 — 增加 speakers / currentSpeakerId / utterances
 */
import type {
  TranscriptionResult,
  WordInfo,
  SessionMetrics,
  Speaker,
  Utterance,
} from '../types';

export interface TranscriptionState {
  results: TranscriptionResult[];          // 累积的 final 段
  currentText: string;                     // partial 当前正在说的话
  fullText: string;                        // 服务端累计的全文
  words: WordInfo[];                       // 词级时间戳 (final 段接收)
  finalStartTime: number;                  // 当前 final 段播放原点
  metrics: SessionMetrics;
  /** 已出现的说话人 (id → {label, color}) — 火山引擎分角色 */
  speakers: Speaker[];
  /** 当前 final 段的说话人 ID (用于 Subtitle 高亮) */
  currentSpeakerId: string | null;
  /** 当前 final 段的分段列表 (火山引擎 utterances[]) */
  currentUtterances: Utterance[];
}

// 火山引擎分角色调色板 — 顶级 12 色, 醒目且区分度高
// 涵盖: 暖色(3) + 冷色(5) + 中性(2) + 警示(2)
// 颜色按 contrast 排序, > 8 说话人时按出现顺序循环
export const SPEAKER_COLOR_PALETTE: string[] = [
  '#00d4ff', // cyan       ★
  '#ff7ab6', // pink       ★
  '#7c3aed', // violet     ★
  '#fbbf24', // amber      ★
  '#22c55e', // green      ★
  '#f97316', // orange     ★
  '#06b6d4', // teal       ★
  '#ef4444', // red        ★
  '#a78bfa', // lavender   ★ (新增)
  '#84cc16', // lime       ★ (新增)
  '#f472b6', // rose       ★ (新增)
  '#14b8a6', // teal-deep  ★ (新增)
];

export function getSpeakerColor(id: string): string {
  // 稳定 hash → palette 索引 (同一个 speaker 永远同色)
  // 用 djb2 + 无符号右移, 避免 Math.abs(-2^31) = -2^31 的 JS 边界陷阱
  // 注意: 不暴露 palette 参数, 否则 .map(getSpeakerColor) 会把
  //       Array.prototype.map 的 (item, index, array) 第二参数当 palette 传进来
  const pal = SPEAKER_COLOR_PALETTE;
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  // >>> 0 强制无符号 32 位
  const idx = (h >>> 0) % pal.length;
  return pal[idx];
}

/**
 * 标点/空白归一化: 仅保留字母数字与 CJK 字符, 去掉逗号/句号/空格等.
 * 用于累积合并的前缀比较 — 火山引擎每帧重新加标点, 严格 startsWith 会误判.
 * 仅用于比较, 显示仍用原文.
 */
export function normalizeForCompare(s: string): string {
  // 保留: a-z A-Z 0-9, 中文/日文/韩文范围, 部分其他 unicode 字母
  // 移除: 标点 (中英文)、空格、制表符、emoji 等
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export const initialTranscriptionState: TranscriptionState = {
  results: [],
  currentText: '',
  fullText: '',
  words: [],
  finalStartTime: 0,
  metrics: {
    audioBytes: 0,
    transcriptionChars: 0,
    chunksProcessed: 0,
    avgLatency: 0,
    totalLatencies: 0,
    startTime: 0,
  },
  speakers: [],
  currentSpeakerId: null,
  currentUtterances: [],
};

export type TranscriptionAction =
  | { type: 'TRANSCRIPT_PARTIAL'; text: string; fullText: string; speakerId?: string | null }
  // A1 修复: timestamp 由调用方注入 (performance.now()), 保持 reducer 纯函数性
  // F2 修复: isCumulative 由服务端告知, false 时跳过前缀匹配启发式, 直接新增
  | { type: 'TRANSCRIPT_FINAL'; result: TranscriptionResult; timestamp?: number; isCumulative?: boolean }
  | { type: 'CLEAR' }
  | { type: 'METRICS_UPDATE'; metrics: SessionMetrics }
  | { type: 'AUDIO_CHUNK_RECORDED'; byteLength: number }
  | { type: 'SESSION_RESET'; startTime: number }
  | { type: 'RENAME_SPEAKER'; speakerId: string; label: string };

/** 给定数字, 取滑动上限 (避免 actions 之间重复字面量) */
const MAX_RESULTS = 200;

/**
 * 同说话人连续 utterance 合并 — 修复 VAD 过度切分导致的「一人分多张卡」.
 *
 * 背景: end_window_size=500 让 VAD 灵敏切句, 同一人句子间自然停顿 500ms+ 也被
 * 切成多个 utterance → UI 出现 3 张全是 "发言人 5" 的卡. 用户要的是:
 * 同一人连续讲话 = 1 张卡, 文本按句拼接. 换人才换卡.
 *
 * 合并条件 (全部满足):
 *   1. 相邻两张卡 speaker_id 相同 (且都非空)
 *   2. 当前卡 start_time - 上一卡 end_time ≤ gapMs (自然停顿)
 *   3. 上一卡非 definite锁定 (已 definite=true 的终态卡可继续追加, 不冲突)
 *
 * 不合并的情况:
 *   - speaker 不同 → 换人
 *   - 间隔 > gapMs → 换回合 (即使同人)
 *   - 中间被别人打断 → 后续同人不向前越过 B 合并
 *
 * 这是 UI 层决定, 不违反火山引擎 API 契约.
 */
export function mergeConsecutiveSameSpeaker(
  results: TranscriptionResult[],
  gapMs: number,
): TranscriptionResult[] {
  if (results.length <= 1) return results;
  // 先按 start_time 升序排, 保证相邻判定有意义
  const sorted = [...results].sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));
  const out: TranscriptionResult[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    const sameSpeaker =
      !!prev.speaker_id
      && !!cur.speaker_id
      && prev.speaker_id === cur.speaker_id;
    const prevEnd = typeof prev.end_time === 'number' ? prev.end_time : 0;
    const curStart = typeof cur.start_time === 'number' ? cur.start_time : 0;
    const gap = curStart - prevEnd;
    const closeInTime = gap <= gapMs;

    // 同文本去重 (修复"一句美女重复 8 次" bug):
    // 服务端有时对同一音频给出不稳的 start_time, 或同帧内重复 utterance.
    // 同 speaker + 归一化后文本相同 → 视为同一句, 不拼接 (否则会变成
    // "重复的话重复的话重复的话"). 保留较长的一条, 取较晚的 end_time.
    const normPrev = normalizeForCompare(prev.text || '');
    const normCur = normalizeForCompare(cur.text || '');
    const isIdenticalText =
      normPrev.length > 0 && normPrev === normCur;
    if (sameSpeaker && isIdenticalText) {
      const keepPrevText = (prev.text || '').length >= (cur.text || '').length;
      out[out.length - 1] = {
        ...(keepPrevText ? prev : cur),
        start_time: keepPrevText ? prev.start_time : cur.start_time,
        end_time: Math.max(
          typeof prev.end_time === 'number' ? prev.end_time : 0,
          typeof cur.end_time === 'number' ? cur.end_time : 0,
        ),
        definite: prev.definite || cur.definite,
      };
      continue;
    }

    if (sameSpeaker && closeInTime) {
      // 前缀关系检测: 火山引擎累积模式下 start_time 可能在帧间漂移,
      // 导致同一句话的"旧版本"被 preserved 后又和"新版本"合并.
      // 例: prev="今天的天气", cur="今天的天气不错" → 不应拼成"今天的天气今天的天气不错"
      // 策略: 若 cur 归一化后是 prev 的超集 (扩展), 保留 cur + prev 的 start_time.
      //        若 prev 归一化后是 cur 的超集 (prev 更长), 保留 prev.
      //        其他情况: 正常拼接 (两句真正独立).
      const normP = normalizeForCompare(prev.text || '');
      const normC = normalizeForCompare(cur.text || '');
      if (normP.length >= 2 && normC.length >= 2 && normC.startsWith(normP)) {
        // cur 是 prev 的累积扩展 — 用 cur 文本, 但保留 prev 的 start_time
        out[out.length - 1] = {
          ...cur,
          start_time: prev.start_time ?? cur.start_time,
          definite: prev.definite || cur.definite,
          words: [...(prev.words || []), ...(cur.words || [])],
        };
      } else if (normP.length >= 2 && normC.length >= 2 && normP.startsWith(normC)) {
        // prev 是 cur 的累积扩展 (旧帧比新帧长) — 保留 prev
        // no-op: prev already in out
      } else {
        // 合并: 文本拼接, 时间扩张, words 合并, definite 取并集
        out[out.length - 1] = {
          ...prev,
          text: prev.text + cur.text,
          start_time: prev.start_time,
          end_time: typeof cur.end_time === 'number' ? cur.end_time : prev.end_time,
          definite: prev.definite || cur.definite,
          words: [...(prev.words || []), ...(cur.words || [])],
        };
      }
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * 同 speaker + 同归一化文本的全局去重 — 防止 start_time 漂移导致
 * reducer 把同一句话当成新句追加. 仅对同 speaker_id 生效 (不同人
 * 同文本应保留).
 *
 * 触发场景: 服务端 frame N 给 start=1000, frame N+1 给 start=1200,
 * 但音频和文本完全相同. start_time 作身份 key 失效 → 这里按文本兜底.
 */
export function dedupeSameTextSameSpeaker(
  results: TranscriptionResult[],
): TranscriptionResult[] {
  if (results.length <= 1) return results;
  const seen = new Map<string, number>(); // `${speakerId}|${normText}` → first index
  const out: TranscriptionResult[] = [];
  for (const r of results) {
    if (!r.speaker_id) {
      out.push(r);
      continue;
    }
    const norm = normalizeForCompare(r.text || '');
    if (!norm) {
      out.push(r);
      continue;
    }
    const key = `${r.speaker_id}|${norm}`;
    if (seen.has(key)) {
      // 跳过重复 (第一条已保留)
      continue;
    }
    seen.set(key, out.length);
    out.push(r);
  }
  return out;
}

export function transcriptionReducer(
  state: TranscriptionState,
  action: TranscriptionAction,
): TranscriptionState {
  switch (action.type) {
    case 'TRANSCRIPT_PARTIAL': {
      return {
        ...state,
        currentText: action.text,
        fullText: action.fullText || state.fullText,
        currentSpeakerId: action.speakerId ?? state.currentSpeakerId,
      };
    }

    case 'TRANSCRIPT_FINAL': {
      const { result, timestamp, isCumulative } = action;
      const newText = (result.text || '').trim();
      const nextWords =
        result.words && result.words.length > 0 ? result.words : state.words;

      // 合并说话人 (按 id 去重, 给新出现的分配 color + session 内顺序 label)
      // 注意: 服务端 extract_utterances 每帧从 1 重新编号 (speaker_id_to_label 是
      // 函数局部变量), 所以 server 推送的 label 是不可信的 — 不同 ID 在不同帧可能
      // 都拿到 "发言人 1". 客户端必须自己按 session 首次出现顺序编号, 永远不信 server label.
      // 唯一例外: 用户手动改名 (userEdited=true) 后, label 永久锁定为用户输入.
      const speakerMap = new Map<string, Speaker>();
      for (const s of state.speakers) speakerMap.set(s.id, s);
      for (const s of result.speakers || []) {
        const prev = speakerMap.get(s.id);
        if (!prev) {
          // 新 speaker: 按 session 内已有数量 +1 分配唯一序号
          speakerMap.set(s.id, {
            id: s.id,
            label: `发言人 ${speakerMap.size + 1}`,
            color: getSpeakerColor(s.id),
            duration_sec: s.duration_sec,
            chars: s.chars,
            words: s.words,
          });
        }
        // 已存在的 speaker: 完全忽略 server label, 保留 session 内首次分配的 label
        // (除非用户已 RENAME_SPEAKER, 那个 action 单独处理, 这里不动)
      }
      const mergedSpeakers = Array.from(speakerMap.values());

      // ===== 火山引擎 v3 full 协议 · utterance 驱动合并 (优先路径) =====
      // 官方文档方案: full 协议每帧返回全部 utterances[], 每个 utterance 有
      // 稳定 start_time + definite 标志. 用 start_time 作卡片稳定身份,
      // definite:true 锁定. 完全摆脱文本前缀匹配 — 火山引擎每帧重写标点 +
      // 数字↔中文数字 ("24,000"↔"2万四千"), 任何文本比较都会失败.
      const utts = result.utterances || [];
      const hasDefinite = utts.some((u) => u.definite !== undefined);
      if (utts.length > 0 && hasDefinite) {
        // 索引现有卡片 (按 start_time)
        const existingByStart = new Map<number, TranscriptionResult>();
        for (const r of state.results) {
          if (typeof r.start_time === 'number') existingByStart.set(r.start_time, r);
        }
        const newKeys = new Set<number>(utts.map((u) => u.start_time));

        // 1) 本帧未覆盖的历史卡片 (definite 锁定的优先保留), 留在最前
        const preserved: TranscriptionResult[] = [];
        for (const r of state.results) {
          if (typeof r.start_time === 'number' && !newKeys.has(r.start_time)) {
            preserved.push(r);
          }
        }

        // 2) 本帧 utterances 按顺序映射; definite:true 的旧卡锁定不被文本覆盖
        const incoming: TranscriptionResult[] = utts.map((u) => {
          const prev = existingByStart.get(u.start_time);
          if (prev?.definite && u.definite) {
            // 已锁定: 保留原文本
            return prev;
          }
          const card: TranscriptionResult = {
            ...result,
            text: u.text || '',
            speaker_id: u.speaker_id ?? result.speaker_id,
            speakers: undefined,
            utterances: undefined,
            start_time: u.start_time,
            end_time: u.end_time,
            definite: u.definite,
            words: u.words,
          };
          return card;
        });

        // ===== 同说话人连续合并 =====
        // VAD 即使灵敏 (end_window_size=500), 同一人句子间自然停顿 500ms+ 也会被切成
        // 多个 utterance → UI 出现多张同 speaker 的卡. 这里按 speaker_id + 时间间隔
        // 把连续 utterance 合并成一张: gap < MERGE_GAP_MS 且同 speaker 才合.
        // 换人 / 大间隔 (换回合) 不合. 已 userEdited 的卡 (改名过) 保留身份不合.
        // 阈值: 1500ms. 同一人句子间自然停顿通常 300-800ms; >1.5s 视为换回合 (即使同人).
        // 实测: end_window_size=500 切出的同 speaker utterance 间隔多在 200-500ms 范围.
        const MERGE_GAP_MS = 1500;
        const merged = mergeConsecutiveSameSpeaker(
          [...preserved, ...incoming],
          MERGE_GAP_MS,
        );
        // 同 speaker + 同文本兜底去重 — start_time 漂移时 start_time 作身份
        // key 会失效, 这里按 (speaker, normalized text) 去重避免"一句美女
        // 重复 8 次".
        const deduped = dedupeSameTextSameSpeaker(merged);
        const nextResults = deduped.slice(-MAX_RESULTS);
        const totalChars = nextResults.reduce((n, r) => n + r.text.length, 0);
        const lastUtt = utts[utts.length - 1];
        return {
          ...state,
          results: nextResults,
          currentText: '',
          fullText: result.fullText || state.fullText,
          words: nextWords,
          finalStartTime: typeof timestamp === 'number' ? timestamp : state.finalStartTime,
          speakers: mergedSpeakers,
          currentSpeakerId: lastUtt?.speaker_id ?? result.speaker_id ?? null,
          currentUtterances: utts,
          metrics: {
            ...state.metrics,
            // utterance 驱动模式下 transcriptionChars = 当前全部卡片总字数
            transcriptionChars: totalChars,
          },
        };
      }

      // F2: isCumulative 默认 true 以保持向后兼容 (老服务端不发该字段)
      // 新服务端明确告知 is_cumulative=false 时, 跳过所有前缀匹配启发式, 直接走"独立新增"
      const cumulativeMode = isCumulative !== false;

      // Sprint 11: 增量合并 — 仅在累积模式下识别是否是同一说话人的连续累积
      // 客户端应识别:
      //   A) 文本扩展 (new startsWith last) → 就地更新 (最常见)
      //   B) 文本回退 (new 是 last 子串) → 跳过
      //   C) speaker_id 不稳但文本连续 → 仍合并 (放宽: 仅在文本匹配时信任)
      //   D) 完全独立 → 新增
      const lastResult = state.results[state.results.length - 1];
      let nextResults: TranscriptionResult[];
      let deltaChars = 0;

      const lastText = (lastResult?.text || '').trim();
      // 标点漂移容错: 火山引擎每帧重新加标点, 用归一化文本做前缀比较
      const normLast = normalizeForCompare(lastText);
      const normNew = normalizeForCompare(newText);
      const sameOrMissingSpeaker =
        !lastResult
        || !lastResult.speaker_id
        || !result.speaker_id
        || lastResult.speaker_id === result.speaker_id;

      if (!newText) {
        // 空文本 — 跳过
        nextResults = state.results;
        deltaChars = 0;
      } else if (
        lastResult
        && normNew.length < normLast.length
        && normLast.includes(normNew)
      ) {
        // B) 重复推送 (new 是 last 子串) — 跳过, 必须先检查避免被 C2 误判
        nextResults = state.results;
        deltaChars = 0;
      } else if (
        cumulativeMode
        && lastResult
        && normNew.length >= normLast.length
        && normNew.startsWith(normLast)
      ) {
        // A) 文本扩展 (允许 speaker_id 不稳 + 标点漂移): 归一化后前缀匹配 → 就地更新
        nextResults = [...state.results.slice(0, -1), result].slice(-MAX_RESULTS);
        deltaChars = newText.length - lastText.length;
      } else if (
        cumulativeMode
        && lastResult
        && normNew.startsWith(normLast.slice(0, Math.max(8, Math.floor(normLast.length * 0.7))))
      ) {
        // C) 长前缀重合 (≥70% 归一化字符) → 视为同一说话人累积
        nextResults = [...state.results.slice(0, -1), result].slice(-MAX_RESULTS);
        deltaChars = newText.length - lastText.length;
      } else if (
        cumulativeMode
        && lastResult
        && sameOrMissingSpeaker
        && normNew.length > 4
        && normLast.length > 4
        && normNew.includes(normLast.slice(0, 10))
      ) {
        // C2) 共享前缀 ≥10 归一化字符 (短文本子串太脆弱, 用前缀)
        nextResults = [...state.results.slice(0, -1), result].slice(-MAX_RESULTS);
        deltaChars = newText.length - lastText.length;
      } else {
        // D) 新增卡片
        nextResults = [...state.results, result].slice(-MAX_RESULTS);
        deltaChars = newText.length;
      }

      return {
        ...state,
        results: nextResults,
        currentText: '',
        fullText: result.fullText || state.fullText,
        words: nextWords,
        // A1 修复: timestamp 从 action 注入, 而非在 reducer 内部调 performance.now()
        finalStartTime: typeof timestamp === 'number' ? timestamp : state.finalStartTime,
        speakers: mergedSpeakers,
        currentSpeakerId: result.speaker_id ?? null,
        currentUtterances: result.utterances || [],
        metrics: {
          ...state.metrics,
          transcriptionChars: state.metrics.transcriptionChars + deltaChars,
        },
      };
    }

    case 'CLEAR': {
      return {
        ...initialTranscriptionState,
        metrics: {
          ...initialTranscriptionState.metrics,
          startTime: state.metrics.startTime,
        },
      };
    }

    case 'METRICS_UPDATE': {
      return { ...state, metrics: action.metrics };
    }

    case 'AUDIO_CHUNK_RECORDED': {
      return {
        ...state,
        metrics: {
          ...state.metrics,
          audioBytes: state.metrics.audioBytes + action.byteLength,
          chunksProcessed: state.metrics.chunksProcessed + 1,
        },
      };
    }

    case 'SESSION_RESET': {
      return {
        ...initialTranscriptionState,
        metrics: {
          ...initialTranscriptionState.metrics,
          startTime: action.startTime,
        },
      };
    }

    case 'RENAME_SPEAKER': {
      const trimmed = action.label.trim();
      if (!trimmed) return state;  // 空名忽略
      const exists = state.speakers.some((s) => s.id === action.speakerId);
      if (!exists) return state;  // 不存在的 id no-op
      return {
        ...state,
        speakers: state.speakers.map((s) =>
          s.id === action.speakerId
            ? { ...s, label: trimmed, userEdited: true }
            : s
        ),
      };
    }

    default:
      return state;
  }
}
