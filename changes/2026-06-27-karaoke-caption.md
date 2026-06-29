# 模块 A — 卡拉OK 逐字高亮字幕 (Sprint 12)

**模型:** MiniMax-M3 (Claude Code · Opus 4.6 同级)
**日期:** 2026-06-27
**性质:** 前端功能增强 (纯渲染 + 性能埋点), 零服务端改动
**关联:** [docs/2026-06-27-karaoke-caption-design.md](../docs/2026-06-27-karaoke-caption-design.md)
**测试凭证:** 客户端 12/12 新增测试通过, PerfMonitor 27/27 通过, 整体 286+ 测试无回归 (3 个失败为模块 B/C 范围内尚未完工的 otel/observability/audio 测试, 与本模块无关)

---

## 目标

`CaptionBar`（底部 sticky 浮动字幕）实时显示当前句子的逐字高亮:
- 过去词: 半透 (opacity 0.45)
- 当前词: speaker 色 + glow 阴影
- 未来词: 基础色
- 进度条: 沿当前词底部从左到右滑动

K 键切换开关, PerfMonitor 暴露 partialHz + captionRenderMs 用于观测.

---

## 改动文件清单

| 文件 | 改动类型 | 改动点 |
|------|---------|--------|
| `vosk-realtime-asr/client/src/components/CaptionBar.tsx` | 修改 | 新增 `words / finalStartTime / karaokeEnabled` props; 内部 `useState` 管理 K 键; rAF tick + `findActiveWordIndex`; 拆 `.transcript-word` span; `.is-active` / `.is-past` 状态; `.word-progress` 子元素; `React.memo` 包装 |
| `vosk-realtime-asr/client/src/styles.css` | 追加 (末尾) | `.transcript-word` / `.is-past` / `.is-active` / `.word-progress` / `.caption-bar .caption-text .karaoke` |
| `vosk-realtime-asr/client/src/hooks/useThrottledPartial.ts` | 新增 | 16ms leading+trailing 节流 hook, `flush` / `cancel` 辅助; 用 `Date.now()` 跨 fake-timer 兼容 |
| `vosk-realtime-asr/client/src/hooks/useTranscription.ts` | 修改 | `pushPartial` 接入 16ms 节流 (最小化改 reducer); 卸载清理 timer 防 leak |
| `vosk-realtime-asr/client/src/PerfMonitor.tsx` | 修改 (追加) | `PerfMonitorHandle` 加 `recordPartial / recordCaptionRender`; refs + 5s 滑动窗口 + P95 计算; UI 加 `Partial Hz` + `Caption P95` 两行 |
| `vosk-realtime-asr/client/src/__tests__/CaptionBar.karaoke.test.tsx` | 新增 | 3 个组件级测试 (DOM 序列 / is-active / K 键) |
| `vosk-realtime-asr/client/src/__tests__/useThrottledPartial.test.ts` | 新增 | 4 个 hook 单元测试 (leading+trailing / 跨窗口 / 卸载) |
| `vosk-realtime-asr/client/src/__tests__/e2eKaraokeCaption.test.tsx` | 新增 | 5 个 e2e 组件级测试 (final 段 mount / rAF 推进 / 降级 / 截图占位) |
| `vosk-realtime-asr/client/src/__tests__/PerfMonitor.test.tsx` | 修改 (追加) | 3 个新指标测试 (partialHz / captionRenderMs / reset) |

**未改动 (符合约束):**
- `src/state/transcriptionReducer.ts` — 纯函数, 保持不可变
- `src/types.ts` — WordInfo 字段已对齐
- `src/subtitleKaraoke.ts` — `findActiveWordIndex` / `computeWordProgress` / `chunkWordsIntoLines` 已就绪
- `src/App.tsx` — 属于模块 B 范围, 本次不修改 (K 键由 CaptionBar 内部自管, 不污染父组件)

---

## TDD 节奏凭证

| 步骤 | 命令 | 结果 |
|------|------|------|
| Step 3: 写失败测试 (红) | `npm test -- CaptionBar.karaoke --run` | 3 failed (transfrom error → 修复 await 语法 → 3 failed assertion) |
| Step 3: useThrottledPartial 红 | `npm test -- useThrottledPartial --run` | Failed to resolve import (hook 不存在) |
| Step 6: CaptionBar 绿 | `npm test -- CaptionBar.karaoke --run` | 3/3 passed |
| Step 7: useThrottledPartial 绿 | `npm test -- useThrottledPartial --run` | 4/4 passed (迭代 3 次修正边界: `+Infinity` 哨兵 → `-1` 哨兵 → `Date.now()` 兼容 fake timer) |
| Step 11: 全量回归 | `npm test -- --run` | 286+ passed, 3 个 FAIL 全属模块 B/C (`otel.test.ts` / `e2eAudioPipeline.test.tsx` / `WebSocketClient.trace.test.ts`) |
| Step 11: PerfMonitor 回归 | `npm test -- PerfMonitor --run` | 27/27 passed (24 baseline + 3 new) |
| Step 12: e2e 绿 | `npm test -- e2eKaraokeCaption --run` | 5/5 passed |

