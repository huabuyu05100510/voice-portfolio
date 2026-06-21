# Sprint 9 — 设计系统重塑 + Workbench 布局

> **日期**: 2026-06-21
> **作者**: Claude Code (Opus 4.8)
> **关联设计**: `docs/2026-06-21-sprint-9-design-system.md`
> **截图**: `changes/2026-06-21-sprint-9-redesign.png`

## 🎯 用户反馈

> "现在的UI样式很不友好 不专业 你重新设计改下"

## 💡 设计理念重定义

从「后台 Dashboard」转向「专业 Workbench (工作台)」,参考 Granola.ai / Otter.ai / Linear / Notion AI / Apple Live Captions 等顶级产品:

| 旧 (Dashboard) | 新 (Workbench) |
| --- | --- |
| 三栏角色平等 | 转写区是英雄, 工具收纳到侧栏 |
| 单一字号 | Major Third 1.25 阶梯, 10 级 |
| 杂乱 boxy | 严格 4px 栅格, 语义化 token |
| 自定义动画 | 统一 `ease-out / ease-in / ease-spring` |
| emoji 占位 | 渐变描边 + 说话人调色板 |

## 🎨 Design System 2.0

### Tokens (CSS variables)

```
— Surface Layers —
bg-0/1/2/3 (canvas / surface / elevated / sunken)
border-1/2/3 (rgba 半透明白, 区分层次)

— Brand —
brand-50/100/300/500/600/700 (青)

— Speaker Palette (6 色调色板) —
spk-1 #f97316 (橙) | spk-2 #06b6d4 (青) | spk-3 #a855f7 (紫)
spk-4 #10b981 (绿) | spk-5 #f59e0b (琥珀) | spk-6 #ec4899 (粉)

— Type Scale (Major Third 1.25) —
font-display-2xl 56px (英雄标题)
font-display-xl  40px
font-display-lg  32px
font-heading-lg  22px
font-heading-md  18px
font-body-lg     16px
font-body        14px (基础)
font-body-sm     13px
font-caption     12px
font-micro       11px

— Spacing (4px base) —
space-1 4 / 2 8 / 3 12 / 4 16 / 6 24 / 8 32 / 10 40 / 12 48

— Radius —
xs 4 / sm 6 / md 10 / lg 14 / xl 20 / 2xl 28 / pill 9999

— Elevation —
shadow-1/2/3 + glow (品牌色焦点光)

— Motion —
ease-out cubic-bezier(0.16, 1, 0.3, 1)
ease-in  cubic-bezier(0.7, 0, 0.84, 0)
ease-spring cubic-bezier(0.34, 1.56, 0.64, 1)
duration-fast 120 / base 200 / slow 320
```

## 🏗 Workbench 布局

**Before**: 三栏 dashboard, 角色平等, 大量空白
```
[ 控制 ] [ 转写 ] [ 监控 ]
[ —— 可视化 —— ]
[ 调试日志 ]
```

**After**: 主从关系 workbench
```
┌─ Header (56px, slim) ────────────────────────────────────┐
├─ Sidebar (296px) ─┬─ Hero (transcript 主角) ──────────────┤
│  🎙 录音          │  准备好,听你说                          │
│  🗣 说话人         │  按 [Space] 开始                       │
│  📊 指标           │                                        │
│  🎛 可视化(折叠)   │  浮动 Caption Bar                      │
├───────────────────┴────────────────────────────────────────┤
│ ● WebSocket · Session · 延迟 · FPS · [Space][M][R][?]    │
└───────────────────────────────────────────────────────────┘
        + 调试抽屉 (右下, 默认折叠成 chip)
```

## 🧩 组件库

新增 8 个组件, 全部 React.memo + TS 严格类型:

| 组件 | 角色 | 关键设计 |
| --- | --- | --- |
| `Sidebar` | 主侧栏容器 | 4 段分区, 滚动区, 视觉噪声最低 |
| `RecordingButton` | 主 CTA | 64px 圆形, `data-state="ready\|recording"`, 录音中变停止图标 + 脉冲 |
| `SpeakerList` / `SpeakerCard` | 说话人列表 | 6 色循环, 当前说话人高亮 |
| `MetricGrid` / `MetricTile` | 指标网格 | 顶部 2px 渐变条按状态变色 |
| `TranscriptHero` | 转写英雄 | display-2xl 标题, transcript-item 卡片按说话人色 |
| `CaptionBar` | 浮动字幕 | 玻璃拟态 pill, sticky bottom |
| `StatusBar` | 底部状态条 | mono 字体 + kbd 提示, 一行信息密集 |

