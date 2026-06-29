# 代码重构方案 — 实时语音转写作品集

**模型:** claude-sonnet-4-6
**日期:** 2026-06-24
**性质:** 全栈根本性重构（架构 + 功能 + 样式）

---

## 一、功能 Bug（优先于架构问题）

这是用户直接能感知到的问题，必须先修。

---

### Bug F1：前几秒音频全部丢失（最严重）

**涉及文件：** `server/app.py:362-368` + `server/volcengine_session.py:100-108` + `client/src/App.tsx:62-67`

**链路追踪：**

```
客户端 emit('start_recording')
         ↓
服务端 handle_start_recording():
    volc_sess = VolcengineSession(...)
    volc_sess.start()         ← 启动后台线程，立即返回，WSS 尚未建立
    emit('recording_started') ← 立即告知客户端"可以开始"（此时 WSS 还在握手！）

客户端收到 recording_started 事件：
    console.log(...)           ← 完全忽略，不等待任何 gate
    status = 'recording'
    开始 sendAudio()           ← 音频流进来了

服务端 handle_audio_data():
    volc_sess.send_audio(data) → VolcengineSession.send_audio():
        if not self._ws or not self._opened:
            return              ← 静默丢弃！WSS 还没建立完
```

**ByteDance WSS 握手耗时：** 在国内一般 200ms~1000ms，首帧 config 发送后还要等服务端 ACK。这段时间内所有音频帧被 `send_audio` 的 guard 静默丢弃。

**结果：** 用户开口前几个字必丢，识别开头不完整。

**根因：** `recording_started` 在 WSS 握手完成前就 emit 了；客户端收到后也不 gate。

**正确方案：**

```python
# server/volcengine_session.py — 增加 opened_event
self._opened_event = threading.Event()

def _handshake_and_send_config(self):
    ...
    self._ws = create_connection(url, header=headers, timeout=10)
    self._ws.send_binary(encode_full_client_request(payload))
    self._opened = True
    self._opened_event.set()  # ← 握手完成后才通知

def wait_until_ready(self, timeout=5.0) -> bool:
    return self._opened_event.wait(timeout=timeout)
```

```python
# server/app.py — handle_start_recording
volc_sess.start()
ready = volc_sess.wait_until_ready(timeout=5.0)
if not ready:
    emit('error', {'message': '火山引擎连接超时'})
    return
emit('recording_started', {...})   # ← 真正握手完成后才发
```

```ts
// client/src/WebSocketClient.ts — recording_started 触发真正的 gate
this.socket.on('recording_started', () => {
    this._recordingReady = true;
    this.onRecordingStartedCallback?.();
});
```

```ts
// client/src/App.tsx
const startRecording = useCallback(async () => {
    setStatus('connecting');
    await recorder.start();
    await ws.waitForRecordingReady();   // 阻塞到服务端真的 ready
    setStatus('recording');
}, [...]);
```

---

### Bug F2：`result_type: "single"` 与客户端累积合并逻辑冲突

**涉及文件：** `server/volcengine_engine.py:303` + `client/src/state/transcriptionReducer.ts:130-191`

**服务端配置：**
```python
# build_full_request_payload
result_type: str = "single",  # 一句一返，每次 final 只有当前句子
```

**客户端假设（累积模式）：**
```ts
// transcriptionReducer.ts 中的合并逻辑
if (newText.startsWith(lastText)) {
    // A) 累积扩展 — 就地更新
} else if (newText.startsWith(lastText.slice(0, max(8, 0.7*len)))) {
    // C) 长前缀重合 — 就地更新
} else if (newText.includes(lastText.slice(0, 10))) {
    // C2) 10字前缀 — 就地更新
} else {
    // D) 独立追加
}
```

`single` 模式下，每句话是完全独立的。逻辑走向：
- A/C/C2 均失败（无共同前缀）
- D 触发：每次都追加新卡片 ✓

但如果同一说话人发了"你好"，然后又发"你好，今天天气真不错"（累积前缀相同），C2 会误判为累积合并，把第二句"就地替换"第一句，导致第一句消失。

**根因：** 客户端 reducer 的合并启发式算法对 `single` 模式的独立句子误判率很高。

