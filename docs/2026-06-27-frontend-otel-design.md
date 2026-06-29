# 模块 B — 前端 OpenTelemetry 全链路 trace 技术方案

**模型:** MiniMax-M3 (Claude Code · Opus 4.6 同级)
**日期:** 2026-06-27
**作者:** MiniMax-M3
**关联重构方案:** [refactor-plan-frontend-expert.md](./2026-06-27-refactor-plan-frontend-expert.md)

---

## 1. 目标

**"30 秒内展示完整 trace"** —— 面试现场点"开始录音"后 30 秒内，在 Jaeger UI 看到一条完整 trace：

```
user.click (root)
  └─ ws.connect
      └─ ws.send_audio × N
          └─ server.receive_audio (Flask)
              └─ volcengine.sauc (黑盒标记)
          └─ server.transcription_final
      └─ ws.transcription_result
          └─ reducer.merge_partial
              └─ render (React Profiler)
```

跨进程断链 → 必须打通 W3C traceparent。

---

## 2. 现状缺口

### 2.1 客户端
- ❌ 无 OTel / Sentry / Datadog / APM 任何依赖（`package.json` 仅 4 个依赖）
- ❌ 无全局 error 捕获（仅局部 try/catch）
- ⚠️ 自研 `useDebugLog` 仅 15 条 ring buffer + console.log
- ✅ 自研 RTT（`WebSocketClient.ts:96-102`）和 FPS（`PerfMonitor.tsx:171-175`）

### 2.2 服务端
- ❌ `server/logger.py` 的 `trace_id` 是**进程级 UUID**，与 session/请求无关
- ❌ 无 W3C traceparent 处理
- ❌ 无 W3C Trace Context 跨进程透传
- ✅ Prometheus 已就绪（`server/metrics.py` + `app.py:89`）
- ✅ `app.py` 已有 `/metrics/summary` JSON 端点

### 2.3 跨进程关联
- ❌ 完全缺失
- Socket.IO 不走 HTTP header → 需走 `auth` payload 注入 traceparent

---

## 3. 改造范围

### 3.1 客户端 B1

#### 新增依赖（`client/package.json`）

```json
"@opentelemetry/api": "^1.9.0",
"@opentelemetry/sdk-web": "^1.25.0",
"@opentelemetry/auto-instrumentations-web": "^0.45.0",
"@opentelemetry/exporter-trace-otlp-http": "^0.52.0",
"@opentelemetry/exporter-metrics-otlp-http": "^0.52.0",
"@opentelemetry/instrumentation-socket-io-client": "^0.40.0",
"@opentelemetry/instrumentation-user-interaction": "^0.40.0",
"@opentelemetry/resources": "^1.25.0",
"@opentelemetry/semantic-conventions": "^1.25.0"
```

#### 新建文件

| 文件 | 职责 |
|------|------|
| `client/src/observability/otel.ts` | WebTracerProvider 初始化 + auto-instrumentations |
| `client/src/observability/tracer.ts` | 导出 `tracer`、`traceStart/end` 工具 |
| `client/src/observability/errors.ts` | 全局 `error` / `unhandledrejection` 捕获 |
| `client/src/observability/TraceToggle.tsx` | UI 开关（demo 必备） |

#### 修改文件

| 文件 | 改动 |
|------|------|
| `client/src/index.tsx` | 顶部 `import './observability/otel'` |
| `client/src/App.tsx` | `startRecording` / `stopRecording` 包 active span |
| `client/src/WebSocketClient.ts` | `sendAudio` 包 span + `auth.traceparent` 注入；`transcription_result` 算 latency |
| `client/vite.config.ts` | 加 `/otel` 代理（dev 模式透传到后端） |

### 3.2 服务端 B2（必须改，否则跨进程断链）

#### 新增依赖（`server/requirements.txt`）

```
opentelemetry-api==1.25.0
opentelemetry-sdk==1.25.0
opentelemetry-instrumentation-flask==0.46b0
opentelemetry-instrumentation-requests==0.46b0
opentelemetry-instrumentation-websocket==0.46b0
opentelemetry-exporter-otlp-proto-http==1.25.0
```

#### 修改文件

