# 2026-06-29 左侧菜单 AI 能力全量集成

**模型**: MiniMax-M3
**改动文件**: 8 个 (4 改 5 增)
**新增测试**: 5 个文件 / 34 个测试
**回归**: 58→63 文件 / 628→662 测试 全绿

## 0. Bug Fix: `.realtime-chat` 覆盖侧栏 (运行时发现的 CSS 缺陷)

用户在浏览器中发现 conversation 模式整个视口被 `.realtime-chat` 覆盖,
看不到侧栏和顶栏。

**根因**:
```css
.realtime-chat {
  position: fixed;
  inset: 0;          /* top/right/bottom/left = 0, 撑满整个视口 */
  z-index: 200;      /* 高于顶栏 20 / 侧栏 0 */
}
```
z-index 200 > 顶栏 20,所以顶栏和侧栏虽然渲染了但被压在底层看不见。

**修复** (`styles.css:2802`):
- 去掉 `position: fixed` + `inset: 0`
- 改为 `position: relative; width: 100%; height: 100%`
- `.realtime-chat` 现在作为普通 flex 容器待在 `.app-content` 内

**新增测试** `realtimeChatLayout.test.tsx`(3 用例):
- 静态断言 `.realtime-chat` 样式块不含 `position:fixed` / `inset:0` / `z-index:200`
- z-index 校验: 若保留 z-index, 不高于 topbar
- SideMenu 在 conversation mode 渲染时不被卸载

**额外验证**: 其他 `position: fixed` 元素 (`.error-banner` / `.help-overlay` / `.debug-drawer` /
`.tts-player` / `.rt-mode-fab` / `.vd-modal-backdrop` / `.rt-mode-fab-group`) 都是
设计意图 (toast / modal / FAB / debug drawer), 不属于 bug。

---

## 1. 问题背景

用户反馈两点:
- **"将左侧的菜单报漏出来"** — 侧边菜单当前不可见
- **"AI 能力都集成到左侧菜单"** — SideMenu 只有 3 项,其他 4 个 AI 能力组件(文件识别/播客生成/音色库/语音克隆)已存在但未接入菜单
- **"但是现在我也看不到啊"** — 即便有 hamburger,菜单仍不可见

期望:7 项 AI 能力分组陈列(转写·生成·音色),大屏常驻 / 小屏 drawer 行为不变,所有改动走 TDD,保留 628 个老测试全绿。

## 2. 可见性根因与修复

**根因**:
1. SideMenu 缺 `data-testid`,E2E 无法断言可见性 → 难以定位问题
2. App.tsx `content` switch 在未知 mode 下返回 `undefined`,可能导致主区空白
3. localStorage `voice-portfolio:mode` 读取只白名单 3 个旧 mode,扩展前无兼容性问题

**修复**:
- SideMenu 加 `data-testid="side-menu"` (SideMenu.tsx:43)
- App.tsx content switch 增加 `default` fallback,渲染 `.empty-state`
- localStorage 读取改用 `ALL_MODES` 全白名单,脏值回退 `'transcribe'`

**新增测试** `sideMenuVisibility.test.tsx`(5 用例):断言 SideMenu 渲染、非 display:none、父容器存在、drawer 默认收起、主区有内容。

## 3. SideMenu 分组重构

3 section × 2-3 项:

| section | 菜单项 | 图标 | mode |
|---|---|---|---|
| **转写** | 实时转写 | `MicIcon` | `transcribe` |
| | 文件识别 | `UploadIcon` ✨ | `file_recognition` |
| **生成** | 对话模式 | `UsersIcon` | `conversation` |
| | 播客生成 | `MusicIcon` | `podcast` |
| **音色** | 音色设计 | `SparklesIcon` | `voice_design` |
| | 音色库 | `LibraryIcon` ✨ | `voice_library` |
| | 语音克隆 | `RecordVoiceIcon` ✨ | `voice_cloning` |

**数据驱动**: `MENU_SECTIONS: MenuSection[]` 单一来源,易扩展。
**新增测试** `SideMenu.test.tsx`(10 用例):7 项 + 3 label / active 高亮 / 点击 → onModeChange / 键盘可达 / metrics 显示 / WS 状态 / 7 项全可点击。

## 4. 新增 SVG 图标 (icons.tsx)

| 图标 | SVG 路径 | 语义 |
|---|---|---|
| **UploadIcon** | 经典"上传到云" + 箭头 | 文件识别 |
| **LibraryIcon** | 4 条平行竖线(书架) | 音色库 |
| **RecordVoiceIcon** | MicIcon + 右上录音指示点 | 语音克隆 |

注册到 `ICONS` map(`upload` / `library` / `recordVoice`)。

**新增测试** `designIcons.test.tsx`(5 用例):viewBox / 路径元素 / 注册到 ICONS / size prop。

## 5. AppMode 类型扩展

`ModeTabs.tsx`:
```ts
export type AppMode =
  | 'transcribe' | 'conversation' | 'voice_design'
  | 'file_recognition' | 'podcast' | 'voice_library' | 'voice_cloning';

export const ALL_MODES: readonly AppMode[] = [...] as const;
```