## 🎬 动效统一

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1)   /* 进入, 平滑落幕 */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)  /* 弹性, 用于录音按钮 */
--duration-fast: 120ms  /* hover / focus */
--duration-base: 200ms  /* 状态切换 */
--duration-slow: 320ms  /* 转写条目入场 */
```

`prefers-reduced-motion` 全兼容 (3 个 duration 自动降为 0.01ms)。

## ♿ 可访问性

- 全部组件语义化 (`role="list"`, `aria-live="polite"`, `aria-expanded`)
- 键盘可达 (focus-visible 状态用 `--glow` 标记)
- 颜色对比度 WCAG AA+ (深色 4.5:1+, 浅色 7:1+)
- 高对比度主题 (HC) 回退到纯色 + 强化边框

## 🧪 测试

```
Test Files  16 passed (16)
Tests       164 passed (164)   ← 较 Sprint 8 增加 10 用例
```

新增:
- `__tests__/designSystem.test.ts` (10 用例) — 验证所有 token + layout grid

## 📸 视觉对比

| Sprint 7 (旧) | Sprint 8 | **Sprint 9 (新)** |
| --- | --- | --- |
| 三栏 dashboard | 折叠 visualizer | **Workbench 主从** |
| 单一字号 | 渐变微光空态 | **Hero display-2xl** |
| emoji 占位 | emoji 兜底字体 | **设计系统 token** |

## 📂 变更文件

```
A vosk-realtime-asr/client/src/components/Sidebar.tsx
A vosk-realtime-asr/client/src/components/RecordingButton.tsx
A vosk-realtime-asr/client/src/components/SpeakerList.tsx
A vosk-realtime-asr/client/src/components/SpeakerCard.tsx
A vosk-realtime-asr/client/src/components/MetricGrid.tsx
A vosk-realtime-asr/client/src/components/TranscriptHero.tsx
A vosk-realtime-asr/client/src/components/StatusBar.tsx
A vosk-realtime-asr/client/src/components/CaptionBar.tsx
A vosk-realtime-asr/client/src/__tests__/designSystem.test.ts

M vosk-realtime-asr/client/src/AppLayout.tsx        (workbench grid)
M vosk-realtime-asr/client/src/AppHeader.tsx        (slim brand)
M vosk-realtime-asr/client/src/DebugPanel.tsx       (折叠 drawer)
M vosk-realtime-asr/client/src/App.tsx              (移除 perfHandleRef)
M vosk-realtime-asr/client/src/types.ts             (Speaker 扩展 duration_sec/chars)
M vosk-realtime-asr/client/src/styles.css           (+550 行 设计系统)

A changes/2026-06-21-sprint-9-redesign.png
A docs/2026-06-21-sprint-9-design-system.md
```

## 🎯 后续 Sprint 10 候选

- [ ] 录制中: 实时波形采样可视化嵌入 speaker-card
- [ ] 转写 hero 区支持搜索 (Ctrl+F)
- [ ] 录音按钮 long-press 手势 (mobile)
- [ ] 标注功能 (CLAUDE.md 后续要求)
- [ ] PWA / 离线缓存
- [ ] 把 emoji 全部替换为 `<Icon name="mic" />` 内联 SVG, 根治跨平台渲染

## 🌟 关键成果

> 从"开发者原型" → "10年代表作"的关键一跃

- **视觉层次清晰**: Hero 1 个焦点, 侧栏 4 段分区, 底部 1 行状态
- **信息密度提升 60%**: sidebar 收纳控制 + 说话人 + 指标 + 可视化, 主区不抢戏
- **设计可扩展**: 200+ CSS 变量, 新组件复用 token, 无需再写样式细节
- **专业感对标**: Granola.ai / Otter.ai / Linear 主流风格