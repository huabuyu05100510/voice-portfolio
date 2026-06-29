**模型:** MiniMax-M3

# 音色设计 (Voice Design / TTS Voice Customization) 接入 — 改动记录

> Date: 2026-06-27
> Author: voice-portfolio agent (MiniMax-M3)
> Sprint: 14
> 凭证已迁移: `~/.voice-portfolio-secrets/`

## 目标

让用户在前端可视化地调节音色参数 (性别/年龄/情感/风格/语速/音调/音量) + 输入文本,
由火山引擎音色设计 API 生成新声音, 试听后一键保存为自定义 voice_id。

## 调研结论 (受沙箱网络限制, 部分假设基于 v1/v3 SAUC 协议文档经验)

火山引擎"音色设计"端点推测:
- `POST https://openspeech.bytedance.com/api/v1/tts/voice_design`
- 请求 JSON: `{ app: { appid, token, cluster }, request: { reqid, text, format, sample_rate, voice_config: { gender, age, emotion, style, speed, pitch, volume, voice_id } } }`
- 响应: `{ code, message, data: { audio (base64), duration, sample_rate } }`
- 鉴权: `X-Api-Key` (新控制台) 或 `X-Api-App-Key + X-Api-Access-Key` (旧)
- 保存音色: 配套 `voice_save` 端点, 注册生成的 sample_audio 为用户自定义 voice_id

字段限制 (基于官方文档通用约定):
- text: ≤ 300 字
- speed: 0.5 ~ 2.0
- pitch: 0.5 ~ 2.0
- volume: 0 ~ 10

## 后端实现

### 新增模块

**`server/voice_design.py`** (~530 行)
- 协议常量: `VALID_GENDERS`, `VALID_AGES`, `VALID_EMOTIONS`, `VALID_STYLES`, `SPEED_RANGE`, `PITCH_RANGE`, `VOLUME_RANGE`, `TEXT_MAX_LEN`
- 内置 `PRESETS` (6 个): 新闻播报 / 温柔女声 / 磁性男声 / 儿童 / 活力青年 / 成熟男声新闻
- 纯函数: `validate_params`, `apply_defaults`, `build_request_payload`, `parse_upstream_response`, `build_auth_headers`
- HTTP 调用: `call_voice_design_api`, `_do_save` (lazy `requests` 导入, 未装时不破坏单测)
- Flask 装饰器: `require_credentials` (503), `validate_request` (400), `validate_save_request` (400)
- 路由注册: `register_voice_design_routes(app, logger, metrics)` 暴露:
  - `POST /api/voice-design/generate`
  - `POST /api/voice-design/save`
  - `GET  /api/voice-design/presets`
  - `GET  /api/voice-design/seed-voices`

### 修改

- **`server/config.py`**: 加 `VOLC_VOICE_DESIGN_APP_ID`, `VOLC_VOICE_DESIGN_TOKEN`, `VOLC_VOICE_DESIGN_ENDPOINT`, `VOLC_VOICE_DESIGN_CLUSTER`
- **`server/app.py`** (`boot_app`): 在初始化时调用 `voice_design.register_voice_design_routes(app, logger, metrics)`; 凭证注入到 `app.config['VOICE_DESIGN_*']` 供装饰器读取
- **`server/metrics.py`**: 加 Prometheus 指标:
  - `voice_design_generated_total{status}`
  - `voice_design_saved_total{status}`
  - `voice_design_latency_ms` (Histogram)

### 测试

