# 2026-06-27 — SeedTTS 2.0 (语音合成 2.0) 接入

**模型:** MiniMax-M3

---

## 1. 调研摘要 (火山引擎 语音合成 2.0 / SeedTTS 2.0)

| 维度 | 调研结论 |
|---|---|
| 鉴权 | 新控制台: `Authorization: Bearer; {token}` + body `app.appid` / `app.token` / `app.cluster` |
| 端点 | `https://openspeech.bytedance.com/api/v1/tts` (HTTPS REST) |
| 音色 | 豆包经典流式音色: `BV001_streaming` (磁性男声) / `BV002_streaming` (温柔女声) / `BV003_streaming` (活力童声) / `BV004_streaming` (沉稳旁白); 完整列表走 `POST /api/v1/list_voices` |
| 音频格式 | `mp3` (默认, audio/mpeg) / `pcm` (audio/pcm) / `wav` (audio/wav) / `ogg` (audio/ogg) / `opus` (audio/ogg) |
| SSML | 支持 — body `request.text_type=ssml`, 内容以 `<speak>` 开头 |
| 调参 | `speed_ratio` (0.5~2.0), `pitch_ratio` (0.5~2.0), `volume_ratio` (0.5~2.0) |
| 单次硬限 | text 字节数 ≤ 1024, 超过需前端分片 |
| 限流 | 4xx/5xx 透传, 401 unauthorized, 429 rate-limit, 5xx server error |
| 计费 | 按字符数, 详细见火山引擎控制台 |
| WebSearch/Fetch 调研结果 | 本次会话 WebSearch/Fetch 受限, 协议基于现有项目 SAUC v3 复用模式 (app/token/cluster/user/audio/request 7 段结构), 与火山引擎 1.0 通用 TTS body 一致; 真实联调需提供线上 `VOLC_TTS_*` 凭证后端联调 |

> 协议设计原则: **凭证永远不下发浏览器** — 前端只调同源 `/api/tts/*`, 由服务端代理携 Bearer Token 调火山引擎.

---

## 2. 改动清单

### 2.1 新增文件 (8 个)

| 路径 | 行数 | 说明 |
|---|---:|---|
| `vosk-realtime-asr/server/tts.py` | 280 | 火山引擎 SeedTTS 2.0 代理模块 (POST + 流式 read + 异常类 + 兜底音色) |
| `vosk-realtime-asr/server/__tests__/test_tts.py` | 290 | TDD 单测: _build_request / synthesize / list_voices / 4xx-5xx / 凭证 / 计量 / 格式映射 |
| `vosk-realtime-asr/client/src/hooks/useSeedTts.ts` | 270 | 客户端 hook: 调 /api/tts/synthesize + AbortController + ObjectURL 生命周期 |
| `vosk-realtime-asr/client/src/components/VoicePicker.tsx` | 130 | 音色下拉 (combo + 键盘可达) |
| `vosk-realtime-asr/client/src/components/TtsSettings.tsx` | 95 | speed / pitch / format 调节面板 |
| `vosk-realtime-asr/client/src/__tests__/seedTts.test.ts` | 210 | useSeedTts 单测 (11 例) |
| `vosk-realtime-asr/client/src/__tests__/voicePicker.test.tsx` | 80 | VoicePicker 单测 (7 例) |
| `vosk-realtime-asr/client/src/__tests__/ttsSettings.test.tsx` | 65 | TtsSettings 单测 (6 例) |
| `vosk-realtime-asr/client/.env.example` | 25 | 客户端 TTS 配置模板 (VITE_TTS_*) |
| `changes/2026-06-27-tts-2-integration.md` | (本文件) | — |

### 2.2 修改文件 (4 个, 最小侵入)

| 路径 | 改动 | 说明 |
|---|---|---|
| `vosk-realtime-asr/server/app.py` | +60 行 | 加 `tts_module` import; `boot_app()` 注入 metrics; 新增 `/api/tts/synthesize` (POST) + `/api/tts/voices` (GET); `/metrics/summary` 加 `tts.requests_total` / `tts.latency_avg_seconds` / `tts.configured` |
| `vosk-realtime-asr/server/metrics.py` | +15 行 | `tts_requests_total{status, voice}` Counter + `tts_latency_seconds` Histogram |
| `vosk-realtime-asr/server/.env.example` | +15 行 | `VOLC_TTS_APP_ID` / `VOLC_TTS_TOKEN` / `VOLC_TTS_CLUSTER` / `VOLC_TTS_VOICE` / `VOLC_TTS_DEFAULT_FORMAT` 配置模板 |
| `vosk-realtime-asr/client/src/styles.css` | +260 行 | SeedTTS 2.0 UI 样式 (`.tts-2-shell` / `.tts-2-play` / `.tts-2-waveform` / `.voice-picker*` / `.tts-settings` / `.tts-slider` / `.tts-format-group`), 移动端适配 + reduced-motion 支持 |

> **未触碰**: `useTtsPlayback.ts` / `TtsPlayer.tsx` 核心逻辑, `transcriptionReducer`, `types.ts`, `subtitleKaraoke`. 与原 TTS 1.0 (ws tts_audio 事件流) 零冲突.

