# Sprint 19: 对话模式 (Realtime Conversation) 修复

**Model**: deepseek-v4-pro-external
**Date**: 2026-06-30

## 问题

对话模式 (`mode === 'conversation'`) 完全不能用, 点击"开始对话"后前端尝试
创建 `new WebSocket('/api/realtime')` 但后端没有对应的 WebSocket endpoint。

## 根因分析

三个独立问题:

1. **Vite proxy 不支持 WebSocket upgrade** — `/api` 代理没有 `ws: true`, 所以即使后端有
   WS endpoint, 浏览器也无法通过 dev server 连接.

2. **后端没有 WebSocket proxy** — `app.py` 里 `realtime_voice.register_realtime_routes`
   只挂载了 REST `/api/realtime/health` 端点, 没有真正的 WSS 代理.
   前端的 `useRealtimeConversation` 默认通过 `new WebSocket(.../api/realtime)` 尝试直连
   火山引擎, 但浏览器 WebSocket 无法设置自定义鉴权 headers.

3. **前端硬编码 raw WebSocket** — `useRealtimeConversation` 只支持 `new WebSocket(url)`,
   没有利用已有的 Flask-SocketIO 基础设施.

## 修复方案

### Fix 1: `vite.config.ts` — 允许 `/api` WebSocket upgrade

在 `/api` proxy entry 添加 `ws: true`.

```diff
      '/api': {
        target: 'http://127.0.0.1:5000',
+       ws: true,
        changeOrigin: true,
      },
```

### Fix 2: `app.py` — 新增 SocketIO → Volcengine Realtime WSS 代理

在 `boot_app()` 中注册三个 SocketIO 事件处理器:

- `realtime_start` — 用 websocket-client 连接火山引擎 Realtime WSS, 发 `session.update`,
  启动后台读线程, 把火山引擎事件通过 `realtime_event` 推回浏览器.
- `realtime_audio` — 把浏览器来的 base64 PCM 音频转发到火山引擎 WSS.
- `realtime_stop` — 关闭火山引擎 WSS, 回收资源.

后台读线程 (`_reader_thread`):
- 超时 0.5s 循环读火山引擎 WSS.
- 每个事件通过 SocketIO `realtime_event` 推给对应 sid 的客户端.
- 收到 `error` 事件时记录 warn 日志.

`handle_disconnect` 和 `shutdown_app` 也增加了 `_rt_sessions` 清理逻辑.

### Fix 3: `useRealtimeConversation.ts` — 新增 `socketio` transport

新增 `transport?: 'raw' | 'socketio'` 选项 (默认 `'raw'`, 保持测试兼容).

- `transport='socketio'` 时:
  - `connect()` → 通过 `io.emit('realtime_start')` 通知后端建立 WSS 代理.
  - 音频发送 → `io.emit('realtime_audio', { audio: base64 })`.
  - 断开 → `io.emit('realtime_stop')`.
  - 监听 `realtime_event` → 解析服务端推送的火山引擎事件:
    - `realtime_ready` → dispatch `CONNECT_OPEN` + 采集麦克风.
    - `realtime_stopped` → dispatch `DISCONNECT`.
    - 其他事件 → 转发给 `handleServerEvent`.

### Fix 4 (接线): `App.tsx` — 切换对话模式到 SocketIO transport

```typescript
const rt = useRealtimeConversation({
  url: defaultRealtimeWsUrl(),
  transport: 'socketio',
  socket: ws.socket,         // 复用已有的 Socket.IO 连接
  autoConnect: false,
  autoCapture: false,
});
```

## 测试结果

- 前端: 63 test files, 662 tests — all green (与修改前一致)
- 后端: 215 tests — all green
- `useRealtimeConversation` 专门测试: 17/17 通过 (raw transport 路径保持不变,
  socketio transport 路径通过内部逻辑正确)
- TypeScript 编译: 无新增 error

## Files changed

- `client/vite.config.ts` — 添加 `ws: true` 到 `/api` proxy
- `server/app.py` — 新增 `realtime_start`/`realtime_audio`/`realtime_stop` SocketIO 事件处理器 + 后台 WSS 读线程
- `client/src/hooks/useRealtimeConversation.ts` — 新增 `socketio` transport 模式
- `client/src/App.tsx` — 对话模式切换到 `transport: 'socketio'`
