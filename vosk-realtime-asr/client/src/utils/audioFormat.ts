/**
 * audioFormat.ts — 浏览器端音频/视频格式处理工具
 *
 * 功能:
 *   - inferFormat: 从 URL 推断音频格式 (mp3/wav/m4a/mp4/mov/aac/ogg/flac)
 *   - isAudioFile / isVideoFile: 文件名后缀判断
 *   - decodeFileToBuffer: File → AudioBuffer (Web Audio API)
 *
 * 视频文件提取音轨:
 *   由于浏览器在 jsdom/test 环境下没有 WebCodecs / VideoFrame, 采用简单方案:
 *   - File 走 decodeAudioData, 浏览器自动识别音视频容器里的音轨
 *   - 真实浏览器 (Chrome/Firefox) decodeAudioData 支持 mp4 / mov 的音轨解码
 *   - 测试环境用 mock AudioContext 验证
 *
 * Author: MiniMax-M3 (2026-06-27)
 */

export const SUPPORTED_FORMATS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.mp4',
  '.mov',
  '.aac',
  '.ogg',
  '.flac',
] as const;

const _EXT_TO_FORMAT: Record<string, string> = {
  mp3: 'mp3',
  wav: 'wav',
  m4a: 'm4a',
  mp4: 'mp4',
  mov: 'mov',
  aac: 'aac',
  ogg: 'ogg',
  flac: 'flac',
};

const _AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const _VIDEO_EXTS = new Set(['mp4', 'mov']);

const _EXT_RE = /\.(mp3|wav|m4a|mp4|mov|aac|ogg|flac)(?:\?.*)?$/i;

/**
 * 从 URL 末尾扩展名推断格式. 无扩展名默认 mp3.
 */
export function inferFormat(url: string): string {
  const m = _EXT_RE.exec(url);
  if (!m) return 'mp3';
  return _EXT_TO_FORMAT[m[1].toLowerCase()] || 'mp3';
}

export function _extOf(filename: string): string {
  const m = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

export function isAudioFile(filename: string): boolean {
  return _AUDIO_EXTS.has(_extOf(filename));
}

export function isVideoFile(filename: string): boolean {
  return _VIDEO_EXTS.has(_extOf(filename));
}

/**
 * File → ArrayBuffer → AudioBuffer.
 * 视频文件: 浏览器会从容器里抽音轨再 decode.
 *
 * Throws: 解码失败时抛 Error, message 含 "decode" / "bad data".
 */
export async function decodeFileToBuffer(file: File): Promise<AudioBuffer> {
  const Ctx: typeof AudioContext =
    (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!Ctx) {
    throw new Error('AudioContext unavailable — decode not supported in this env');
  }
  const arr = await file.arrayBuffer();
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arr);
  } catch (e: any) {
    throw new Error(`decode audio failed: ${e?.message || e}`);
  }
}

/**
 * 上传前校验: 扩展名 + 大小.
 * 与服务端 file_asr.validate_file_meta 保持一致.
 */
export interface FileMetaCheck {
  ok: boolean;
  reason: string;
  format: string;
  size_bytes: number;
  duration_sec?: number;
}

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB

export function checkFileMeta(filename: string, size_bytes: number): FileMetaCheck {
  const fmt = inferFormat(filename);
  const ext = '.' + (filename.split('.').pop() || '').toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext as any)) {
    return {
      ok: false,
      reason: `unsupported format: ${ext || '(none)'}`,
      format: fmt,
      size_bytes,
    };
  }
  if (size_bytes <= 0) {
    return { ok: false, reason: 'file is empty', format: fmt, size_bytes };
  }
  if (size_bytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `file too large: ${size_bytes} > ${MAX_FILE_BYTES} bytes`,
      format: fmt,
      size_bytes,
    };
  }
  return { ok: true, reason: 'ok', format: fmt, size_bytes };
}