**正确方案：**
1. 服务端改用 `result_type: "each"` 或直接在 payload 中添加 `incremental: false` 标记
2. 或者在服务端 `transcription_result` 事件中增加 `mode: "single"` 字段，客户端收到后直接走 D 路径，不做启发式合并

---

### Bug F3：延迟指标完全错误

**涉及文件：** `server/volcengine_session.py:254`

```python
# 错误：计算的是"会话建立以来的总时长"，不是"本句话的识别延迟"
latency_ms = (time.time() - self._opened_at) * 1000 if self._opened_at else 0
```

`_opened_at` 在握手完成时记录一次，之后每次 final 都用 `now - _opened_at`。第 1 句话延迟可能是 500ms，第 100 句话延迟就是 "5 分钟"——完全没有意义。

**正确方案：** 记录每帧音频的发送时间，在 final 回调中取最近发送帧的时间差：

```python
# VolcengineSession 中
self._last_audio_sent_at: Optional[float] = None

def send_audio(self, audio):
    self._last_audio_sent_at = time.time()
    ...

# _handle_frame 中
def _on_final_frame(self, ...):
    latency_ms = (time.time() - self._last_audio_sent_at) * 1000 \
                 if self._last_audio_sent_at else 0
    self.on_final(..., latency_ms=latency_ms, ...)
```

---

### Bug F4：`transcription_chars` 指标永远为 0

**涉及文件：** `server/app.py:_on_volc_final` vs `session['metrics']['transcription_chars']`

```python
# _on_volc_final 中只更新了 Prometheus 指标
metrics.transcription_chars_total.labels(language='zh').inc(len(text))

# 但 session 字典里的 transcription_chars 从来没更新！
# session['metrics']['transcription_chars'] 永远是 0

# 于是 session_status emit 给前端的也永远是 0：
emit('session_status', {
    'metrics': {
        'transcription_chars': session['metrics']['transcription_chars'],  # ← 0
    }
})
```

**修复：**
```python
def _on_volc_final(text, utterances, speakers, latency_ms=0, sid=None):
    session = sessions.get(sid)
    if not session: return
    session['metrics']['transcription_chars'] += len(text)  # ← 加上这行
    ...
```

---

### Bug F5：`text_buffer.smart_append` 的双重追加

**涉及文件：** `server/app.py:218-223`

```python
def _on_volc_final(text, utterances, speakers, ...):
    # 第一次 smart_append：用 result.text
    session['text_buffer'], _ = smart_append(session['text_buffer'], text)

    # 第二次 smart_append：用 utterances 拼接的 utt_text
    if utterances:
        utt_text = extract_text_from_utterances(utterances)
        if utt_text:
            session['text_buffer'], _ = smart_append(session['text_buffer'], utt_text)
```

火山引擎的 `result.text` 通常等于 utterances 拼接结果（两者都是同一句话）。两次 `smart_append` 调用：

- 第一次：buffer = "你好世界 "
- 第二次：`utt_text` = "你好世界"，`smart_append("你好世界 ", "你好世界")` → `"你好世界"` 是 buffer 的子串 → 返回 buffer 不变（依赖 `if new_text in buf_stripped`）

看起来第二次是 no-op，但如果 `utt_text` 比 `text` 多出多说话人的空格分隔：
```
text = "你好这是测试"
utt_text = "你好 这是测试"   ← utterances 拼接加了空格
```

`"你好 这是测试"` 不在 `"你好这是测试 "` 里，走到"完全独立"路径，追加：buffer = `"你好这是测试 你好 这是测试 "`。内容重复！

**修复：** 统一使用 utterances 拼接路径，移除对 `result.text` 的双重处理。

---

### Bug F6：`session_status` 每个音频 chunk 都 emit（每秒 4 次全量推送）

**涉及文件：** `server/app.py:409-419`

```python
@socketio.on('audio_data')
def handle_audio_data(data):
    # ...处理音频...
    emit('session_status', { 'metrics': {...} })  # 每收到一个 chunk 就 emit
```

16kHz，每 0.25s 一个 chunk = **每秒 4 次 session_status 事件**。客户端每次收到就调用 `useAppStore.getState().actions.updateMetrics()`，触发所有订阅 metrics 的组件 re-render。StatusBar、MetricGrid 每秒 4 次 re-render。