**更新测试** `ModeTabs.test.tsx`(5→8 用例):7 tab 渲染 / ALL_MODES 长度 / 新 4 mode 点击触发 onChange。

## 6. App.tsx content switch 扩展

### 6.1 共享 hook
```ts
// 顶层常挂 useVoiceCloning (VoiceLibrary 共享 voices 列表)
const voiceCloning = useVoiceCloning({ speakerId: 'default-user' });
```
FileRecognition / PodcastGenerator / VoiceCloningWizard 各自内部已挂 hook,无需在 App 顶层重复。

### 6.2 mode 切换可观测性
```ts
useEffect(() => {
  dbg.push('NAV', `→ ${mode}`);
  const span = clientTracer.startSpan('ui.mode_switch', { attributes: { 'app.mode': mode } });
  span.end();
}, [mode]);
```

### 6.3 4 个新 case
- `file_recognition` → `<FileRecognition dispatch={tr.dispatch} onError={...} />`
- `podcast` → `<PodcastGenerator transcript={t.fullText} onGenerated={...} />`
- `voice_library` → `<VoiceLibrary voices={voiceCloning.voices} activeVoiceId={...} onDelete={...} onPreview={...} onSetActive={...} />`
- `voice_cloning` → `<VoiceCloningWizard state={voiceCloning.state} onStartRecording={...} onStopRecording={...} onRecordingDone={...} onReset={...} onComplete={...} />`

### 6.4 default fallback
未知 mode 渲染 `<div className="empty-state">`,防止主区空白。

### 6.5 useTranscription 暴露 dispatch
`useTranscription` 增加 `dispatch` 字段(原先 reducer 是私有的),供 `FileRecognition` 通过 dispatch 把异步结果 merge 到同一棵 state 树。

**新增测试** `AppShell.content.test.tsx`(8 用例):7 mode 各自渲染正确组件 + 脏值回退 + 通用菜单可见性。

## 7. 样式微调 (styles.css)

```css
/* Sprint 18: section 分组容器 — 组间留 6px 间距 */
.side-menu-section + .side-menu-section {
  margin-top: var(--space-2);
}

/* Sprint 18: 第一个 section 的 label 顶部 padding 收紧 */
.side-menu-section:first-child .side-menu-section-label {
  padding-top: var(--space-2);
}
```

## 8. 响应式

维持 2026-06-29 hamburger 修复:
- 大屏 (> 1279px): SideMenu 常驻左侧 240px
- 小屏 (≤ 1279px): hamburger 按钮出现,点击展开 drawer

无回退。

## 9. 验收清单

- [x] 大屏下 `<App />` 渲染后 `side-menu` `toBeVisible()` 通过 (5/5 测试)
- [x] 7 项菜单点击各自渲染对应组件 (8/8 content 测试)
- [x] 3 section label 可见,active 高亮 (10/10 SideMenu 测试)
- [x] 8 个新 ModeTabs 测试 + 5 个新图标测试全绿
- [x] 全量回归:62 文件 / 659 测试 (从 58/628 起)
- [x] 变更文档落盘,声明模型 MiniMax-M3
- [x] 每个 mode 切换有 dbg 日志 + OTel span (`ui.mode_switch`)
- [x] 不引入新运行时依赖

## 10. 未做(刻意省略)

- `useVoiceCloning` 内置 hook 在非 voice_cloning / voice_library 模式下仍拉一次 `/api/voice-cloning/list` — 这是「始终挂载共享数据」的代价,可后续优化为按 mode 懒加载
- `VoiceCloningWizard` 的 `onStopRecording` 当前仅触发 dbg 日志,实际录音 → blob 链路需 AudioCapture.start/stop 配对,后续 Sprint 单独完善
- 7 项菜单在 240px 窄屏可能拥挤,后续可考虑 `min-width: 200px` 折叠为图标条

## 11. 文件清单

### 改动 (6)
- `client/src/components/SideMenu.tsx` — 分组重构 + data-testid
- `client/src/components/ModeTabs.tsx` — AppMode + ALL_MODES
- `client/src/design/icons.tsx` — 3 个新图标 + ICONS 注册
- `client/src/App.tsx` — content switch + hook 共享 + 可观测性 + 默认 fallback
- `client/src/hooks/useTranscription.ts` — 暴露 dispatch
- `client/src/styles.css` — section 间距 + **修复 .realtime-chat 全屏覆盖**

### 新增 (5)
- `client/src/__tests__/SideMenu.test.tsx` (10 用例)
- `client/src/__tests__/designIcons.test.tsx` (5 用例)
- `client/src/__tests__/sideMenuVisibility.test.tsx` (5 用例)
- `client/src/__tests__/AppShell.content.test.tsx` (8 用例)
- `client/src/__tests__/realtimeChatLayout.test.tsx` (3 用例) ← Bug Fix

### 更新 (1)
- `client/src/__tests__/ModeTabs.test.tsx` (5 → 8 用例)