| 文件 | 改动 |
|------|------|
| `server/app.py` | `handle_connect` 解析 `auth.traceparent` → 注入 Flask OTel middleware |
| `server/logger.py` | `StructuredLogger.__init__` 接受外部 `trace_id`；解析 traceparent |
| `server/volcengine_session.py` | 出站 span `volcengine.sauc` 包裹 WSS send/recv |

### 3.3 Jaeger 部署 B3

#### 新建 `jaeger/docker-compose.yml`

```yaml
version: '3.8'
services:
  jaeger:
    image: jaegertracing/all-in-one:1.55
    container_name: voice-portfolio-jaeger
    ports:
      - "16686:16686"   # UI
      - "4318:4318"     # OTLP HTTP
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    restart: unless-stopped
```

---

## 4. 关键技术细节

### 4.1 WebTracerProvider 初始化

```ts
// client/src/observability/otel.ts
import { WebTracerProvider } from '@opentelemetry/sdk-web';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

let provider: WebTracerProvider | null = null;
let enabled = false;

export function initObservability(opts?: { enabled?: boolean }) {
  if (provider) return;
  enabled = opts?.enabled ?? import.meta.env.DEV;
  if (!enabled) return;

  provider = new WebTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'voice-portfolio-client',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: import.meta.env.MODE,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: '/otel/v1/traces' }),
        { maxQueueSize: 100, maxExportBatchSize: 20 }
      ),
    ],
  });

  provider.register({
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-document-load': {},
        '@opentelemetry/instrumentation-user-interaction': {},
        '@opentelemetry/instrumentation-socket-io-client': { enabled: true },
        '@opentelemetry/instrumentation-fetch': {},
        '@opentelemetry/instrumentation-xml-http-request': {},
      }),
    ],
  });

  setupGlobalErrorHandlers();
}

export function setObservabilityEnabled(v: boolean) {
  enabled = v;
  if (v && !provider) initObservability({ enabled: true });
}

export function isObservabilityEnabled() { return enabled; }
```

### 4.2 traceparent 透传（Socket.IO 走 auth）

```ts
// client/src/WebSocketClient.ts (改造点)
import { trace, context, propagation } from '@opentelemetry/api';

connect() {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const traceparent = carrier['traceparent'];

  this.socket = io(this.url, {
    auth: { traceparent },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
  });
}

sendAudio(audioBuffer: ArrayBuffer) {
  const tracer = trace.getTracer('voice-portfolio-client');
  return tracer.startActiveSpan('ws.send_audio', (span) => {
    span.setAttribute('chunk.bytes', audioBuffer.byteLength);
    this.socket.emit('audio_data', audioBuffer);
    span.end();
  });
}
```

### 4.3 服务端 traceparent 提取

```python
# server/app.py (改造点)
from opentelemetry import trace
from opentelemetry.propagate import extract

@socketio.on('connect')
def handle_connect(auth=None):
    traceparent = (auth or {}).get('traceparent')
    carrier = {'traceparent': traceparent} if traceparent else {}
    ctx = extract(carrier)

    with trace.use_span(trace.get_current_span(ctx), end_on_exit=False):
        # 创建 logger 时注入 trace_id
        ...
```

### 4.4 全局 error 捕获

```ts
// client/src/observability/errors.ts
import { trace } from '@opentelemetry/api';

export function setupGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    const span = trace.getActiveSpan();
    span?.recordException(e.error ?? e.message);
    span?.setStatus({ code: 2, message: String(e.message) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const span = trace.getActiveSpan();
    span?.recordException(e.reason);
    span?.setStatus({ code: 2, message: String(e.reason) });
  });
}
```

---

## 5. TDD 拆分

### 5.1 红

#### `__tests__/otel.test.ts`

```ts
import { initObservability, setObservabilityEnabled } from '../observability/otel';

describe('initObservability', () => {
  it('initializes tracer when enabled', () => {
    setObservabilityEnabled(true);
    initObservability();
    const { trace } = require('@opentelemetry/api');
    expect(trace.getTracer('test')).toBeDefined();
  });

  it('no-ops when disabled', () => {
    setObservabilityEnabled(false);
    initObservability();
    // 应为 no-op
  });
});
```