**修复：** 节流到每 2 秒最多 emit 1 次：

```python
METRICS_THROTTLE_S = 2.0
last_status_emit = session.get('_last_status_emit', 0)
if time.time() - last_status_emit >= METRICS_THROTTLE_S:
    session['_last_status_emit'] = time.time()
    emit('session_status', {'metrics': {...}})
```

---

### Bug F7：`stopRecording` 后服务端仍可能 emit 最终 transcript

**涉及文件：** `server/app.py:422-464` + `client/src/App.tsx:69-72`

```ts
// 客户端：stop_recording 后立即设为 'completed'
const stopRecording = useCallback(() => {
    recorder.stop();
    ws.client?.stopRecording();
    setStatus('completed');    // ← 立即完成
}, [...]);
```

```python
# 服务端：stop_recording 调用 finalize()，但 VolcengineSession 还在读线程里
volc_sess.finalize()  # 发 LAST 帧
# 读线程继续跑，ByteDance 最终会回 final 帧，触发 on_final → emit transcription_result
```

客户端状态已经是 `completed`，但服务端还会 emit 最后几句 `transcription_result`。客户端收到后仍会调用 `tr.pushFinal()`，更新 results 数组——这本身不是 bug，但 StatusBar 会短暂显示 'completed' 然后又出现新内容，让用户困惑。

**修复：** 客户端在 `stopRecording` 后等待服务端 `recording_stopped` 事件再设为 `completed`：

```ts
// WebSocketClient — 注册 recording_stopped 回调
this.socket.on('recording_stopped', (data) => {
    this.onRecordingStoppedCallback?.(data);
});

// App.tsx
const stopRecording = useCallback(() => {
    recorder.stop();
    setStatus('transcribing');   // 还在处理中
    ws.waitForRecordingStopped().then(() => setStatus('completed'));
    ws.client?.stopRecording();
}, [...]);
```

---

## 二、架构 Bug（影响可维护性和稳定性）

### 问题 A1：22-Prop Prop Drilling + 手动 Memo 比较器

**文件：** `AppLayout.tsx:34-84`

`areAppLayoutPropsEqual` 手工维护 22 个字段的等式判断。每次加一个 prop，必须同步更新此函数，否则**组件静默不更新**。

Sprint 9 加了 `utterances` prop，但 `areAppLayoutPropsEqual` 已失去同步。

**修复：** Zustand store 取代 prop drilling（见下文架构方案）。

---

### 问题 A2：Pure Reducer 里有副作用

**文件：** `transcriptionReducer.ts:199`

```ts
case 'TRANSCRIPT_FINAL': {
    return {
        ...state,
        finalStartTime: performance.now(),  // ← 副作用，破坏纯函数性
    };
}
```

React StrictMode 执行 reducer 两次，每次结果不同。单测无法精确断言 `finalStartTime`。

---

### 问题 A3：Light Theme 完全失效

**文件：** `styles.css:176-190`

Sprint 9 定义了 20+ 个新 token（`--bg-0`、`--bg-1`、`--text-1`...），Light 主题只覆盖 7 个旧 token。所有 Sprint 9 组件在 light 模式下使用暗色系默认值，**light 主题视觉损坏**。

---

### 问题 A4：WebSocketClient 单回调 + Stale Ref

**文件：** `WebSocketClient.ts:17-22` + `useWebSocket.ts:104`

- `onTranscriptionResult(cb)` 第二次调用静默覆盖第一个订阅者
- `return { client: clientRef.current }` 初始渲染时 client 是 null

---

### 问题 A5：Custom Document Event Bus（键盘快捷键）

**文件：** `App.tsx:84-100`

`document.addEventListener('vosk:shortcut:toggle-record', ...)` 绕过 React 数据流，无法在 DevTools 中追踪。

---

### 问题 A6：Error Banner 无法关闭

**文件：** `AppLayout.tsx:144`

```tsx
<button>✕</button>  // 没有 onClick
```

---

### 问题 A7：TranscriptHero 动画 Key 用数组 Index

**文件：** `TranscriptHero.tsx:84`

```ts
key={`r-${idx}-${r.text?.slice(0, 12)}`}
```

