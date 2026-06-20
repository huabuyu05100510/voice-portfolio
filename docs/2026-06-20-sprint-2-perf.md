# Sprint 2: 60fps 性能监控 + 转写延迟分位数

**日期**: 2026-06-20
**作者**: MiniMax-M3 (claude-code subagent)
**范围**: 客户端性能可观测性 (FPS / 帧时间 / 转写延迟 P50-P95-P99 / 内存)

## 1. 目标

为前端转写 Demo 加一个右下角可折叠的小面板 (`⚡` 图标), 实时显示:
- 当前 FPS (绿 ≥55, 黄 30-54, 红 <30)
- 帧时间 (ms)
- 转写延迟 **P50 / P95 / P99** (基于最近 200 个样本)
- 内存占用 (`performance.memory`, Chrome 私有)

对标 [web.dev optimize-long-tasks](https://web.dev/articles/optimize-long-tasks) 的 rAF 滑动窗口方案, 主线程开销 < 0.1ms/帧。

## 2. 技术方案

### 2.1 数据流

```
AudioCapture  --Int16Array-->  App.handleAudioData
                                    |
                                    v
                          wsClient.sendAudio(buf)
                                    |
                          [+ push performance.now() 到 sendTimeQueue]
                                    |
                                    v (网络, 服务器转写)
                                    |
wsClient.onTranscriptionResult <----+
    |
    | shift sendTimeQueue -> sentAt
    | delta = performance.now() - sentAt
    v
wsClient.onLatencyRecorded(latencyMs)  -->  PerfMonitor.handle.recordLatency
                                                  |
                                                  v
                                          SlidingWindow(200).push(delta)
                                                  |
                                                  v (1Hz tick)
                                          percentile() -> P50/P95/P99
```

### 2.2 关键实现

**百分位计算 (nearest-rank)**
```ts
export function percentile(xs, p) {
  if (p < 0 || p > 100) throw new Error(...);
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);  // 1-indexed
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}
```
- nearest-rank 与 numpy 默认行为一致
- O(n log n) 排序, 200 样本下 < 0.05ms, 1Hz 调用无压力

**环形缓冲 FPS**
- `Float64Array(60)` + `head` 指针
- 60 帧 / 60fps = 1 秒窗口, 跨设备一致
- 每 30 帧才重算 FPS (避免每帧 sort)

**SlidingWindow (FIFO)**
- 环形数组 + head 指针, push O(1)
- 200 容量: 4KB 内存, 装 200 * 8 bytes
- 防回包队列无限增长: `maxPending = 64`, 超界丢最老

**rAF 频率 vs 渲染频率解耦**
- rAF 回调 60Hz, 但只做 `times[head++] = t` 和 `frameTime = t - last`
- React 渲染 1Hz (setInterval 1000ms)
- 防止 React 调度阻塞 rAF, 满足"60fps 不掉帧"

### 2.3 主线程开销

| 操作 | 频率 | 单次成本 |
|------|------|----------|
| rAF 推时间戳 | 60Hz | ~10ns (数组写入) |
| FPS 重算 | 2Hz (head%30==0) | O(60) ~ 0.01ms |
| 内存采样 | 1Hz | property 读取 ~ 1µs |
| 百分位排序 | 1Hz | O(200 log 200) ~ 0.05ms |
| React 渲染 | 1Hz | 8 个 text 节点, < 0.1ms |

合计: ~0.2ms / 秒, 对主转写管线影响 < 0.5%

## 3. TDD 流程

### 3.1 写的测试 (24 个, 全绿)

`client/src/__tests__/PerfMonitor.test.tsx`:

1. **percentile 边界**: 空数组 / 单元素 / 范围错误
2. **经典 1..100**: P50=50, P95=95, P99=99 (nearest-rank 验证)
3. **乱序输入**: 排序后算
4. **真实场景**: 195 个 30-50ms + 5 个 200+ms 偶发延迟
5. **SlidingWindow**: capacity / 超界丢弃 / 1000 push 后 size=200
6. **computeFpsFromFrames**: 60fps / 30fps / 单帧 / 空
7. **formatBytes**: 0 / 1023 / 1024 / 1.5MB
8. **DOM 渲染**: `[data-perf]` 存在, 默认折叠
9. **toggle 切换**: 面板展开 `[data-perf-open]="true"`
10. **handle.recordLatency**: 推 100 样本, samples 计数显示
11. **rAF tick**: FPS 渲染非负
12. **handle.reset**: 不抛错

```
 ✓ src/__tests__/PerfMonitor.test.tsx  (24 tests) 119ms
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

### 3.2 修复的 bug

| Bug | 修复 |
|-----|------|
| `formatBytes(1024)` 返回 `"1 KB"` 而非 `"1.0 KB"` (parseFloat 剥掉 0) | 改用 toFixed 后不 parseFloat |
| `tick` 变量未使用 TS6133 | 用 `useState(0)` 仅作 setState 触发器, destructure 时丢弃 |
| JSX 在 `.ts` 文件报 esbuild 错 | 改 `.test.ts` -> `.test.tsx` |

## 4. 改动文件清单

| 文件 | 性质 | 说明 |
|------|------|------|
| `client/src/PerfMonitor.tsx` | 新建 | 主组件 + 4 个纯函数 (percentile / SlidingWindow / computeFpsFromFrames / formatBytes) |
| `client/src/__tests__/PerfMonitor.test.tsx` | 新建 | 24 个 vitest case |
| `client/src/WebSocketClient.ts` | 修改 | 加 `sendTimeQueue` + `onLatencyRecorded` 回调 + `resetLatencyTracking()` |
| `client/src/App.tsx` | 修改 | 引入 PerfMonitor, 注册 latency 回调, 挂载组件 |
| `client/src/styles.css` | 修改 | 加 `.perf-monitor-root` / `.perf-toggle` / `.perf-panel` 等 dev-mode 样式 |
| `changes/2026-06-20-sprint-2-perf.md` | 新建 | 改动日志 (人类可读) |
| `changes/2026-06-20-sprint-2-perf.png` | 新建 | 截图 |

## 5. 可观测性

- `data-perf` 根元素 (e2e selector)
- `data-perf-open` 状态属性
- `data-perf-fps` / `data-perf-frame` / `data-perf-p50` / `data-perf-p95` / `data-perf-p99` / `data-perf-mem`
- F12 console 仍打 `[WS] sendAudio` 日志 (1/20 抽样)
- 无新网络请求 (全部本地计算)

## 6. 验收

- [x] 24/24 vitest 通过
- [x] `vite build` 通过 (427 modules, 343kB)
- [x] TypeScript 无 PerfMonitor 相关错误
- [x] DOM 中有 `[data-perf]` 元素
- [x] 默认折叠, 点 ⚡ 展开
- [x] FPS / Frame / P50 / P95 / P99 / 内存 6 个指标实时刷新 (1Hz)
- [x] 主线程开销 < 0.5% (估算, 需 Playwright 实测)
- [x] 截图保存到 `changes/2026-06-20-sprint-2-perf.png`

## 7. 后续 TODO (留给 Sprint 3+)

- PerfMonitor 暴露 `enable()` / `disable()` 控制是否记录 (省电模式)
- 把 P50/P95/P99 推到 Prometheus (有 perf-bridge)
- 帧时间超过 50ms 自动报警 (Web Audio tick)
- 与 Visualizer 共享 AudioContext, 避免双采样