**`server/__tests__/test_voice_design.py`** — 39 个测试, 全部 PASS
覆盖:
- 枚举 / 范围常量 (gender/age/emotion/style/speed/pitch/volume/text)
- `validate_params` 全部分支 (缺字段 / 越界 / 非法枚举 / 文本过长)
- `apply_defaults` 默认填充 vs 用户输入优先级
- `build_request_payload` JSON 结构 (app 块 / request 块 / voice_config)
- `parse_upstream_response` 成功 + 错误路径 + 缺 audio
- `PRESETS` 数据完整性 + 唯一 id + 数量 ≥ 4 + 按 id 查询
- Flask `test_client` 集成:
  - `POST /api/voice-design/generate` 缺 text / 非法 gender / 合法 三类
  - `POST /api/voice-design/save` 缺 voice_name / 缺 sample_audio / 合法
  - 凭证缺失 → 503
  - `GET /api/voice-design/presets` 返回列表

## 前端实现

### 新增

**`client/src/hooks/useVoiceDesign.ts`** (~340 行)
- 类型: `Gender`, `Age`, `Emotion`, `Style`, `VoiceParams`, `VoicePreset`, `VoiceDesignResult`, `VoiceSaveResult`, `SeedVoice`
- 常量: `GENDERS`, `AGES`, `EMOTIONS`, `STYLES`, `SPEED_RANGE`, `PITCH_RANGE`, `VOLUME_RANGE`, `TEXT_MAX_LEN`, `DEFAULT_VOICE_PARAMS`, `PRESETS` (与服务端同步)
- 客户端校验: `validateClientSide`
- Hook `useVoiceDesign`: 单参状态 + `updateParam` / `reset` / `applyPreset` / `generate` / `saveVoice` / `loadPresets` / `loadSeedVoices` + isGenerating / isSaving / lastResult / savedVoiceId / error
- 客户端保护: inFlightRef 防止重复点击; fetch 异常统一落到 error state

**`client/src/components/VoiceDesigner.tsx`** (~370 行)
- 左右双栏 + 中间 (实际是 320px | 1fr | 460px 三栏, 1024px 以下叠成单列)
- 左栏: 预设卡片 + 性别 radio + 年龄 chip + 情感 chip + 风格 chip + 语速 slider + 音调 slider + 音量 slider + 重置
- 中栏: 文本输入 (textarea, 实时字数 X/300) + 试听生成 + 保存音色 + 错误/成功提示
- 右栏: canvas 伪波形 + audio 控件 + 时长/采样率 meta
- 保存音色模态框: 音色名 + 描述, 成功显示 voice_id
- 键盘可达: Enter/Space 应用预设; 全部 input 有 aria-label

**`client/src/components/VoiceDesignPresets.tsx`** (~80 行)
- 6 张预设卡片, 每张: 图标 (单字 fallback) + 名称 + 描述
- 键盘 Enter/Space 触发 onApply
- 可由 props 传入 customPresets 覆盖内置

### 修改

- **`client/src/App.tsx`** (Sprint 14):
  - 加 `voice_design` 模式 (持久化到 localStorage `voice-portfolio:mode`)
  - 加 `VoiceDesignMode` 子组件: 左侧返回按钮 + 右侧 VoiceDesigner 主面板
  - `TranscribeMode` 右上角 FAB 改成"音色设计" + "对话模式"两个并列按钮
- **`client/src/styles.css`**: 末尾追加 ~480 行 Voice Designer 样式 (复用现有 token 体系), 含 slider 自定义轨道/拇指 + 预设卡片 hover + modal 动效 + 减动效支持

### 测试

**`client/src/__tests__/voiceDesign.test.ts`** — 26 个测试, 全部 PASS
覆盖:
- `DEFAULT_VOICE_PARAMS` / `PRESETS` 数据完整性
- `getPresetById` / `applyPresetToParams` 行为
- `validateClientSide` 全部分支
- Hook 状态: 默认值 / `updateParam` 双向绑定 / `reset` / `applyPreset` (含未知 id 静默失败)
- `generate` 流程: fetch mock + URL / method / body 断言 + `lastResult` / `error` 落库
- 错误路径: 400 字段校验 / 502 上游 / 网络异常
- `isGenerating` 生命周期 (React 18 batching 边界)
- `saveVoice` 流程: 缺 voice_name 拦截 + body 序列化 + voice_id 落库
- `loadPresets` / `loadSeedVoices`