增量合并替换最后一个 result 时，index 不变但内容变，Framer Motion 做错误的入场动画。

---

### 问题 A8：Dead Code 污染

| 文件/代码 | 状态 |
|-----------|------|
| `ControlPanel.tsx` | 无任何 import，应删除 |
| `ObservabilityPanel.tsx` | 同上 |
| `<Subtitle>` 仍在 AppLayout render | 注释说"已被 CaptionBar 取代" |
| `.app-main` CSS grid | 旧三栏布局，已被 `.app-shell` 替代 |
| `.transcription-section` 定义两次 | line 541 和 line 1271 形成 specificity 竞争 |

---

## 三、重构方案

### 总体顺序

```
第 0 层：功能 hotfix（F1-F7，最高优先）
第 1 层：Dead code 清理 + CSS light theme 修复
第 2 层：状态层（Zustand store）
第 3 层：传输层（WebSocketClient EventEmitter）
第 4 层：组件层（ErrorBoundary，key，close handler）
第 5 层：CSS 重构（CSS Modules）
第 6 层：测试修复
```

---

### 第 0 层：功能 Hotfix（最高优先）

**F1 修复：音频 gate 机制**

```python
# volcengine_session.py — 增加 wait_until_ready
class VolcengineSession:
    def __init__(self, ...):
        self._opened_event = threading.Event()

    def _handshake_and_send_config(self):
        self._ws = create_connection(url, header=headers, timeout=10)
        self._ws.send_binary(encode_full_client_request(payload))
        self._opened = True
        self._opened_event.set()  # ← 握手+config 发送后才 set

    def wait_until_ready(self, timeout=5.0) -> bool:
        return self._opened_event.wait(timeout=timeout)
```

```python
# app.py — handle_start_recording
volc_sess.start()
ready = volc_sess.wait_until_ready(timeout=5.0)
if not ready:
    session.pop('volc_session', None)
    emit('error', {'message': '火山引擎连接超时，请重试'})
    return
emit('recording_started', {'session_id': session_id, ...})
```

```ts
// WebSocketClient.ts — recording_started 设 gate
private _recordingReadyResolve: (() => void) | null = null;
private _recordingReadyPromise: Promise<void> = Promise.resolve();

startRecording(): void {
    this._recordingReadyPromise = new Promise(resolve => {
        this._recordingReadyResolve = resolve;
    });
    this.socket?.emit('start_recording');
}

// 在 connect() 里注册：
this.socket.on('recording_started', () => {
    this._recordingReadyResolve?.();
    this._recordingReadyResolve = null;
});

waitForRecordingReady(): Promise<void> {
    return this._recordingReadyPromise;
}
```

```ts
// App.tsx
const startRecording = useCallback(async () => {
    setStatus('connecting');
    await recorder.start();
    ws.client!.startRecording();
    await ws.client!.waitForRecordingReady();  // ← 等 WSS 握手
    setStatus('recording');
}, [...]);
```

---

**F2 修复：统一 result_type，消除合并歧义**

最简洁的修复：服务端在 `transcription_result` 中明确标记 `is_cumulative: false`，客户端 reducer 直接走 D 路径：

```python
# app.py — _on_volc_final
payload = {
    ...
    'is_cumulative': False,  # single 模式，每句话独立
}
```

```ts
// transcriptionReducer.ts — 简化合并逻辑
case 'TRANSCRIPT_FINAL': {
    const { result } = action;
    if (result.is_cumulative === false) {
        // 直接追加，不做启发式合并
        const nextResults = [...state.results, result].slice(-MAX_RESULTS);
        return { ...state, results: nextResults, currentText: '', ... };
    }
    // 原有启发式合并（仅对 cumulative 模式）
    ...
}
```

---

**F3 修复：延迟计算改为每帧发送时间差**

```python
# volcengine_session.py
self._last_audio_sent_at: Optional[float] = None

def send_audio(self, audio: bytes) -> None:
    if not self._ws or not self._opened:
        return
    self._last_audio_sent_at = time.time()
    ...

# _handle_frame 处理 final 时
if ptype == "final":
    latency_ms = (time.time() - self._last_audio_sent_at) * 1000 \
                 if self._last_audio_sent_at else 0
    ...
```

---

**F4 修复：transcription_chars 更新**

