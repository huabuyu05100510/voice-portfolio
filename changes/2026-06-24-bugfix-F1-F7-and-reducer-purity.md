# 功能 Bug 修复 — F1~F7 + Reducer 纯函数性 + Light 主题完整性

**模型:** claude-sonnet-4-6 (glm-5.2 续作)
**日期:** 2026-06-24
**性质:** 端到端 bug 修复 (服务端 + 客户端 + 样式), 不引入新依赖
**测试:** 客户端 182/182 通过 (含新增 6 个 F2 isCumulative 测试), 服务端 AST 解析通过

---

## 修复清单

| ID  | 问题 | 根因 | 影响 |
|-----|------|------|------|
| F1  | 开口前几秒音频丢失 | WSS 握手未完成就 emit `recording_started`, 客户端不 gate, `send_audio` 静默丢帧 | 用户前几句话不完整 |
| F2  | 多次 final 被错误合并为一句 | 服务端 single 模式 (一句一返), 客户端 reducer 默认走累积前缀匹配 | 卡片错乱, 同一句话反复覆盖 |
| F3  | 延迟指标随会话时长单调增长 | `latency_ms = now - _opened_at` 测的是会话总时长 | 监控面板数字失真 |
| F4  | `transcription_chars` 永远为 0 | `_on_volc_final` 只增加 Prometheus 计数器, 没更新 session 字典 | UI 统计不准 |
| F5  | 文本重复出现 | `smart_append` 被调用两次 (result.text + utterances 拼接) | 转写结果有重复段落 |
| F6  | `session_status` 每 chunk 推一次 (4x/s) | `handle_audio_data` 内无条件 emit | React 过度重渲染 |
| F7  | 停止录音立即显示 completed | `stop_recording` 同步设 completed, 但服务端还在推最后一条 final | 最后一段文字丢失 |
| A1  | Reducer 不是纯函数 | `finalStartTime: performance.now()` 在 reducer 内部 | 不可重放, 测试不稳定 |
| CSS | Light 主题视觉破损 | Light 块只覆盖 14 个旧 token, 缺 20+ Sprint 9 token | 浅色模式卡片/边框/文字错乱 |

---

## 改动详情

### 服务端 (Python)

#### `server/volcengine_session.py`
- 新增 `_opened_event = threading.Event()`, `_last_audio_sent_at`
- 握手 + 发 full request 完成后 `_opened_event.set()` (解除门控)
- 新增 `wait_until_ready(timeout) -> bool` 供 app.py 同步等待
- `send_audio()` 记录 `_last_audio_sent_at` (F3 真实延迟基准)
- final / full-utterance 帧的 `latency_ms` 改用 `now - _last_audio_sent_at` (F3)
- `close()` 时 `_opened_event.clear()`

#### `server/app.py`
- `handle_start_recording`: 调用 `volc_sess.wait_until_ready(timeout=5.0)`, 超时发 error 事件 (F1)
- `handle_audio_data`: `session_status` 改为 2s 节流, 用 `last_metrics_emit_at` (F6)
- `_on_volc_final`:
  - 增加 `session['metrics']['transcription_chars'] += len(text)` (F4)
  - 取消双重 `smart_append`, utterances 优先, 否则 fallback 到 result.text (F5)
  - payload 增加 `is_cumulative: false` 标记, 告知客户端 single 模式 (F2)
- `handle_stop_recording`: 保持 `status='transcribing'`, 不立即设 completed, 等 final 来 (F7)
- `create_session`: 增加 `last_metrics_emit_at: 0.0` 字段

### 客户端 (TypeScript)

#### `client/src/WebSocketClient.ts`
- `startRecording()` 改为返回 `Promise<void>`, resolve 时机 = 收到 `recording_started` (F1)
- 新增 `waitForRecordingReady(timeoutMs)` 显式等待门控
- `recording_started` 事件回调解除 `_recordingReadyResolve` (F1)
- 新增 `onRecordingReady` / `onRecordingStopped` 回调注册
- `transcription_result` 透传 `is_cumulative` 字段 (F2)
- `session_status` handler 取消硬编码的 `totalLatencies: 0` / `startTime: Date.now()`

#### `client/src/hooks/useWebSocket.ts`
- **A1 fix (stale closure)**: 返回 `clientRef` (ref 对象) 而非 `clientRef.current`, 消除"首渲染 client 为 null"的 stale 引用
- 新增 `onRecordingStopped` 回调桥接 (F7)

