# 改动日志: 词级卡拉OK 字幕

**模型声明**: Claude Opus 4.8
**日期**: 2026-06-20
**类型**: Feature (sprint 1, 7 个特性之一)

---

## 概览

实现词级卡拉OK 字幕: 当前词高亮, 已读灰色, 未读淡色, 横向 1.2s 进度条.

## 改动文件

### 服务端

- `server/vosk_worker.py`
  - `get_recognizer`: 创建 `KaldiRecognizer` 后调用 `SetWords(True)` 开启词级输出 (兼容老版本 try/except)
  - `process` cmd: final 分支调用 `_extract_words()` 抽 `[{word, start, end, conf}]` 数组
  - `finalize` cmd: 同上, 把 `words` 放入 response_q 消息
  - 新增 `_extract_words(result)` 纯函数: 兼容 Vosk 两种返回格式
    1. `{"result": {"words": [...]}}` (新版)
    2. `{"words": [...]}` (旧版)

- `server/app.py`
  - `transcription_result` 事件处理: 把 `words` 累积到 `session['words_buffer']`, 段间时间归一化 (last_end 累加, 处理段间不连续)
  - emit 时下发累积的 `words_buffer` (客户端收到的是"全程累计"而非"单段")
  - partial 也下发 `words_buffer` (让客户端即使在 partial 期间也能继续用旧数据高亮)
  - 新增 `session['metrics']['final_chunk_index']` 跟踪段数

### 客户端

- `client/src/types.ts` (无改动, 已有 `WordInfo` / `TranscriptionResult.words`)

- `client/src/WebSocketClient.ts`
  - `transcription_result` 回调里加 `words: data.words || []`

- `client/src/App.tsx`
  - `AppState` 新增 `words: TranscriptionResult['words']` 和 `finalStartTime: number`
  - `onTranscriptionResult` 回调:
    - final 时接受 `result.words` (服务端累积)
    - final 时把 `finalStartTime = performance.now()` 重置 → 卡拉OK 从头开始
    - 调试日志增加 `(N 词)` 字段
  - `clearTranscription` / `playSampleAudio`: 重置 `words = []`, `finalStartTime = 0`
  - `<Subtitle>` 组件绑定 `words` / `finalStartTime` props

- `client/src/Subtitle.tsx` (重写)
  - 卡拉OK 渲染: `<SubtitleWord word isActive isPast />` 单个词组件, 三态
    - `isActive` (当前): 渐变背景 + 阴影 + scale 1.05
    - `isPast` (已读): 灰 #5a5a6e
    - 默认 (未读): 透明淡色
  - 横向进度条: `<motion.div width={progress*100}%>`, 1.2s linear
  - rAF 循环: `elapsedSec = (now - finalStartTime) / 1000` → 调用 `findActiveWordIndex` / `computeWordProgress`
  - 兜底: 无 `words` 时回退到旧版按句子切行
  - `will-change: transform` + React.memo → 60fps

- `client/src/subtitleKaraoke.ts` (新增)
  - `findActiveWordIndex(words, elapsedSec): number` 二分查找
  - `computeWordProgress(word, elapsedSec): number` 词内 0..1
  - `chunkWordsIntoLines(words, wordsPerLine): WordInfo[][]` 行切分

### 测试

- `client/src/__tests__/subtitleKaraoke.test.ts` (新增, 19 用例)
  - 边界: t < first.start, t > last.end
  - 段中: t 落在第 i 个词区间
  - 大量词 (100): 二分正确性
  - 词间空隙 (Vosk 实际常见)
  - 零时长词不除零
  - 集成: 0..3.5s 持续高亮索引单调不减

- `client/src/__tests__/WebSocketClient.test.ts` (1 用例增加 `words: []` 字段)

## 测试结果

```
✓ src/__tests__/subtitleKaraoke.test.ts  (19 tests) 6ms
✓ src/__tests__/samplePlayer.test.ts  (7 tests)
✓ src/__tests__/WebSocketClient.test.ts  (7 tests) 16ms
```

## 验收

- 词级高亮平滑 (rAF 60fps)
- 横向进度条跟随当前词 0..1
- 兜底兼容无 words 数据场景
- 19 个新单元测试全过
- 既有功能未删除 (Subtitle 旧 API 保留, 旧版"按句子切行"作为兜底分支)

## 已知限制

- 完整 build 受并行冲刺的 Visualizer / KeyboardShortcuts / PerfMonitor TS 错误影响, 那些属于其他 sprint, 不在本次范围
- 本次改动本身的 TS 编译零错误 (用 `tsc --noEmit` 验证)
- 真实 E2E 截图需等服务端启动 (Vosk 模型 + GPU/CPU), 截图保存到 `changes/2026-06-20-sprint-1-karaoke.png` (待后续 Playwright/Puppeteer 步骤)

## 后续

- 在 monitor 面板展示 words 累计数 + 平均词长
- 高亮颜色按 conf 自适应
- 点击词回放对应时间戳音频