```python
# app.py — _on_volc_final
session['metrics']['transcription_chars'] += len(text)  # ← 一行
```

---

**F5 修复：text_buffer 双重追加**

```python
# app.py — _on_volc_final，移除对 result.text 的直接追加，统一用 utterances
if utterances:
    utt_text = extract_text_from_utterances(utterances)
    if utt_text:
        session['text_buffer'], _ = smart_append(session['text_buffer'], utt_text)
elif text:
    # 没有 utterances 时，才退回用 result.text
    session['text_buffer'], _ = smart_append(session['text_buffer'], text)
```

---

**F6 修复：session_status 节流**

```python
# app.py — handle_audio_data
METRICS_EMIT_INTERVAL = 2.0

now = time.time()
if now - session.get('_last_metrics_emit', 0) >= METRICS_EMIT_INTERVAL:
    session['_last_metrics_emit'] = now
    emit('session_status', { 'metrics': {...} })
```

---

**F7 修复：stopRecording 等待 recording_stopped**

```ts
// WebSocketClient.ts
private _stoppedResolve: (() => void) | null = null;
waitForRecordingStopped(): Promise<void> {
    return new Promise(resolve => { this._stoppedResolve = resolve; });
}
// 在 connect() 里：
this.socket.on('recording_stopped', () => {
    this._stoppedResolve?.();
    this._stoppedResolve = null;
});

// App.tsx
const stopRecording = useCallback(() => {
    recorder.stop();
    setStatus('transcribing');
    ws.client!.stopRecording();
    ws.client!.waitForRecordingStopped().then(() => setStatus('completed'));
}, [...]);
```

---

### 第 1 层：Dead Code 清理 + Light Theme

```bash
rm src/ControlPanel.tsx
rm src/ObservabilityPanel.tsx
```

`AppLayout.tsx`: 删除 `<Subtitle>` 渲染和 import。

**Light Theme（立即修复）：**

```css
:root[data-theme="light"] {
  /* Sprint 9 surface tokens */
  --bg-0: #f0f0f5;
  --bg-1: #ffffff;
  --bg-2: #f5f5fa;
  --bg-3: #e8e8f0;
  --bg-overlay: rgba(240, 240, 245, 0.85);
  --border-1: rgba(0, 0, 0, 0.08);
  --border-2: rgba(0, 0, 0, 0.14);
  --border-3: rgba(0, 0, 0, 0.22);
  --text-1: #111118;
  --text-2: #3c3c48;
  --text-3: #7a7a88;
  --text-4: #b0b0be;
  --text-on-brand: #ffffff;
  --brand-50:  rgba(0, 102, 204, 0.06);
  --brand-100: rgba(0, 102, 204, 0.12);
  --brand-300: rgba(0, 102, 204, 0.40);
  --brand-500: #0066cc;
  --brand-600: #0052a3;
  --glow: 0 0 0 1px var(--brand-300), 0 0 16px rgba(0, 102, 204, 0.20);
  /* Legacy aliases */
  --primary-color: var(--brand-500);
  --background-dark: var(--bg-0);
  --background-card: var(--bg-1);
  --background-elevated: var(--bg-2);
  --text-primary: var(--text-1);
  --text-secondary: var(--text-2);
  --border-color: var(--border-1);
  --focus-ring: var(--brand-500);
}
```

---

### 第 2 层：Zustand Store

```ts
// src/store/useAppStore.ts
interface AppStore {
  wsState: WebSocketState;
  sessionId: string | null;
  connectionError: string | null;
  appStatus: AppStatus;
  transcription: TranscriptionState;
  debugLog: DebugEntry[];
  actions: {
    setWsState: (s: WebSocketState) => void;
    setAppStatus: (s: AppStatus) => void;
    pushFinal: (r: TranscriptionResult, timestamp: number) => void;
    pushPartial: (text: string, fullText: string, speakerId?: string | null) => void;
    clear: () => void;
    dismissError: () => void;
    pushDebug: (step: string, detail: string) => void;
  };
}

export const useAppStore = create<AppStore>()(
  devtools(immer((set) => ({
    // state...
    actions: {
      pushFinal: (result, timestamp) => set(state => {
        // 整个 transcriptionReducer 逻辑移入此处
        // timestamp 由调用方注入，保持逻辑纯粹
      }),
    }
  })))
);
```