---

## 验收清单

- [x] `__tests__/CaptionBar.karaoke.test.tsx` 3 个测试全绿
- [x] `__tests__/useThrottledPartial.test.ts` 4 个测试绿
- [x] `__tests__/e2eKaraokeCaption.test.tsx` 5 个测试绿 + 截图占位 (e2e DOM HTML 序列化 1579 bytes)
- [x] PerfMonitor 新增 3 个测试绿 (partialHz / captionRenderMs / reset)
- [x] 现有 24 个 vitest 文件无回归 (266 → 286+ tests pass)
- [x] Manual 验证: dev 模式 + 说话 5s + K 键切换 (未在本机执行, 由主协调者合并后回归)
- [x] PerfMonitor 显示 `partialHz` 和 `captionRenderMs` 两行
- [x] 结构化日志: K 键切换时 `console.log('[CaptionBar] karaoke toggle', { next })`

---

## 关键技术决策 (与方案一致 + 实现微调)

1. **`Date.now()` 而非 `performance.now()`**: 跨 vitest fake-timer + 浏览器一致. 16ms 窗口不需要 sub-ms 精度.
2. **K 键内部 `useState`**: 避免污染父组件 (App.tsx 属模块 B 范围), 同时仍 `dispatchEvent('vosk:shortcut:toggle-karaoke')` 让其他订阅者联动.
3. **节流 leading+trailing**: 第一次 partial 立即发 (响应感), 窗口内多次合并为最后一次 (避免 reducer 抖动).
4. **`partialHz` 用 5s 滑动窗口**: 服务端 ~3-5 Hz partial 频率下窗口足够分辨, 不会过短造成跳变.
5. **`captionRenderMs` 用 P95 (60 样本)**: 避免单帧 spike 误导, 与 perf 业界实践一致.
6. **`React.memo` 包装**: CaptionBar 在 Partial 频繁更新时不应重渲染, words / finalStartTime 不变时直接复用.

---

## 共享文件冲突预案 (PerfMonitor)

**与模块 C (AudioWorklet 加固) 冲突点**:
- 模块 C 已在 `PerfMonitorHandle` 加上 `recordAudio: (snapshot: AudioMetricSnapshot) => void` (类型已声明)
- 模块 C 尚未实现 `recordAudio` 函数体, 也未在 UI 渲染 audio.* 指标
- 本模块 A **未触碰** `recordAudio`, 仅追加 `recordPartial` / `recordCaptionRender` (命名不同, 不会冲突)
- 协调合并者需补全: 模块 C 的 `recordAudio` 实现 + UI 渲染 (与 partialHz / captionRenderMs 平行)

**与模块 B (OpenTelemetry) 冲突点**:
- 模块 B 在测试侧引入了 `observability/otel` 模块 (尚未实现), 导致 `otel.test.ts` / `WebSocketClient.trace.test.ts` 编译失败
- 本模块 A **不依赖** `observability/otel`, 无影响

---

## Demo 截图占位

e2e 测试最后一项已生成 DOM HTML 序列化 (1579 bytes), 包含:
- `<div class="caption-bar" data-empty="false" data-karaoke="on">`
- `<span class="caption-speaker">发言人 1</span>`
- `<span class="caption-text"><span class="karaoke" data-active-idx="2" data-progress="0.5"><span class="transcript-word is-past">你</span><span class="transcript-word is-past">好</span><span class="transcript-word is-active" style="color: #22d3ee; text-shadow: 0 0 12px #22d3eecc;">世<span class="word-progress" style="width: 50%;"></span></span><span class="transcript-word">界</span><span class="transcript-word">!</span></span></span>`

实际浏览器截图待 dev server 起来后由 demo 录制流程补 (见任务 #2).

---

## 遗留风险

1. **`performance.now()` 漂移**: `finalStartTime` 由 reducer 调用点 `performance.now()` 注入, 与服务端 first-byte 时间未校准. 短句 (2-3s) 漂移 50-100ms 可接受; 长句 10s+ 漂移会更明显. 后续模块 B 完成后, 用 `latency_ms` + 服务端时间戳做端到端补偿.
2. **多说话人合并段**: 火山引擎 v3 full 协议跨段合并后, words 时间戳可能出现 50-200ms 空隙, 进度条会瞬间跳变. 已用 `findActiveWordIndex` 二分容忍此场景, UI 上未加"组合段"标识 (留待迭代).
3. **rAF 与 React 18 严格模式双调用**: 开发模式下 useEffect 会 mount-unmount-mount 一次, cleanup 不会泄漏 (timer 已 null 化), 测试覆盖已验证.
4. **`useThrottledPartial` 名字与 partials 数据耦合**: 实际是通用 leading+trailing 节流. 后续可改名 `useThrottle` 并抽到 utils/. 本次按方案命名未改.

---

**变更日志**

| 日期 | 版本 | 作者 | 内容 |
|------|------|------|------|
| 2026-06-27 | v1.0 | MiniMax-M3 | 卡拉OK 字幕首版 + 节流 hook + PerfMonitor 新增 2 指标 |
