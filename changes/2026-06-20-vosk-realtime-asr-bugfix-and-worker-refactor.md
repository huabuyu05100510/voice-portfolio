# Changes — 2026-06-20

> Vosk 实时语音转写 Demo: 故障修复 + Worker 子进程改造
> 模型: Claude Opus 4.8

## 摘要

修复了上一轮交付后未跑通的全部症状, 并将 Vosk 引擎从主进程迁移到独立子进程, 加入 28 个自动化测试, 全部通过。

## 根因 → 修复

| 根因 | 文件:行 | 修复 |
|---|---|---|
| labeled Counter 调用 `._value.get()` 抛 AttributeError | `server/metrics.py:117,128` | 新增 `safe_value()` 聚合所有 label 子项 |
| Counter 带 label 但直接 `.inc()` 抛错 | `server/app.py:86` | `metrics.connections_total.labels(client_type=...).inc()` |
| `from flask_socketio import request` ImportError | `server/app.py:137,165,181,207,321,374` | 改为 `from flask import request` (顶层) |
| handler 的 `data` 参数必填, 客户端无 payload 时崩 | `server/app.py:177` | `data=None` 兜底 |
| 会话主键用 uuid 但后续 handler 用 `request.sid`, 找不到会话 | `server/app.py:134` | 统一用 `request.sid` 作为 session key |
| 合成/异常 PCM 触发 KALDI_ASSERT, 杀掉整个服务 | `server/app.py` (vosk 调用) | 迁移到 `vosk_worker.py` 子进程 |
| `multiprocessing.spawn` 重新执行 `app.py`, `start_http_server(9092)` 端口冲突 | `server/app.py:47` (顶层) | 启动逻辑抽到 `boot_app()`, 入口用 `run_server.py` + `__main__` 守卫 |
| 前端 `audioData.buffer` 类型不匹配 | `client/src/App.tsx:139` | 复制到新 ArrayBuffer |
| `metrics.totalLatencies` 可能 undefined | `client/src/ObservabilityPanel.tsx:104` | `?? 0` 兜底 |
| `result.timestamp` 可能 undefined | `client/src/TranscriptionRenderer.tsx:37` | `?? ''` 兜底 |

## 新增文件

- `server/vosk_worker.py` — Vosk 子进程, 通过 multiprocessing.Queue 与主进程通信
- `server/run_server.py` — 启动入口, `if __name__ == '__main__':` 守卫
- `client/vitest.config.ts` — 前端测试配置
- `client/src/__tests__/WebSocketClient.test.ts` — 7 个前端单测
- `tests/conftest.py` — pytest 全局 fixture + sys.path
- `tests/test_vosk_worker.py` — 4 个 worker 子进程测试
- `tests/test_ui_smoke.py` — 5 个 Vite 冒烟测试 (含 `tsc && vite build`)
- `docs/2026-06-20-vosk-realtime-asr-bugfix-and-worker-refactor.md` — 技术方案

## 重写文件

- `server/metrics.py` — 加 `safe_value()`, 修 `get_summary()`
- `server/app.py` — 拆出 `boot_app()` / `shutdown_app()`, 模块级副作用为零
- `tests/test_metrics.py` — 7 个测试
- `tests/test_websocket.py` — 9 个 E2E 测试

## 测试结果

```
21 backend tests + 7 frontend tests = 28 passed, 0 failed
```

- `python3 -m pytest tests/ -v` → 21 passed in 8.30s
- `./node_modules/.bin/vitest run` → 7 passed in 1.31s
- `npm run build` → 成功, 产物 dist/index.html + 316kB JS (gzip 101kB)

## 验证

- `curl /health` → `worker_alive: true, vosk_model_loaded: true`
- `curl /metrics/summary` → 200 OK (修复前 500)
- E2E: connect → start_recording → 16 chunks × 8000 bytes audio_data → stop_recording, `avg_latency_ms: 40.97`
- 5 个并发 SocketIO 客户端全部 connected
- Worker 子进程崩溃后, listener 线程自动 `_restart_worker()` 拉起新 worker

## 后续 (backlog)

- 切换 FunASR / 说话人分离 / 标点恢复
- 标注反馈回路
- mypy / coverage 提升