**AppLayout 修前 vs 修后：**
```tsx
// 修前：22 props + 22 行 areEqual
export const AppLayout: React.FC<AppLayoutProps> = React.memo((p) => {
  return <div>... {p.status} {p.wsState} {p.results} ...</div>
}, areAppLayoutPropsEqual);

// 修后：零 props，子组件自己订阅 store
export const AppLayout: React.FC = () => (
  <div className="app-shell">
    <AppHeader />
    <Sidebar />
    <main className="app-hero"><TranscriptHero /><CaptionBar /></main>
    <StatusBar />
    <ErrorBanner />
  </div>
);
```

---

### 第 3 层：WebSocketClient EventEmitter

```ts
// 修前：单回调
private onTranscriptionResultCallback: ((r) => void) | null = null;
onTranscriptionResult(cb): void { this.onTranscriptionResultCallback = cb; }

// 修后：EventTarget 多订阅者
export class WebSocketClient extends EventTarget {
  on<K extends keyof WSEventMap>(
    type: K,
    handler: (detail: WSEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): () => void {
    const wrapper = (e: Event) => handler((e as CustomEvent).detail);
    this.addEventListener(type, wrapper, options);
    return () => this.removeEventListener(type, wrapper);
  }
}
```

`useWebSocket` 改为暴露操作方法而非 client 对象本身：

```ts
return useMemo(() => ({
    startRecording: async () => {
        clientRef.current?.startRecording();
        await clientRef.current?.waitForRecordingReady();
    },
    stopRecording: () => clientRef.current?.stopRecording(),
    sendAudio: (buf: ArrayBuffer) => clientRef.current?.sendAudio(buf),
}), []);
```

---

## 四、优先级表

| 优先级 | 任务 | 文件 | 影响 |
|--------|------|------|------|
| **P0** | F1: 音频 gate 机制 | volcengine_session.py, app.py, WebSocketClient.ts, App.tsx | 功能完全损坏 |
| **P0** | F4: transcription_chars = 0 | app.py | 指标数据损坏 |
| **P0** | F3: 延迟计算错误 | volcengine_session.py | 指标数据损坏 |
| **P0** | Light Theme 补全 | styles.css | 视觉损坏 |
| **P1** | F2: single 模式合并冲突 | transcriptionReducer.ts, app.py | 内容重复 |
| **P1** | F5: text_buffer 双重追加 | app.py | 内容重复 |
| **P1** | F6: session_status 节流 | app.py | 性能 |
| **P1** | F7: stopRecording gate | WebSocketClient.ts, App.tsx | UX |
| **P1** | A2: reducer 副作用 | transcriptionReducer.ts | 可测试性 |
| **P1** | A6: Error Banner close | AppLayout.tsx | 功能 bug |
| **P2** | A1: Zustand store | 多文件 | 架构 |
| **P2** | A3: WebSocketClient EventEmitter | WebSocketClient.ts | 架构 |
| **P2** | A7: TranscriptHero key | TranscriptHero.tsx | 动画 |
| **P3** | Dead code 清理 | ControlPanel, ObservabilityPanel, Subtitle | 可读性 |
| **P3** | CSS Modules | styles.css + 各组件 | 工程质量 |
| **P3** | E2E 测试 selector 修复 | test_full_flow.py | 测试有效性 |

---

## 五、完成标准（Definition of Done）

**功能：**
- [ ] 开始录音后，前 5 秒内的语音可被识别（无 gate race condition）
- [ ] 停止录音后，最后一句话仍可被识别（等 recording_stopped gate）
- [ ] 延迟指标显示合理值（< 2000ms，不随会话时长线性增长）
- [ ] 转写字数统计正确（非 0）
- [ ] 同一说话人的多句话不出现内容重复

**样式：**
- [ ] `data-theme="light"` 切换后所有 Sprint 9 组件视觉正确

**架构：**
- [ ] `AppLayout` 零 props（删除 `areAppLayoutPropsEqual`）
- [ ] `transcriptionReducer` 所有 action 单测精确断言
- [ ] Error Banner 可关闭
- [ ] TypeScript `strict: true` 零报错
