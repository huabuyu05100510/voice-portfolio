# 修复「同一句话重复 8 次」卡片堆积 bug

**日期:** 2026-06-25
**模型:** glm-5.2
**类型:** Bug Fix (P0)
**TDD:** Red → Green (3 个新失败测试 → 全绿 41/41)

---

## 背景

用户截图暴露: 转写区同一句话「一句美女硬生生听成美女...」被重复渲染 8 次。
DIAG 日志定位到根因 — 火山引擎服务端对同一音频片段在不同帧里给出**漂移的
`start_time`** (帧 N: 1000ms, 帧 N+1: 1200ms), 偶尔甚至返回 `start_time: null`。

reducer 此前把 `start_time` 作为 utterance 的唯一身份 key, 一旦它漂移,
身份匹配失效 → 同一音频被当成新句追加。

## 根因

`client/src/state/transcriptionReducer.ts` 的 utterance 驱动合并路径:

```ts
const existingByStart = new Map<number, TranscriptionResult>();
for (const r of state.results) {
  if (typeof r.start_time === 'number') existingByStart.set(r.start_time, r);
}
```

`start_time` 漂移时:
1. `existingByStart` 查不到 incoming 的 start_time → 创建新卡
2. 老卡的 start_time 不在 `newKeys` 中 → 进入 `preserved` (保留)
3. 同一文本两张卡同时存在 → 重复

另一处: `mergeConsecutiveSameSpeaker` 在同 speaker + 时间临近时无条件拼接文本,
即使文本完全相同也会拼成「重复的话重复的话重复的话」。

## 修复

### 1. `mergeConsecutiveSameSpeaker` — 同文本不拼接
同 speaker + 归一化后文本完全相同 → 视为同一句, 保留较长文本, 取较晚 end_time,
不拼接。归一化用现有 `normalizeForCompare` (剥标点/空白)。

### 2. 新增 `dedupeSameTextSameSpeaker` — 全局文本兜底去重
按 `(speaker_id, normalizeForCompare(text))` 作 key, 同 key 只保留首张。
仅在 utterance 驱动路径的最后应用, 作为 start_time 漂移时的安全网。

跨 speaker 不去重 (两人都说「你好」应分别保留)。

## 测试

新增 3 个测试 (transcriptionReducer.test.ts):
- `utterance start_time 不稳: 同 speaker + 同文本 + 不同 start_time → 1 张卡`
- `同帧内多 utterance 同 speaker 同文本 → 1 张卡 (不重复)`
- `历史已锁定卡 + 本帧同文本 utterance (不同 start_time): 不新增重复卡`

结果: 41/41 全绿。

## 文件改动

- `client/src/state/transcriptionReducer.ts`
  - `mergeConsecutiveSameSpeaker` 加同文本短路
  - 新增 `dedupeSameTextSameSpeaker` export
  - utterance 驱动路径 final pass 应用 dedupe
- `client/src/__tests__/transcriptionReducer.test.ts`
  - 新增「同文本去重」describe block (3 case)

## 风险

- 极端情况: 同一 speaker 真的两次说完全相同的话 (口语中少见) → 会被合并。
  口语场景下用户更不愿意看到重复; 牺牲合理。
- 性能: dedupe 是 O(n), state.results 已有 MAX_RESULTS=200 上限, 无影响。
