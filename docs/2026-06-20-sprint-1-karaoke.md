# 词级卡拉OK 字幕 - 技术方案

**模型声明**: Claude Opus 4.8
**日期**: 2026-06-20
**冲刺**: Sprint 1 (一冲刺 7 个特性中的第 X 个)

---

## 目标

让字幕像 KTV 卡拉OK 一样: 当前词高亮 (亮色背景 + 阴影), 已读词灰色, 未读词淡色, 配 1.2s 横向进度条.

---

## 数据流 (端到端)

```
[Vosk 引擎]
  ↓ AcceptWaveform / FinalResult 返回 result['result']['words'] = [{word, start, end, conf}]
[server/vosk_worker.py]
  ↓ SetWords(True) 开启词级输出
  ↓ 抽 _extract_words() 兼容两种 Vosk JSON 格式
  ↓ response_q.put({event, text, is_final, words, ...})
[server/app.py]
  ↓ 累积每段 final 的 words 到 session['words_buffer']
  ↓ 把段内时间转成全局时间 (last_end 累加, 处理段间不连续)
  ↓ socketio.emit('transcription_result', {..., words: words_buffer})
[client/src/WebSocketClient.ts]
  ↓ onTranscriptionResult 回调带 words 字段
[client/src/App.tsx]
  ↓ 状态: state.words (final 累积), state.finalStartTime (段播放原点 = performance.now())
[client/src/Subtitle.tsx]
  ↓ requestAnimationFrame 持续计算 elapsedSec = (now - finalStartTime) / 1000
  ↓ findActiveWordIndex(words, elapsedSec)  二分查找当前高亮
  ↓ computeWordProgress(word, elapsedSec)   词内 0..1 进度
  ↓ framer-motion 渲染当前词 (高亮), 已读 (灰), 未读 (淡)
[client/src/subtitleKaraoke.ts]
  ↓ 纯函数 (findActiveWordIndex / computeWordProgress / chunkWordsIntoLines)
  ↓ 单独 vitest 覆盖
```

---

## 关键设计

### 1. 服务端: 时间戳归一化

Vosk 在每次 `AcceptWaveform` 触发 final 时, `words[].start` 是相对该段起点的局部时间.
如果段间 (上一句 final 结束 → 下一句 final 开始) 物理上不连续, 直接拼接会"瞬移".
所以在 `app.py` 里:
- 每段 final 第一个词的 start 当作 0
- 段间时间 = `last_end (上一段最末) + (w.start - chunk_offset)`
- 段间天然产生 gap, 卡拉OK 高亮在 gap 期间会"停"在段末词, 等到下一段第一个词才继续

### 2. 客户端: 播放原点 = `performance.now()`

- 每次收到 final 段, 记录 `finalStartTime = performance.now()`
- rAF 持续算 `elapsedSec = (now - finalStartTime) / 1000`
- `findActiveWordIndex` 拿 elapsedSec 查表
- 不依赖服务端挂钟, 不依赖网络时延, 纯本地时钟 → 60fps 平滑

### 3. 性能: 二分查找

100 词的句子, 每帧 16ms, 用二分查找 O(log n) ≈ 7 次比较就够, 完全不卡.
二分实现:

```typescript
let lo = 0, hi = words.length;
while (lo < hi) {
  const mid = (lo + hi) >>> 1;
  if (words[mid].start <= elapsedSec) lo = mid + 1;
  else hi = mid;
}
return lo - 1;  // 当前高亮
```

### 4. 视觉态: 三态 + 进度条

- `word-current`: 渐变背景 (#00d4ff → #5eead4), 黑色字, 阴影 0 0 12px
- `word-past`: #5a5a6e 灰, 半透明
- `word-future`: rgba(224,224,224,0.35) 几乎透明
- 横向进度条: 1.2s linear, 跟随当前词内进度

### 5. 兜底: 无 words 数据时

如果服务端没下发 words (老版本 / 模型未支持), `Subtitle` 自动回退到旧版"按句子切行"模式, 不影响基本显示.

### 6. partial 行不参与卡拉OK

Vosk partial 不返回 words, partial 行内只显示纯文本, 不画高亮 — 等 final 到了再统一处理.

---

## 性能 & 兼容性

| 维度 | 指标 |
|---|---|
| 帧率 | 60fps (rAF + framer-motion `will-change: transform`) |
| 高亮查找 | O(log n) 二分, 100 词约 7 次比较 |
| 网络 | 增量: 每段 final 多发 ~50 字节 (N 词 × {word,start,end,conf}) |
| 兼容 | Vosk < 0.3.32 无 SetWords API, `try/except` 兜底 |

---

## 文件清单

| 文件 | 改动 |
|---|---|
| `server/vosk_worker.py` | `SetWords(True)` 开启, 抽 `_extract_words` 兼容两种格式, final/finalize 都带 words |
| `server/app.py` | 累积 `session.words_buffer`, 段间时间归一化, emit 带 words |
| `client/src/types.ts` | (已有) `WordInfo` + `TranscriptionResult.words` |
| `client/src/WebSocketClient.ts` | 转发 `data.words` |
| `client/src/App.tsx` | 加 `state.words` / `state.finalStartTime`, 每次 final 重置原点 |
| `client/src/Subtitle.tsx` | 重写为词级卡拉OK + 进度条 |
| `client/src/subtitleKaraoke.ts` | **新增** 纯函数工具 (findActiveWordIndex / computeWordProgress / chunkWordsIntoLines) |
| `client/src/__tests__/subtitleKaraoke.test.ts` | **新增** 19 个 vitest 用例 |
| `client/src/__tests__/WebSocketClient.test.ts` | 1 个用例增加 `words: []` 字段断言 |

---

## TDD 验收

- 19 个 vitest 用例全过 (`subtitleKaraoke.test.ts`)
- 关键用例:
  - 边界: `t < first.start → -1`
  - 段中: `t = 1.25 → 2` (词 "世")
  - 段末: `t = 100 → length - 1`
  - 进度: `t = start → 0`, `t = end → 1`
  - 大量词 (100): 中点 t = 5.05 → idx 50
  - 集成: 从 0 到 3.5s 索引单调不减
  - 零时长词不除零

---

## 可观测性

- `state.words.length` 可在控制台 / 调试面板显示 ("(8 词)")
- `transcription_result` 服务端日志带 words 数
- 调试日志 pushLog 增加 `(N 词)` 字段, 方便用户看到服务端下发节奏

---

## 后续增强

- 用 WaveSurfer.js 把音频波形 + 卡拉OK 进度叠加, 视觉上更 KTV
- 高亮颜色按 conf 自适应 (低置信度词用淡黄色, 提示"可能识别错")
- 用户点击词, 跳到对应时间戳回放
- 多语言: 英文用空格分词, 中文用 jieba 或 Vosk 自带分词
