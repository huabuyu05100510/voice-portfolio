# 改动日志: 60fps 性能监控 (Sprint 2)

**日期**: 2026-06-20
**类型**: Feature
**作者**: MiniMax-M3

## 摘要

新增 `client/src/PerfMonitor.tsx`, 在右下角显示 FPS / 帧时间 / 转写延迟 P50-P95-P99 / 内存, 默认折叠, 点 ⚡ 展开。同时在 `WebSocketClient` 加 `sendTimeQueue` + `onLatencyRecorded` 回调实现端到端延迟测量。

## 主要改动

### 1. 新文件

- `client/src/PerfMonitor.tsx` (主组件, 200+ 行, 4 个纯函数)
- `client/src/__tests__/PerfMonitor.test.tsx` (24 个测试用例)

### 2. WebSocketClient.ts 改动

加端到端延迟跟踪:
- `sendTimeQueue: number[]` — FIFO 队列, sendAudio 时 push `performance.now()`
- `maxPending = 64` — 限制队列长度, 断网时不无限增长
- `onLatencyRecorded(callback)` — 注册延迟回调
- `transcription_result` 事件 handler 中 shift 队首算 delta
- `resetLatencyTracking()` — 切换 session 时清空

### 3. App.tsx 改动

- 引入 `PerfMonitor` + `PerfMonitorHandle`
- `perfHandleRef` 保存 handle
- `wsClient.onLatencyRecorded` 推给 `perfHandleRef.current.recordLatency`
- 末尾 mount `<PerfMonitor onHandle={...} defaultOpen={false} />`

### 4. styles.css 改动

加 dev-mode 深色风格样式:
- `.perf-monitor-root` fixed 右下角
- `.perf-toggle` 36x36 圆形按钮, hover/active 缩放 (GPU 合成层)
- `.perf-panel` 220px 宽, backdrop-filter blur, 15ms 入场动画
- `prefers-reduced-motion` 兜底
- 等宽字体 (SF Mono / Monaco / Cascadia Code / Roboto Mono / Consolas)
- `font-variant-numeric: tabular-nums` 数字等宽

## 测试

```
 ✓ src/__tests__/PerfMonitor.test.tsx  (24 tests) 119ms
```

覆盖:
- percentile 边界 + 经典样本 + 乱序
- SlidingWindow 容量 / 丢弃 / 清空
- FPS 计算 (60fps / 30fps / 掉帧 / 空)
- formatBytes 边界
- DOM: 渲染 / 切换 / handle 推数据 / reset

## 截图

`changes/2026-06-20-sprint-2-perf.png` (需 Playwright 抓取, 见 docs/2026-06-20-sprint-2-perf.md §6)

## 兼容性

- 无新依赖 (用 React 18 内置 hooks)
- 兼容 Chrome / Safari / Firefox (memory API 仅 Chrome 显示, 其它显示 N/A)
- 兼容 prefers-reduced-motion

## 性能影响

- 主线程开销: < 0.2ms / 秒 (rAF push 60Hz + 1Hz 排序 200 元素)
- 内存: SlidingWindow 200 * 8 bytes = 1.6KB
- 不影响主字幕 / 转写性能