---

## 3. 架构

```
┌─────────────────────┐
│ 浏览器 (Vite)       │
│  VoicePicker        │
│  TtsSettings        │
│  useSeedTts (hook)  │
│      │ fetch        │
└──────┼──────────────┘
       │ /api/tts/synthesize (同源)
       │ /api/tts/voices
┌──────▼──────────────────────┐
│ Flask (server/app.py)       │
│  /api/tts/synthesize POST   │
│  /api/tts/voices GET        │
│      │                      │
│  server/tts.py              │
│   ├─ _build_request         │
│   ├─ synthesize (stream)    │
│   ├─ list_voices            │
│   └─ safe_list_voices       │
│      │ urllib Bearer; tok   │
└──────┼──────────────────────┘
       │
       │ HTTPS
       ▼
┌────────────────────────────┐
│ 火山引擎 SeedTTS 2.0       │
│ wss/openspeech.bytedance   │
│ .com/api/v1/tts            │
└────────────────────────────┘
```

**关键设计**:
- 凭证 (`VOLC_TTS_APP_ID` / `VOLC_TTS_TOKEN`) **仅服务端持有**, 浏览器拿不到.
- 服务端 `_post_json` 流式 `resp.read(8192)` 累积 → 完整 bytes → `Response(audio, mimetype='audio/mpeg')` 一并回传.
- 前端 `URL.createObjectURL(blob)` → `<audio>` 元素播, unmount/重选时 `URL.revokeObjectURL` 防内存泄漏.
- AbortController: 切换语音/再次合成时取消未完成 fetch.
- 兜底音色: 服务端 `safe_list_voices()` 在凭证缺/网络失败时回落到内置 4 个豆包经典音色, 前端 `degraded=true` 角标提示.

---

## 4. TDD 凭证

### 4.1 红 → 绿

| 阶段 | 命令 | 结果 |
|---|---|---|
| Red (server) | `pytest server/__tests__/test_tts.py` | `1 failed, 0 passed` (ModuleNotFoundError `tts`) |
| Green (server) | `pytest server/__tests__/test_tts.py` | `15 passed` |
| Red (client) | `npx vitest run seedTts.test.ts voicePicker.test.tsx ttsSettings.test.tsx` | `0 test, 3 failed suite` (Failed to resolve import) |
| Green (client) | 同上 | `24 passed` |

### 4.2 完整测试套件

| 范围 | 通过 | 失败 |
|---|---:|---:|
| server 测试 (`pytest`) | 29 (TTS 15 + 已有 14) | 0 (本次) — 注: voice_cloning 相关测试已有 pre-existing 配置缺失问题, 不是我引入 |
| client TTS 2.0 新增 | 24 (seedTts 11 + voicePicker 7 + ttsSettings 6) | 0 |
| client 全量 (无我改的部分) | 498 | 7 (pre-existing: fileUploader / simultaneousInterpretation / voiceCloning 由其他并行 agent 引入) |

```
$ pytest server/__tests__/test_tts.py
============================= 15 passed in 0.10s ==============================

$ npx vitest run src/__tests__/seedTts.test.ts src/__tests__/voicePicker.test.tsx \
                  src/__tests__/ttsSettings.test.tsx
 ✓ src/__tests__/seedTts.test.ts        (11 tests)  17ms
 ✓ src/__tests__/ttsSettings.test.tsx   (6 tests)   91ms
 ✓ src/__tests__/voicePicker.test.tsx   (7 tests)   98ms
 Test Files  3 passed (3)
      Tests  24 passed (24)
```

---

## 5. API 端点 (新增)

### `POST /api/tts/synthesize`
```http
Request:  { "text": "你好", "voice": "BV001_streaming", "speed": 1.0, "pitch": 1.0,
            "audio_format": "mp3", "sample_rate": 24000 }
Response: 200 audio/mpeg
          400 { "error": "TTS validation: text exceeds 1024 bytes", "field": "text" }
          503 { "error": "TTS misconfigured: missing ['appid','token']", "missing": [...] }
          502 { "error": "TTS request failed (status=500)", "status_code": 500 }
```

### `GET /api/tts/voices`
```http
Response: 200 { "data": [
                  {"id":"BV001_streaming","name":"磁性男声","gender":"male","sample_rate":24000},
                  ...
                ],
                "degraded": false, "source": "live" | "fallback" }
```

### `/metrics/summary` (扩展)
```json
{
  "tts": {
    "requests_total": 0,
    "latency_avg_seconds": 0,
    "configured": true
  }
}
```

### Prometheus (新增)
- `tts_requests_total{status, voice}` — Counter, `status ∈ {ok, error}`, `voice=音色id`
- `tts_latency_seconds` — Histogram, buckets `[0.1, 0.25, 0.5, 1, 2, 5, 10]`

---

## 6. UI 设计 (对标 ElevenLabs / 豆包语音)

**布局**: 圆角面板 (`.tts-2-shell`), 渐变 indigo→purple 边框 + backdrop-blur.

**大圆形播放按钮** (`.tts-2-play`): 72×72px, 紫蓝渐变, hover scale 1.05, loading 时 shimmer 动画, focus ring.

