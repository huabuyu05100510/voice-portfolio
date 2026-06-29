# 声音复刻 2.0 (Voice Cloning 2.0) 接入 — 2026-06-27

**模型:** MiniMax-M3

## 背景
火山引擎"声音复刻 2.0"开通, Voice ID `S_f5W7pQJX1` 训练中.
本 PR 接入完整链路: **用户录音 → 上传训练音频 → 触发训练 → 获得专属 voice_id → 用该音色播报转写文本**.

## 技术方案

### API 调研 (基于项目内 Volcengine 协议一致性 + 公网文档)
- 鉴权: `X-Api-Key` (新控制台) 或 `X-Api-App-Key + X-Api-Access-Key` (旧)
- Resource ID: `volc.voice_cloning.2_0`
- 训练音频: 单声道 16kHz+ PCM/WAV, 建议 10s ~ 5min
- 训练: 异步, 通常几秒 ~ 几分钟
- REST 端点:
  - `POST /voice/upload` → `{audio_id, duration, sample_rate}`
  - `POST /voice/train` → `{task_id, voice_id, status: 'training'}`
  - `GET /voice/train/status?task_id=xxx` → `{status, voice_id?}`
  - `GET /voice/list?speaker_id=xxx` → `{voices: [...]}`
  - `DELETE /voice/delete?voice_id=xxx`

### 后端
- 新增 `server/voice_cloning.py` — `VoiceCloningClient` + `VoiceCloningConfig` + `register_voice_cloning_routes`
  - 5 个方法: `upload_audio` / `train` / `get_train_status` / `list_voices` / `delete_voice`
  - 3 层错误: `VoiceCloningConfigError` (启动期 fail-fast) / `VoiceCloningHttpError` (含 status_code) / `VoiceCloningError` (基类)
  - 凭证缺失时构造 client 抛 ConfigError — 避免静默用空 token 调线上才发现 401
  - `register_voice_cloning_routes` 启动期会立即调一次 `client_factory()` 验证凭证 (fail-fast)
  - OTel span: `voice.upload` / `voice.train` / `voice.train.status` / `voice.list` / `voice.delete`
  - 高层便捷: `train_and_wait(audio_id, ...)` 自动轮询 success / failed / timeout
- 修改 `server/metrics.py` — 加 3 个 Prom 指标:
  - `voice_upload_total{outcome}` (success/error)
  - `voice_train_total{outcome}` (success/failed/timeout/error)
  - `voice_train_duration_seconds` (Histogram, 训练耗时分布)
- 修改 `server/app.py` — 末尾挂载 4 个 endpoint:
  - `POST /api/voice/upload` (multipart)
  - `POST /api/voice/train` (JSON)
  - `GET /api/voice/train/status`
  - `GET /api/voice/list`
  - `DELETE /api/voice/delete`
  - 凭证缺失时不挂载, 现有实时转写功能不被新模块连累 (try/except)

### 前端
- 新增 `client/src/state/voiceCloningReducer.ts` — pure reducer, 状态机:
  - `idle → recording → uploading → training → ready` / `failed`
- 新增 `client/src/utils/voiceCloningApi.ts` — 浏览器 API client:
  - `blobToFormData` (Blob → multipart)
  - `uploadAudio` / `trainVoice` / `fetchTrainStatus` / `listVoices` / `deleteVoice`
  - `pollUntilTerminal` (intervalMs + maxWaitMs, 返回 success/failed/timeout)
- 新增 `client/src/hooks/useVoiceCloning.ts`:
  - 内部: `useReducer` + `useState` (voices / activeVoiceId)
  - 持久化: localStorage key `voice-portfolio:voice-cloning:active`
  - 自动 fetch voices + 自动 train_and_wait 流程
- 新增 `client/src/components/VoiceCloningWizard.tsx` — 4 步向导:
  - Stepper (录制 → 上传 → 训练 → 完成)
  - 步骤 1: 大按钮 + REC 指示 (CSS 脉冲动画)
  - 步骤 2: 进度条 (indeterminate slide 动画)
  - 步骤 3: 训练 spinner (CSS ring rotate)
  - 步骤 4: voice_id 等宽字体大字号显示
