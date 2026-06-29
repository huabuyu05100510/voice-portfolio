# 同说话人连续 utterance 合并 — 修复 VAD 过度切分

**模型:** glm-5.2
**日期:** 2026-06-25
**性质:** UI 层合并逻辑 (非 API 改动) — 修复「一人分多张卡」
**测试:** client 231/231, server 20/20, tsc 源码零报错

---

## 根因

`end_window_size=500` (上一改动) 让 VAD 灵敏切句, 但同时**禁用了语义分句**
(火山引擎官方文档: "配置该值, 不使用语义分句, 根据静音时长来分句").
副作用: 同一人句子间自然停顿 500ms+ 也被切成独立 utterance →
UI 上出现 3 张全是 "发言人 5" 的卡:

```
发言人 5: 其实啊，我是一个演员。
发言人 5: 想学吗？
发言人 5: 想学我教你啊。
```

实际应该是一段独白 → 一张卡, 文本按句拼接.

---

## 修复策略

**关键决定:** 不动 `end_window_size` (它解决多人合并 bug, 不能回退),
改为在 reducer 里做同 speaker 连续 utterance 合并.

`client/src/state/transcriptionReducer.ts` 新增 helper:

```typescript
export function mergeConsecutiveSameSpeaker(
  results: TranscriptionResult[],
  gapMs: number,
): TranscriptionResult[]
```

合并条件 (全部满足):
1. 相邻两张卡 speaker_id 相同 (且都非空)
2. `cur.start_time - prev.end_time ≤ gapMs`
3. 按文本拼接: `prev.text + cur.text`
4. 时间区间扩张: `start_time = prev.start_time`, `end_time = cur.end_time`
5. `definite = prev.definite || cur.definite`
6. `words` 数组合并

不合并:
- speaker 不同 → 换人
- 间隔 > gapMs → 换回合 (即使同人)
- 中间被别人打断 → 后续同人不向前越过 B 合并 (因为不再是相邻)

### 阈值选择

`MERGE_GAP_MS = 1500`:
- 同一人句子间自然停顿 300-800ms → 合并 ✓
- 同一人换回合 (>1.5s 停顿) → 不合并, 各自成卡
- 实测 VAD 切出的同 speaker utterance 间隔 200-500ms 范围

阈值不能太大: 2500ms 会把 "你好我是王楚然" + (2s 后) "今天天气真好"
合并成一张, 违反 e2e 测试 `第二句开始 (新 start_time) 才新增卡`.

---

## 这是 UI 层决定, 不违反火山引擎 API 契约

火山引擎 API 返回 3 个独立 `definite:true` utterance, 这是协议正确的行为.
"同一人连续讲话 = 一张卡" 是**前端 UX 决定**, API 不规定这个.
合并发生在 reducer 内部, 不修改 API 调用参数, 不影响导出 / 纪要的真实 utterance 边界.

---

## TDD

**Red 阶段先写测试 (2 个新测试, 全部失败 ReferenceError):**
- `同一 speaker 连续 3 个 utterance (句间 <2s) → 1 张卡, 文本按句拼接`
- `同 speaker 两个 utterance 但间隔 >2.5s (换回合) → 2 张卡, 不合并`
- `多说话人交替 (A-B-A) → 3 张卡, 中间 B 阻断 A 的合并`
- `流式累积: 同 speaker 第 2 帧新增 utterance → 合并到已有卡`

**Green 阶段实现 helper (37/37 reducer tests 绿):**
- 把 `[...preserved, ...incoming]` 喂给 `mergeConsecutiveSameSpeaker`
- 阈值先用 2500 → e2e 测试红 → 降到 1500 全绿

---

## 验证

- `npx vitest run` — **231 passed** (含新增 4 个 + 不破坏 e2e 7 个)
- `pytest server/__tests__/` — **20 passed**
- `tsc --noEmit` 源码零报错 (test 文件 node: 模块解析是历史问题, 不属本次)
- 真实场景预期: 发言人 5 一段独白 → 1 张卡 "其实啊，我是一个演员。想学吗？想学我教你啊。"

---

## 关联

- 前置: `changes/2026-06-25-multi-speaker-vad-and-n-tests.md` (VAD 参数透传)
- 这次解决: VAD 透传后副作用 (单人被过度切分)
- 仍待真实验证: 不同说话人切换精度 (依赖火山引擎 ML 质量, 客户端无法修复)