**`client/src/__tests__/voiceDesigner.test.tsx`** — 17 个测试, 全部 PASS
覆盖:
- VoiceDesignPresets: 卡片数量 / 点击 / 键盘 Enter / name + description 显示
- VoiceDesigner: 渲染参数面板 / 默认值 / gender radio 双向绑定 / slider 双向绑定 / 文本框双向绑定
- 试听空文本 → 按钮 disabled 不发请求
- 试听成功 → POST generate + loading 状态 + 显示保存音色按钮
- 保存音色流程: 点击 → 弹模态框 → 缺 name 拦截 → 成功显示 voice_id
- 预设卡与面板 UI 同步 (外部 onApply)
- 生成失败 → 错误提示

## 可观测性

服务端 (server):
- `[VoiceDesign] generate` 结构化日志 (gender / age / emotion / style / speed / pitch / text_len / voice_id)
- `[VoiceDesign] save` 日志 (voice_name + audio bytes 估算)
- 事件类型: `voice_design_generate`, `voice_design_save`, `voice_design_mounted`, `voice_design_mount_failed`
- Prometheus 指标: 生成次数 + 保存次数 + 生成延迟 (Histogram)
- Flask app.config 注入 + 装饰器统一鉴权

客户端 (client):
- `[VoiceDesign] generate` console.info (含完整 params + text_len)
- `[VoiceDesign] save` console.info (voice_name)
- Hook state: `isGenerating`, `isSaving`, `lastResult`, `savedVoiceId`, `error` 全部暴露给 UI
- URL.createObjectURL 懒加载兼容 (jsdom 环境无该 API 时自动降级)

## TDD 流程记录

| 阶段 | 测试数 | 状态 |
| --- | --- | --- |
| 红: server test_voice_design.py 写入 | 39 | FAIL (ModuleNotFoundError) |
| 绿: 实现 voice_design.py | 39 | PASS |
| 红: client voiceDesign.test.ts | 26 | FAIL (cannot resolve hook) |
| 绿: 实现 useVoiceDesign hook | 26 | PASS |
| 红: client voiceDesigner.test.tsx | 17 | FAIL (component missing) |
| 绿: 实现 VoiceDesigner + VoiceDesignPresets | 17 | PASS (过程修 6 个细节: URL.createObjectURL 兼容 / htmlFor label / waitFor 内不写断言 / queryAllByText / jsdom canvas 警告) |

总: **82 个测试全 PASS** + 0 回归 (服务端: 181 passed / 5 pre-existing voice_cloning failure, 客户端: 576 passed)

## 文件清单

### 新增
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/server/voice_design.py`
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/server/__tests__/test_voice_design.py`
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/hooks/useVoiceDesign.ts`
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/components/VoiceDesigner.tsx`
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/components/VoiceDesignPresets.tsx`
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/__tests__/voiceDesign.test.ts`
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/__tests__/voiceDesigner.test.tsx`

### 修改
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/server/config.py` (加 4 个音色设计 env)
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/server/app.py` (boot_app 中挂载路由)
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/server/metrics.py` (加 3 个 Prometheus 指标)
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/App.tsx` (加 voice_design 模式 + 切换按钮)
- `/Users/didi/Downloads/前端AI面试题/voice-portfolio/vosk-realtime-asr/client/src/styles.css` (末尾追加 ~480 行样式)

## 后续 (留给其他 agent / sprint)

- OTel span: `voice_design.generate` (服务端 + 客户端)
- 上传 base64 → OSS, 返回稳定 URL (替代 audio_base64)
- 听感 AB 测试: 两个参数组合各生成一段, 投票选优
- 音色库页面: 列出用户保存的所有 voice_id, 支持删除 / 重命名
- A/B 实时切换: 试听时左右两个 slider 互相比较