#### `client/src/App.tsx`
- `onAudioData` gate 收紧: 仅 `statusRef.current === 'recording'` 才 sendAudio (F1)
- `startRecording`: `await client.startRecording()` 等握手完成才 `setStatus('recording')` (F1)
- `stopRecording`: 设 `pendingStopRef`, status='transcribing', 加 3s 强制完成兜底 (F7)
- `onRecordingStopped` 回调: 真正 setStatus('completed') (F7)
- `pushFinal(r, r.isCumulative)` 透传累积模式 (F2)
- `ws.client` → `ws.clientRef.current` (避免 stale closure)

#### `client/src/state/transcriptionReducer.ts`
- `TRANSCRIPT_FINAL` action 增加 `timestamp?` / `isCumulative?` 字段
- `finalStartTime` 改用 action 注入的 timestamp (A1, 纯函数化)
- A/C/C2 三条前缀匹配路径加 `cumulativeMode` 守卫, `isCumulative=false` 时全部跳过 (F2)
- Path B (重复子串跳过) 在 cumulative 之外仍生效, 防止服务端偶发重发

#### `client/src/hooks/useTranscription.ts`
- `pushFinal(result, isCumulative?)` 签名扩展
- `performance.now()` 在调用点 (dispatch 处) 注入, 不在 reducer 内调用 (A1)

#### `client/src/types.ts`
- `TranscriptionResult` 新增 `isCumulative?: boolean`

#### `client/src/styles.css`
- Light 主题从 14 个旧 token 扩展为完整 Sprint 9 token 集 (40+):
  - `--bg-0/1/2/3/overlay`
  - `--border-1/2/3`
  - `--text-1/2/3/4/on-brand`
  - `--brand-50/100/300/500/600/700`
  - `--success/warning/danger/info-500/600`
  - `--spk-1~6` (浅色友好的中饱和度)
  - `--shadow-1/2/3/inset`, `--glow`, `--glow-danger`

---

## 测试

### 新增测试 (6 个, 全部通过)
`client/src/__tests__/transcriptionReducer.test.ts`:
- `isCumulative=false 时, 即使新文本以旧文本为前缀也不合并, 直接新增`
- `isCumulative=false 时, 即使是同一说话人也不触发 C2 子串合并`
- `isCumulative=true 时, 仍走累积合并路径 (向后兼容)`
- `未指定 isCumulative (undefined) 时, 默认走累积模式 (兼容老服务端)`
- `isCumulative=false 时, 重复文本仍被跳过 (path B 在 cumulative 之外生效)`
- `A1: 未注入 timestamp 时沿用旧值 (reducer 保持纯函数, 无副作用)`

### 修订测试 (1 个)
- 原 `重置 finalStartTime 为 performance.now()` → 改为验证"用 action 注入的 timestamp 覆盖" (反映纯 reducer 契约)

### 客户端套件
```
Test Files  18 passed (18)
     Tests  182 passed (182)
```

### 服务端
依赖未在 CI 安装, 用 `ast.parse` 对 `app.py` / `volcengine_session.py` / `text_buffer.py` 做语法校验, 全部通过。

---

## 验证 Checklist

- [x] F1: WSS 握手完成才发 `recording_started`, 客户端 `await` 门控
- [x] F2: 服务端 `is_cumulative=false`, reducer 跳过前缀匹配
- [x] F3: 延迟用 `_last_audio_sent_at` 而非 `_opened_at`
- [x] F4: `transcription_chars` 真实递增
- [x] F5: 单一 `smart_append` 路径 (utterances 优先)
- [x] F6: `session_status` 2s 节流
- [x] F7: 停止后 status='transcribing' 等 final + recording_stopped
- [x] A1: reducer 无副作用 (timestamp 由调用方注入)
- [x] CSS: Light 主题覆盖完整 Sprint 9 token 集
- [x] TypeScript `tsc --noEmit` 无新增错误 (剩 1 个预存 DebugPanel unused var)
- [x] 客户端测试 182/182 通过
- [x] Stale closure (`ws.client` → `ws.clientRef.current`) 修复

---

## 未完成 (后续 Sprint)

- A3: 22-prop god component → Zustand store (架构级, 单独 PR)
- A4: `WebSocketClient` 单回调覆盖风险 → EventTarget 多订阅
- 死代码清理: `.app-main` 旧 grid, 重复的 `.transcription-section`
- `TranscriptHero` 动画 key 用 index 的问题
- `StatusBar` FPS 指标实际是 chunks/s 的命名误导
