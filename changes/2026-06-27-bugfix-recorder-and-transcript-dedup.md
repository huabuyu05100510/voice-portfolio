# Bugfix: Recorder Start Failure + Transcript Duplication

**模型:** claude-sonnet-4-6
**日期:** 2026-06-27
**状态:** ✅ 已修复 + 测试全绿 (579/579)

---

## 问题描述

用户反馈 "现在还是不能上线 逻辑bug一大堆":
1. `[useRecorder] start.failed` — 录音器初始化失败时 App.tsx 继续进行 WebSocket 握手
2. 转写内容重复 — "今天的天气今天的天气不错" (文本拼接而非更新)
3. 第二次录音会话 AudioWorklet 注册失败 (模块级缓存跨 AudioContext 复用)

---

## 根因分析

### Bug 1: AudioWorklet 缓存 (AudioCapture.ts)
```typescript
// 旧代码 — 模块级变量, 与第一个 AudioContext 绑定
let audioWorkletPromiseCache: Promise<void> | null = null;
function loadAudioWorkletCached(ctx: AudioContext): Promise<void> {
  if (audioWorkletPromiseCache) return audioWorkletPromiseCache; // 跨 ctx 复用!
  ...
}
```
第一次会话创建 `ctx1`, 缓存 `addModule(ctx1)` 的 Promise.
第二次会话创建 `ctx2`, 复用旧 Promise → ctx2 实际未加载模块 → `new AudioWorkletNode(ctx2, 'audio-processor')` 抛 DOMException.

### Bug 2: 错误未传播 (useRecorder.ts → App.tsx)
```typescript
// useRecorder.ts — catch 内处理但不 re-throw
} catch (e) {
  setError(msg); setStatus('error');
  // 没有 throw e!
}
```
`recorder.start()` 在 App.tsx 中 await 后静默成功 → 继续调用 `client.startRecording()` 握手 → 服务端等待音频, 但麦克风未开启 → 死状态.

### Bug 3: mergeConsecutiveSameSpeaker 前缀关系漏检
Volcengine 累积模式下, 同一 utterance 的 `start_time` 在帧间可能漂移 (100→200→300):
- Frame 1: `preserved=[{start:100, text:"今天的天气"}]`, `incoming=[{start:200, text:"今天的天气不错"}]`
- mergeConsecutiveSameSpeaker 检测到 closeInTime → 直接 `prev.text + cur.text`
- 结果: **"今天的天气今天的天气不错"** (重复!)

---

## 修复方案

### Fix 1: WeakMap 缓存 (AudioCapture.ts:18-30)
```typescript
const audioWorkletCacheMap = new WeakMap<BaseAudioContext, Promise<void>>();
function loadAudioWorkletCached(ctx: AudioContext): Promise<void> {
  const existing = audioWorkletCacheMap.get(ctx);
  if (existing) return existing;
  const p = ctx.audioWorklet.addModule('/audio-processor.js');
  audioWorkletCacheMap.set(ctx, p);
  p.catch(() => audioWorkletCacheMap.delete(ctx));
  return p;
}
```
每个 AudioContext 独立缓存, GC 后自动释放.

### Fix 2: Re-throw (useRecorder.ts) + 分支处理 (App.tsx)
```typescript
// useRecorder.ts
} catch (e) {
  setError(msg); setStatus('error');
  throw e;  // ← 新增
}

// App.tsx — startRecording()
try {
  await recorder.start();
} catch (e: any) {
  dbg.push('ERROR', `录音器启动失败: ${e?.message ?? e}`);
  setStatus('error');
  return;  // ← 不继续 WS 握手
}
```

### Fix 3: 前缀关系检测 (transcriptionReducer.ts:mergeConsecutiveSameSpeaker)
```typescript
if (sameSpeaker && closeInTime) {
  const normP = normalizeForCompare(prev.text || '');
  const normC = normalizeForCompare(cur.text || '');
  if (normP.length >= 2 && normC.length >= 2 && normC.startsWith(normP)) {
    // cur 是 prev 的累积扩展 → 保留 cur 文本 + prev.start_time
    out[out.length - 1] = { ...cur, start_time: prev.start_time ?? cur.start_time, ... };
  } else if (normP.length >= 2 && normC.length >= 2 && normP.startsWith(normC)) {
    // prev 更长 → 保留 prev
  } else {
    // 真正独立的两句 → 拼接 (原有行为)
    out[out.length - 1] = { ...prev, text: prev.text + cur.text, ... };
  }
}
```

---

## 验证

```bash
cd vosk-realtime-asr/client
npx vitest run  # 579 tests / 0 失败
```

新增测试: 3 个 (transcriptionReducer.test.ts)
- `start_time 漂移: cur 是 prev 的扩展 → 保留 cur 文本, 不拼接`
- `start_time 漂移连续 3 帧: 每帧扩展文本 → 始终 1 张卡`
- `两个真正独立的句子 (不同文本无前缀关系) → 正常拼接成 1 张卡`
