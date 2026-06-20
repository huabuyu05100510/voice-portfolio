# Sprint 5 改动日志 — 架构重构 (Hooks + Reducer)

> 日期: 2026-06-20
> 模型: **Claude Opus 4.8**
> 范围: 仅前端 (client/src), 不动 server, 不动 Phase 1-4 组件

## TL;DR

- `App.tsx` 从 **734 行 → 98 行** (-87%)
- 抽出 4 个职责单一 hook: `useWebSocket` / `useRecorder` / `useTranscription` / `useDebugLog` (+ `useSampleAudio`)
- 引入 **纯函数 reducer** (`transcriptionReducer.ts`) 管理转写状态
- 抽出 4 个 layout 组件: `AppShell` / `AppLayout` / `AppHeader` / `ControlPanel` / `DebugPanel`
- 新增 **17 个单元测试** (12 reducer + 5 hook), **总计 131 vitest + 17 pytest = 148 测试全过**
- 端到端截图: `changes/2026-06-20-sprint-5-arch.png`

## 文件清单

### 新增 (10)

| 文件                                              | 行数 | 职责                                       |
|---------------------------------------------------|------|--------------------------------------------|
| `client/src/state/transcriptionReducer.ts`        | 91   | 纯函数, 5 个 action, 200 results 上限      |
| `client/src/hooks/useWebSocket.ts`                | 91   | ws client + 顶层连接状态机                 |
| `client/src/hooks/useRecorder.ts`                 | 98   | AudioCaptureEngine + 波形可视化包装        |
| `client/src/hooks/useTranscription.ts`            | 56   | reducer + React 桥接                       |
| `client/src/hooks/useDebugLog.ts`                 | 39   | 15 条环形 buffer, 同步 console.log          |
| `client/src/hooks/useSampleAudio.ts`              | 41   | 抽离 playSampleAudio (无麦播放样本)         |
| `client/src/AppLayout.tsx`                        | 62   | 纯展示布局 (header / main / footer)        |
| `client/src/AppShell.tsx`                         | 58   | AccessibilityProvider + 键盘快捷键 + Help   |
| `client/src/AppHeader.tsx`                        | 17   | 标题 + 连接状态 + 主题切换器               |
| `client/src/ControlPanel.tsx`                     | 66   | 录音按钮组 + 状态指示 + 波形                |
| `client/src/DebugPanel.tsx`                       | 32   | 调试日志表格                               |
| `client/src/__tests__/transcriptionReducer.test.ts` | 152 | 12 个 case 覆盖全部 action                  |
| `client/src/__tests__/useDebugLog.test.ts`        | 47   | 5 个 case 覆盖环形 + clear                 |
| `tests/capture_arch.py`                           | 39   | Playwright 端到端截图脚本                   |

### 修改 (1)

- `client/src/App.tsx`: **734 → 98 行** (-87%), 只剩 hook 编排 + 1 个 JSX

### 不动

- `server/` 全部文件
- `client/src/Subtitle.tsx` / `PerfMonitor.tsx` / `Visualizer.tsx` / `AccessibilityContext.tsx` / `KeyboardShortcuts.tsx` (Sprint 1-4 组件)
- `client/src/WebSocketClient.ts` / `AudioCapture.ts` (引擎)
- `client/src/samplePlayer.ts` (已被 useSampleAudio 复用)

## 关键设计

### 1. transcriptionReducer

```ts
type Action =
  | { type: 'TRANSCRIPT_PARTIAL'; text; fullText }
  | { type: 'TRANSCRIPT_FINAL'; result }
  | { type: 'AUDIO_CHUNK_RECORDED'; byteLength }
  | { type: 'METRICS_UPDATE'; metrics }
  | { type: 'CLEAR' }
  | { type: 'SESSION_RESET'; startTime };
```

不变量:
- `results` 最多 200 条, FIFO 淘汰
- `CLEAR` 保留 `metrics.startTime` (整次会话累计)
- final 不带 `words` 时, 沿用旧 `words` (karaoke 不掉)
- partial 不带 `fullText` 时, 沿用旧 `fullText`

### 2. Hook 暴露 callback registration 接口

`useWebSocket` / `useRecorder` 都用 ref 缓存回调, 避免 stale closure:

```ts
ws.onTranscription((r) => { ... });   // 永远是最新引用
```

调用方只 `register` 一次, 内部 ref 自驱。

### 3. App.tsx 形态

```tsx
export const App = () => {
  const ws = useWebSocket(...);
  const tr = useTranscription();
  const dbg = useDebugLog();
  const sampleAudio = useSampleAudio();
  const [status, setStatus] = useState<AppStatus>('idle');
  const statusRef = useRef(status);
  const perfHandleRef = useRef<PerfMonitorHandle | null>(null);
  const recorder = useRecorder({ onAudioData: ... });
  // 1 个 useEffect 桥接 ws -> tr
  // 4 个 useCallback: start / stop / clear / playSample
  // 1 个 useEffect: 键盘事件桥接
  return <AppLayout ... />;   // 全部 props 一次传齐
};
```

## 测试结果

```
$ npx vitest run
Test Files  11 passed (11)
Tests       131 passed (131)
Duration    5.44s

$ python3 -m pytest tests/test_vosk_engine.py tests/test_vosk_worker.py \
                       tests/test_metrics.py::TestMetricsCollector
17 passed, 1 warning in 144.31s
```

> 注: `test_websocket.py` / `test_metrics.py::TestPromEndpoint` / `test_ui_smoke.py`
> 集成测试需要 live server (WebSocket on 5000 + Prometheus 9091), Sprint 5 未启动 server,
> 仅跑离线单元测试, 与重构无关。

## 验证步骤

1. `npx tsc --noEmit && npx vite build` → 351 kB JS, 11 kB CSS, ✓
2. `npx vitest run` → 131/131 ✓
3. `python3 -m pytest` (离线部分) → 17/17 ✓
4. `npx vite preview --port 4173` + Playwright `capture_arch.py` → 截图保存

## 回滚

Sprint 4 的 App.tsx 已经 7 个 commit 前被覆盖; 直接 `git revert` 整个 commit 即可。
所有新增文件 (hooks / state / 子组件 / 测试) 都是独立的, 删除即可回滚到 Sprint 4 状态。

## 后续

- Sprint 6: 标注 (annotation) — reducer 加 `ANNOTATION_ADD` action
- Sprint 7: i18n — `STATUS_LABELS` 抽到 `i18n.ts`, AppShell 包 `<I18nProvider>`
- 持续: 任何复杂状态优先用 reducer, 简单 toggle 才用 `useState`

—— Claude Opus 4.8, 2026-06-20 17:09