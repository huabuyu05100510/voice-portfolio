# 同声传译端到端接入 + TranscriptHero key 修复

**模型:** claude-sonnet-4-6
**日期:** 2026-06-29
**状态:** ✅ 完成 + 测试全绿 (579/579)

---

## 变更摘要

### 1. TranscriptHero.tsx — 修复 AnimatePresence 幽灵卡片

**问题:** React key 包含文本前缀 `r-${idx}-${r.text?.slice(0,12)}`, 当 Path A 更新同一位置文本时 key 变化 → AnimatePresence 同时 exit 旧卡 + enter 新卡 → 视觉重影.

**修复:**
```tsx
// 旧 (不稳定)
key={`r-${idx}-${r.text?.slice(0, 12)}`}

// 新 (稳定, 位置不变则 DOM 复用)
key={`r-${idx}`}
```

### 2. 同声传译端到端接入

#### WebSocketClient.ts
新增 `getSocket(): Socket | null` 公开方法, 暴露底层 socket 实例供同传 hook 订阅 `translation_result` / `translation_error` 事件.

#### useWebSocket.ts
- 导入 `Socket` 类型
- 新增 `socket: Socket | null` state
- `client.connect()` 后同步 `setSocket(client.getSocket())`
- 返回 `socket` 字段

#### App.tsx (TranscribeMode)
- 导入 `useSimultaneousInterpretation`, `BilingualCaption`, `LanguageSelector`
- 实例化 hook: `useSimultaneousInterpretation({ socket: ws.socket, enabled: bilingualEnabled })`
- 在 `ws.onTranscription` 回调中:
  - final → `interp.onTranscriptionFinal(r, rowId)` 触发翻译请求
  - partial → `interp.onSourcePartial(r.text)` 显示灰色实时字幕
- 新增 `bilingualEnabled` state (localStorage 持久化, 默认 false)
- 渲染 `<BilingualCaption>` + `<LanguageSelector>` 节点传入 `AppLayout`
- FAB 组新增"同传 ON/OFF"切换按钮

#### styles.css
- `.rt-mode-fab-group .rt-mode-switch--active` — 高亮激活态
- `.app-bilingual-slot` — 双语字幕插槽容器

#### server/.env.example
补充 `VOLC_TRANSLATE_APP_ID`, `VOLC_TRANSLATE_TOKEN`, `VOLC_TRANSLATE_ENDPOINT`, `VOLC_TRANSLATE_RESOURCE_ID` 配置说明.

---

## 数据流

```
用户说话
  → ASR partial → interp.onSourcePartial() → BilingualCaption 灰色实时字幕
  → ASR final   → tr.pushFinal()            → TranscriptHero 历史卡片
               → interp.onTranscriptionFinal(r, rowId)
               → socket.emit('translate_text', { text, source_lang, target_lang })
               → server/translation.py → 火山引擎 volc.translate.s2t.v2
               → socket.on('translation_result')
               → translationReducer TARGET_FINAL
               → BilingualCaption 双行对齐字幕 (源 + 译文 + latency badge)
```

## 服务端配置

需要在 `vosk-realtime-asr/server/.env` 中配置:
```bash
VOLC_TRANSLATE_APP_ID=<from volcengine console>
VOLC_TRANSLATE_TOKEN=<from volcengine console>
```

未配置时服务端返回 `translation_error`, 前端 BilingualCaption 显示"翻译离线 · 仅显示源语言".

---

## 验证

```bash
cd vosk-realtime-asr/client
npx vitest run  # 579 tests / 0 失败
```

手动验证步骤:
1. 配置 `.env` → 启动后端 `python app.py`
2. 启动前端 `npm run dev`
3. 点击"同传 OFF" → 变成"同传 ON"
4. 开始录音 → 说中文
5. 主界面下方出现双语字幕: 上行中文实时滚动, 下行英文翻译 + ms 延迟
6. 点击 ⇄ 切换语言对 → 清空缓存, 新语言对立即生效