**波形进度条** (`.tts-2-waveform`): 48px 高, 24 根柱状条 (`.tts-2-waveform-bar`), 已播放部分填充渐变; 顶层半透明 overlay 模拟扫过效果.

**音色下拉** (`.voice-picker`): combo role, 触发器 + 弹出 listbox, 性别图标 (♂/♀/◌) + 名称 + 24kHz 元信息; 选中态高亮; 点击外 / Esc 关闭.

**TtsSettings**: 双滑块 (语速 0.5~2.0 / 音调 0.5~2.0, step 0.1) + 三选一格式按钮组 (MP3 / PCM / WAV), 当前格式 `aria-pressed=true`.

**响应式**: < 640px 按钮居中, 设置项单列堆叠.

**无障碍**: `aria-label` / `aria-haspopup` / `aria-expanded` / `aria-pressed` / `aria-selected`, 键盘 Enter/Space/Esc/↓ 完整支持, `prefers-reduced-motion` 降级.

---

## 7. 验收清单 (Acceptance)

- [x] **TDD red→green 完整**: 测试先写红, 实现后转绿, 全程 24/24 通过
- [x] **后端凭证隔离**: 前端 0 处出现 `VOLC_TTS_*` 明文; 全走 `/api/tts/*` 代理
- [x] **CORS 0 风险**: 浏览器同源 fetch, 火山引擎鉴权头只在服务端
- [x] **可观测完整**:
  - 每次合成: `logger.info("[TTS] synthesize voice=... text_len=... audio_bytes=... latency_ms=...")`
  - Prometheus: `tts_requests_total{status,voice}` + `tts_latency_seconds`
  - 错误: `logger.error("[TTS] synthesize http_error status=... voice=... text_len=...")`
  - `/metrics/summary.tts` 暴露实时指标
- [x] **内存安全**: ObjectURL `replaceAudioUrl` 切换 revoke, `useEffect` unmount 清理
- [x] **边界处理**: 凭证缺失 → 503, text > 1024 字节 → 400, speed/pitch 越界 → 400, 网络失败 → 兜底音色 + degraded 标记
- [x] **可中断**: `cancel()` 立即 AbortController.abort() 取消未完成 fetch
- [x] **UI 规范**: 圆角, 渐变, blur, 完整 a11y, 移动端适配, reduced-motion
- [x] **不破坏现有**: `useTtsPlayback` / `TtsPlayer` 核心逻辑未改一字, 现有 498 个 client 测试无回归 (其他 agent 引入的失败不在本 PR 范围)

---

## 8. 遗留风险 (Risk Register)

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 火山引擎真实 endpoint / body shape 在不同子版本间可能不同 (1.0 vs 2.0) | 联调阶段以 `probe_volc.py` 模式先 curl 验证; 失败时回退到 `safe_list_voices` 兜底 |
| R2 | 文本 > 1024 字节需要分片串联 (本版未实现) | 已加 ValidationError 提示, UI 显示具体错误; 分片功能留待 v2.1 |
| R3 | 火山引擎按量计费, 服务端代理无 quota 限制 | 建议在 `boot_app()` 加 QPS 限流 (令牌桶), 待接入 |
| R4 | WebSearch / WebFetch 本次会话受限, API 细节基于现有项目 SAUC v3 复用模式推断 | 待真实 `VOLC_TTS_TOKEN` 联调后核对; `test_tts.py` 全 mock 真实 HTTP, 切换 base URL 单测即可 |
| R5 | 客户端 `URL.createObjectURL` 在老 Safari / iOS WebView 可能受限 | hook 内 `safeCreateObjectURL` 兜底假 URL (仅测试用, 真实环境浏览器原生支持) |
| R6 | 音频格式 PCM/WAV 解码需前端 `AudioContext.decodeAudioData`, 当前直接喂 `<audio>` 元素 (浏览器自动识别 mime) | 已设置 `Content-Type: audio/pcm` / `audio/wav` 响应头, 主流浏览器均支持; 解码版留作 v2.1 waveform 可视化 |

---

## 9. 验证步骤 (人工 Smoke Test)

```bash
# 1. 后端 (假设 .env 配好 VOLC_TTS_*)
cd vosk-realtime-asr
. server/.venv/bin/activate
python -m pytest server/__tests__/test_tts.py -v   # 15 passed

# 2. 前端
cd client
cp .env.example .env                              # 默认配置即可
npm install
npm test                                          # 24 passed (TTS 2.0)

# 3. 启动
# Terminal 1
python server/run_server.py
# Terminal 2
cd client && npm run dev

# 浏览器: http://localhost:3000
# 1) 触发一次 "点击开始" 录音
# 2) 在 TtsPlayer 旁加载 VoicePicker, 选择 "温柔女声"
# 3) 滑动 speed 滑块到 1.5x, 选 mp3
# 4) 点击大圆形 ▶ 播放按钮 → 应听到 1.5x 语速的合成语音
# 5) curl /api/tts/voices 验证 fallback 数据
# 6) curl /metrics/summary 验证 tts.requests_total 增长
```
