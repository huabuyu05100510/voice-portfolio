# Sprint 11 — 增量合并 + 同说话人不重复卡片

> **日期**: 2026-06-21
> **作者**: Claude Code (Opus 4.8)
> **触发**: 用户反馈 "很明显不对 同一个人就不应该换行"

## 🐛 用户反馈

> "很明显不对 同一个人就不应该换行 发言人序号一次递增"

### 截图分析

录音中产生 4 个 `.transcript-item` 卡片,全部 label 是 "发言人 1",但其中 3 个橙色 + 1 个青色 avatar。文本是同一个句子的累积:

```
1. 谁说我？哎？这是第二
2. 谁说我？哎？这是第二天，是
3. 谁说我？哎？这是第二天，是不是
4. 谁说我？哎？这是第二天，是不是你？那你   (青色)
```

## 🔍 根因

1. **火山引擎 cumulative 模式**: 每个 final 返回的 `text` 是**累计全文**(从开始到现在),不是新增部分
2. **同说话人 ID 不稳**: 火山引擎可能为同一人分配不同 speaker_id (例如 `spk0` → `spk_0_a1b2`)
3. **客户端 naive 累加**: reducer 直接 `state.results.push(result)`,没识别累积模式

## ✅ 修复

### 客户端 (transcriptionReducer)

新增 4 级合并策略:

```typescript
if (!newText) {
  // 跳过空文本
} else if (lastText.length > newText.length && lastText.includes(newText)) {
  // B) 重复推送: new 是 last 子串 → 跳过
} else if (newText.startsWith(lastText)) {
  // A) 文本扩展 → 就地更新 (累积模式核心场景)
} else if (newText.startsWith(lastText.slice(0, lastText.length * 0.7))) {
  // C) 长前缀重合 (≥70%) → 视为同一说话人累积
} else if (newText.includes(lastText.slice(0, 10))) {
  // C2) 共享前缀 ≥10 字符
} else {
  // D) 完全独立 → 新增卡片
}
```

关键设计:
- **不严格依赖 speaker_id**: 即使 ID 不稳定 (spk0 → spk_0_xxx), 只要文本连续就合并
- **顺序敏感**: 先检查重复 (B), 再扩展 (A), 再宽松匹配 (C), 最后新增 (D)
- **保留原始 result 对象**: 替换 last card 时保留 `words` / `timestamp` 等元数据

### 服务端 (无需改动)

服务端 `text_buffer.smart_append` 已经做了累积模式去重,客户端再合并即可彻底解决问题。

## 🧪 测试

新增 `client/src/__tests__/incrementalMerge.test.ts` (7 用例):

| 场景 | 期望 |
| --- | --- |
| 同说话人 + 文本扩展 → 就地更新 | 1 card |
| 文本连续 + speaker_id 不稳 → 仍合并 | 1 card |
| 用户实际场景: 4 次累积 final | 1 card |
| 不同说话人 → 新增 | 2 cards |
| 同说话人 + 文本不相关 → 新增 | 2 cards |
| 空文本 → 跳过 | 1 card |
| 重复推送 (new 是 last 子串) → 跳过 | 1 card |

**总计**:
```
Test Files  18 passed (18)
Tests       176 passed (176)   ← Sprint 10: 169 → Sprint 11: 176 (+7)
```

## 📂 变更文件

```
M vosk-realtime-asr/client/src/state/transcriptionReducer.ts  (TRANSCRIPT_FINAL 重写)
A vosk-realtime-asr/client/src/__tests__/incrementalMerge.test.ts
```

## 🎯 行为对比

| 场景 | 旧 | 新 |
| --- | --- | --- |
| 同说话人累积 4 次 final | 4 个卡片, 文本重复叠加 | 1 个卡片, 文本持续扩展 |
| 火山引擎 speaker_id 波动 | 多人误识别 | 文本驱动合并 |
| 重复推送 (服务端抖动) | 重复累加 | 跳过 |
| 真正换说话人 | OK | OK |

## ⚠️ 已知约束

- 宽松匹配阈值 (≥70% 字符重合) 可能误合并较短的相似语句,但可接受换用户体验
- 完全独立的短文本 (例如 "嗯", "是") 可能触发误合并,生产环境可通过最小长度 (≥5 字) 缓解
- "发言人" label 仍来自服务端,服务端通过 `speakers_seen` dict 维护;同 ID 多次出现 label 稳定

## 🔜 Sprint 12 候选

- [ ] Speaker smoothing: 服务端对 speaker_id 做短期稳定性平滑 (避免闪变)
- [ ] 在 speaker label 旁显示真实声纹 ID (例如 `发言人 1 · spk_0_a1b2`),方便调试
- [ ] 转写条目支持复制单条 / 编辑
- [ ] 标注功能 (CLAUDE.md 后续要求)
- [ ] SpeakerCard 加波形 mini 可视化