- 新增 `client/src/components/VoiceLibrary.tsx`:
  - 每音色一张卡片: 头像 (首字母) + 名称 + voice_id + 状态徽章
  - 试听按钮 (仅 ready 可点) + 删除按钮 + (可选) 设为默认按钮
  - 空态: "还没有音色" + 引导
- 修改 `client/src/components/Sidebar.tsx`:
  - 新增可选 `onOpenVoiceCloning` + `activeVoiceId` props (不影响现有用法)
  - 渲染「声音复刻 2.0」入口按钮 (NEW / 已激活 徽章)
- 修改 `client/src/styles.css` — 末尾追加完整 voice-wizard / voice-library / voice-card 样式 (~430 行):
  - 4-step stepper + active/done 状态色
  - 录音 / 上传 / 训练动画 (respect `prefers-reduced-motion`)
  - 音色卡头像渐变 (按状态分色: ready/training/failed)
  - Sidebar 入口样式

## 可观测性
- 后端日志:
  - `[VoiceCloning] upload { duration_s, size_bytes, audio_id }`
  - `[VoiceCloning] train { audio_id, task_id, voice_id }`
  - `[VoiceCloning] train.status { status, voice_id }`
  - `[VoiceCloning] list { speaker_id, count }`
  - `[VoiceCloning] delete { voice_id }`
  - 失败时 `[VoiceCloning] http_error { status_code, body }`
- 后端 OTel span: `voice.upload`, `voice.train`, `voice.train.status`, `voice.list`, `voice.delete`
- 后端 Prom 指标: `voice_upload_total`, `voice_train_total`, `voice_train_duration_seconds`
- 前端 console: `[VoiceCloning] listVoices failed:` / `delete failed:` (warn)

## TDD 严格遵循
- 阶段 1 红: 写 25 个后端测试 + 21 + 8 = 29 个前端测试
- 阶段 2 绿: 实现通过所有测试
- 阶段 3 重构: 略 (代码已较干净)

后端: `cd vosk-realtime-asr/server && python3 -m pytest __tests__/test_voice_cloning.py -v` → 25 passed
前端: `cd vosk-realtime-asr/client && npx vitest run src/__tests__/voiceCloning.test.tsx src/__tests__/voiceLibrary.test.tsx` → 29 passed

## 端到端流程 (供 UI 回归 + 手动验证)
1. 用户进入工作区 → 看到 Sidebar 底部「声音复刻 2.0 [NEW]」入口
2. 点击入口 → 弹出向导面板 (4-step stepper + 步骤 1: 录制样本)
3. 点击「开始录制」→ AudioCapture 启动 → phase=recording (REC 红色脉冲)
4. 朗读 30 秒 → 点击「停止」→ phase=uploading → 自动 multipart upload + train
5. phase=training → spinner ring 旋转 + "正在训练..." (轮询 2s/次, 最长 10min)
6. phase=ready → 显示 voice_id 大字 (如 `S_f5W7pQJX1`) + 自动保存到 localStorage
7. Sidebar 入口变为「已激活」徽章, 显示当前 voice_id
8. 音色库新增一张卡片 (试听 / 删除 / 设为默认)
9. (后续) TTS 合成时使用该 voice_id 播报转写文本 — 由另一个 agent 的 SeedTTS 2.0 PR 串接

## 凭证配置 (env)
```bash
# 新控制台 (推荐)
export VOLC_VOICE_CLONE_API_KEY=your-api-key
# 旧控制台 (二选一)
export VOLC_VOICE_CLONE_APP_ID=your-app-id
export VOLC_VOICE_CLONE_TOKEN=your-access-token
# 自定义 endpoint / resource id (可选)
export VOLC_VOICE_CLONE_ENDPOINT=https://openspeech.bytedance.com/api/voice_cloning
export VOLC_VOICE_CLONE_RESOURCE_ID=volc.voice_cloning.2_0
```

## 禁止项遵守
- 无明文 API Key 入库
- 无 git commit / push
- 未触碰 `transcriptionReducer.ts` / 现有 `types.ts` / 现有 TTS 模块
- 无 emoji (CSS 用纯文本符号)