#### `__tests__/WebSocketClient.trace.test.ts`

```ts
it('injects traceparent into connect auth', () => {
  const ws = new WebSocketClient('http://test');
  ws.connect();
  // mock socket.io 验证 auth.traceparent 存在
});

it('sendAudio creates span with chunk.bytes', () => {
  const ws = new WebSocketClient('http://test');
  ws.connect();
  ws.sendAudio(new ArrayBuffer(1024));
  // 验证 span 已创建且 attribute 正确
});
```

#### `server/__tests__/test_traceparent.py`

```python
def test_handle_connect_extracts_traceparent():
    # mock socketio connect with auth={'traceparent': '00-...-...-01'}
    # 验证 session 中 trace_id 正确
    ...

def test_logger_inherits_trace_id():
    # 验证 logger 日志含正确 trace_id（来自 connect 阶段注入）
    ...
```

### 5.2 绿
按上述"关键技术细节"实施。

### 5.3 回归

```bash
# 客户端
cd vosk-realtime-asr/client
npm test -- --run

# 服务端
cd vosk-realtime-asr/server
pytest __tests__/

# 新增 e2e
npm test -- e2eTraceEnd2End --run
```

---

## 6. 关键风险与对策

| 风险 | 对策 |
|------|------|
| **OTel Web SDK bundle size ~150KB** | 动态 `import('./observability/otel')` + `TraceToggle` 默认关闭 |
| **Socket.IO 不走 HTTP header** | 通过 `auth` payload 注入 traceparent（行业通行做法） |
| **火山引擎黑盒（内部不可见）** | 仅标 `client → server → volcengine 出站 span`，标注黑盒边界（不修改服务端 volcengine 内部） |
| **生产噪声** | `parentbased_traceidratio(0.05)` + error 全采样（用 `ParentBasedSampler` + `TraceIdRatioBasedSampler`） |
| **Source map** | Vite build 已开 `sourcemap: true`（`vite.config.ts:33`），Jaeger 直接对接 |
| **OTLP 端点 CORS** | dev 用 Vite proxy `/otel` → 后端；prod 同源 |
| **批量导出丢 span** | `BatchSpanProcessor({ maxQueueSize: 100, maxExportBatchSize: 20 })` + shutdown hook |

---

## 7. 验证（端到端）

### 7.1 一键启动

```bash
# Jaeger
cd jaeger && docker compose up -d

# 后端
cd vosk-realtime-asr/server && python app.py

# 前端
cd vosk-realtime-asr/client && npm run dev
```

### 7.2 手动 30 秒演示

1. 浏览器开 `http://localhost:5173`（前端） + `http://localhost:16686`（Jaeger）并排
2. 前端 TraceToggle 开关拨到 ON
3. 点录制 → 说话 5s → 停
4. 切到 Jaeger → 选 service=`voice-portfolio-client` → Find Traces
5. 应看到完整 trace 树，含 `user.click → ws.send_audio × N → server.* → volcengine.sauc → ws.transcription_result → reducer.merge_partial`

### 7.3 自动化验证

```bash
curl http://localhost:16686/api/services  # 应含 voice-portfolio-client

npm test -- otel --run
npm test -- e2eTraceEnd2End --run
pytest server/__tests__/test_traceparent.py -v
```

---

## 8. 验收清单

- [ ] 客户端 OTel SDK 安装 + 初始化无报错
- [ ] 4 个新增测试文件全绿
- [ ] 服务端 traceparent 提取 + logger 注入绿
- [ ] 跨进程 trace 在 Jaeger UI 中可视化（手动验证）
- [ ] 全局 error 捕获生效（手动触发 unhandledrejection 看 trace）
- [ ] TraceToggle UI 开关可用（关闭后无网络请求）
- [ ] bundle size 影响 ≤ +150KB（gzip 后）
- [ ] 现有 22 个 vitest + 4 个 pytest 无回归
- [ ] `__tests__/e2eTraceEnd2End.test.ts` 截图归档

---

**变更日志**

| 日期 | 版本 | 作者 | 内容 |
|------|------|------|------|
| 2026-06-27 | v1.0 | MiniMax-M3 | 初版前端 OTel 技术方案 |