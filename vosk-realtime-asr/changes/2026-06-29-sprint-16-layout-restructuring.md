# Sprint 16: UI 布局重构 — 从工具台到产品级 UX

**Model: Claude Opus 4.6 | Date: 2026-06-29**

## Summary

将"工作台"布局重构为产品级 UX，对标 Google Meet / Zoom / Otter.ai 的实时音频产品布局。

核心改动：
- **Header(56px) → TopBar(48px)**：录音按钮、模式切换、TTS/同传/导出/主题全部进顶栏
- **左 Sidebar(296px) → 右 Panel(320px, 可折叠)**：左栏 23% 视口还给转写内容
- **FAB 按钮组移除**：模式切换从 fixed 右下角 → TopBar Tab 导航
- **所有 fixed 定位移除**：TtsPlayer/ErrorBanner/DebugPanel 全部进 Grid
- **14 处 emoji → SVG 图标**：补 8 个新图标，全部 emoji 归零

## 新增文件

| 文件 | 说明 |
|------|------|
| `client/src/AppLayoutV2.tsx` | 新 Grid 布局，TopBar + Main + BottomBar |
| `client/src/components/TopBar.tsx` | 顶栏组件（品牌+录音+Tab+操作） |
| `client/src/components/TopBarActions.tsx` | 顶栏操作按钮组（TTS/同传/导出/主题） |
| `client/src/components/ModeTabs.tsx` | 三 Tab 模式切换（转写/对话/音色） |
| `client/src/components/RightPanel.tsx` | 右侧可折叠 Tab 面板（说话人/工具/监控） |
| `client/src/__tests__/ModeTabs.test.tsx` | 5 tests |
| `client/src/__tests__/TopBarActions.test.tsx` | 11 tests |
| `client/src/__tests__/RightPanel.test.tsx` | 8 tests |

## 修改文件

| 文件 | 改动 |
|------|------|
| `client/src/App.tsx` | TranscribeMode → AppLayoutV2，移除 TtsPlayer/FAB 浮动元素 |
| `client/src/design/icons.tsx` | +8 SVG 图标（Volume2/VolumeX/Languages/Bug/Music/SkipForward/PanelRight/PanelRightClose） |
| `client/src/styles.css` | +360 行新 Grid/组件 CSS（.app-shell--v2, .app-topbar, .right-panel, .notification-strip, .empty-state 等） |
| `client/src/components/RecordingButton.tsx` | +variant prop ('pill'/'hero') |
| `client/src/components/TranscriptHero.tsx` | +emptyStateSlot, +children slot, emoji→CopyIcon |
| `client/src/components/TtsPlayer.tsx` | emoji→SVG icons (Volume2/VolumeX/SkipForward) |
| `client/src/DebugPanel.tsx` | emoji→BugIcon, chevron→ChevronDown/RightIcon |

## 测试结果

```
client: 628 tests passed (58 files)
server: 215 tests passed
build:  vite build success (92KB CSS + 435KB JS)
```

## 待后续清理（低优先级）

- 删除废弃 `AppHeader.tsx`、`Sidebar.tsx`（ConversationMode/VoiceDesignMode 仍引用旧 AppLayout）
- 删除旧 CSS `.app-shell .app-sidebar`、`.sidebar-section*`、`.rt-mode-fab-group`、`.rt-mode-switch`
- ConversationMode/VoiceDesignMode 迁移到新布局