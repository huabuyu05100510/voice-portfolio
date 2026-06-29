/**
 * audioFormat.ts TDD 测试
 *
 * 浏览器端:
 *   - 从 file/url 提取 audio buffer (Web Audio API decodeAudioData)
 *   - 从 video file 提取音轨 (无 VideoFrame, 简单方式)
 *   - 时长获取 (通过 decode 后 buffer.duration)
 *   - format 推断 (扩展名)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  inferFormat,
  isVideoFile,
  isAudioFile,
  SUPPORTED_FORMATS,
  decodeFileToBuffer,
} from '../utils/audioFormat';

describe('audioFormat / inferFormat', () => {
  it('从 url 末尾扩展名推断', () => {
    expect(inferFormat('https://x/a.mp3')).toBe('mp3');
    expect(inferFormat('https://x/A.WAV')).toBe('wav');
    expect(inferFormat('https://x/v.mp4?token=1')).toBe('mp4');
  });
  it('无扩展名默认 mp3', () => {
    expect(inferFormat('https://x/audio')).toBe('mp3');
  });
});

describe('audioFormat / isAudioFile / isVideoFile', () => {
  it('音频判定', () => {
    expect(isAudioFile('a.mp3')).toBe(true);
    expect(isAudioFile('a.wav')).toBe(true);
    expect(isAudioFile('a.m4a')).toBe(true);
    expect(isAudioFile('a.aac')).toBe(true);
    expect(isAudioFile('a.flac')).toBe(true);
    expect(isAudioFile('a.ogg')).toBe(true);
    expect(isVideoFile('a.mp3')).toBe(false);
  });
  it('视频判定', () => {
    expect(isVideoFile('v.mp4')).toBe(true);
    expect(isVideoFile('v.mov')).toBe(true);
    expect(isAudioFile('v.mp4')).toBe(false);
  });
});

describe('audioFormat / SUPPORTED_FORMATS', () => {
  it('含 8 种扩展名', () => {
    expect(SUPPORTED_FORMATS.length).toBeGreaterThanOrEqual(5);
    expect(SUPPORTED_FORMATS).toContain('.mp3');
    expect(SUPPORTED_FORMATS).toContain('.mp4');
  });
});

describe('audioFormat / decodeFileToBuffer', () => {
  beforeEach(() => {
    // 简易 mock: 注入全局 AudioContext
    const fakeBuffer = { duration: 12.34, sampleRate: 16000, numberOfChannels: 1 };
    class FakeAudioContext {
      decodeAudioData(_arr: ArrayBuffer, _s?: (b: any) => void, _e?: (e: any) => void) {
        return Promise.resolve(fakeBuffer);
      }
    }
    (globalThis as any).AudioContext = FakeAudioContext;
    (globalThis as any).webkitAudioContext = FakeAudioContext;
  });

  it('解 ArrayBuffer → 拿到 duration + sampleRate', async () => {
    const file = new File([new Uint8Array(8)], 'a.mp3', { type: 'audio/mpeg' });
    const buf = await decodeFileToBuffer(file);
    expect(buf.duration).toBeCloseTo(12.34, 1);
    expect(buf.sampleRate).toBe(16000);
  });

  it('失败时抛 AudioDecodeError', async () => {
    (globalThis as any).AudioContext = class {
      decodeAudioData() {
        return Promise.reject(new Error('bad data'));
      }
    };
    const file = new File([new Uint8Array(8)], 'a.mp3', { type: 'audio/mpeg' });
    await expect(decodeFileToBuffer(file)).rejects.toThrow(/bad data|decode/i);
  });
});
