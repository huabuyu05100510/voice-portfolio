# Sprint 9 — 设计系统重塑 (Design System 2.0)

> **生成模型**: Claude Opus 4.8 (`MiniMax-M3` 平台)
> **生成时间**: 2026-06-21
> **关联实现**: `changes/2026-06-21-sprint-9-redesign.md`

---

## 一、设计哲学

> "打造10 年最有代表性的前端作品" — CLAUDE.md

参考产品级实时语音 UI 标杆 (Granola.ai / Otter.ai / Apple Live Captions / Google Recorder / Granola / Notion AI),结合 Apple WWDC / Google I/O 的发布会视觉语言,确立以下原则:

| 原则 | 含义 |
| --- | --- |
| **Live-first** | 实时转写是主角, 其他 UI 围绕它服务 |
| **Calm by default** | 默认静默优雅, 录音时才高亮 |
| **One hero, many tools** | 主工作区是英雄, 工具收纳在侧栏/底部 |
| **Information density** | 信息密度合理, 无空白焦虑 |
| **Speaker as identity** | 说话人是核心身份, 颜色 + 标签双重识别 |

---

## 二、设计语言

### 2.1 颜色系统 (Surface Layers)

```
bg-0      canvas       深色 #0a0a14  | 浅色 #fafafa
bg-1      surface      深色 #13131f  | 浅色 #ffffff
bg-2      elevated     深色 #1d1d2e  | 浅色 #f5f5f7
bg-3      sunken       深色 #050510  | 浅色 #f0f0f2
border-1  default      rgba(255,255,255,0.08) | rgba(0,0,0,0.08)
border-2  strong       rgba(255,255,255,0.16) | rgba(0,0,0,0.16)
```

### 2.2 品牌色 (Brand)

```
brand-500  #00d4ff   主品牌色 (青)
brand-600  #00a8cc   hover
brand-700  #007a99   active
brand-glow rgba(0,212,255,0.16)  阴影辉光
```

### 2.3 说话人配色 (Speaker Palette)

6 色调色板, 按 speaker index 分配:
```
spk-1  #f97316  (橙)
spk-2  #06b6d4  (青)
spk-3  #a855f7  (紫)
spk-4  #10b981  (绿)
spk-5  #f59e0b  (琥珀)
spk-6  #ec4899  (粉)
```

### 2.4 字号阶梯 (Type Scale) — Major Third 1.25

```
display-2xl  56 / 1.05 / -0.04em   英雄标题 (转写大字)
display-xl   40 / 1.1  / -0.03em   章节标题
display-lg   32 / 1.15 / -0.02em   主标题
heading-lg   22 / 1.3  / -0.01em   二级标题
heading-md   18 / 1.4  / 0         卡片标题
body-lg      16 / 1.55 / 0         正文
body         14 / 1.55 / 0         基础正文
body-sm      13 / 1.5  / 0         辅助正文
caption      12 / 1.4  / 0.02em    标注
micro        11 / 1.3  / 0.04em    极小 (badge)
```

### 2.5 间距 (Spacing) — 4px base

```
space-1   4px
space-2   8px
space-3   12px
space-4   16px
space-5   20px
space-6   24px
space-8   32px
space-10  40px
space-12  48px
space-16  64px
space-20  80px
```

### 2.6 圆角 (Radius)

```
radius-xs   4px   chip / tag
radius-sm   6px   小按钮
radius-md   10px  卡片
radius-lg   14px  模态
radius-xl   20px  hero
radius-pill 9999  徽章
```

### 2.7 阴影 (Elevation)

```
shadow-1  0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)          resting
shadow-2  0 4px 6px rgba(0,0,0,0.05), 0 10px 15px rgba(0,0,0,0.10)        hover
shadow-3  0 10px 20px rgba(0,0,0,0.08), 0 20px 40px rgba(0,0,0,0.12)      modal
glow      0 0 0 1px rgba(0,212,255,0.20), 0 0 24px rgba(0,212,255,0.24)   focus
```

### 2.8 动效曲线 (Motion)

```
ease-out        cubic-bezier(0.16, 1, 0.3, 1)    进入
ease-in         cubic-bezier(0.7, 0, 0.84, 0)    退出
ease-spring     cubic-bezier(0.34, 1.56, 0.64, 1) 弹性
duration-fast   120ms
duration-base   200ms
duration-slow   320ms
```

---

## 三、布局架构 (Layout 2.0)

### 3.1 从 Dashboard 改为 Workbench

**Before** (3-column dashboard, 角色平等):
```
[ 控制 ] [ 转写 ] [ 监控 ]
[ —— 可视化 —— ]
[ 调试日志 ]
```

**After** (Workbench, 主从关系):
```
┌─────────────────────────────────────────────────┐
│ Header (logo, session, theme, settings)         │  56px
├──────────────┬──────────────────────────────────┤
│ Sidebar      │ Hero — Live Transcript           │  flex
│ - 控制按钮   │ ┌─────────────────────────────┐  │
│ - 说话人列表 │ │  🟠 张三: 今天天气很好       │  │
│ - 监控指标   │ │  🔵 李四: 我们去公园散步     │  │
│ - 可视化     │ │                              │  │
│              │ └─────────────────────────────┘  │
│              │ ▔▔▔▔▔ 浮动 caption bar ▔▔▔▔▔     │  88px
├──────────────┴──────────────────────────────────┤
│ Status Bar (connection · session · latency)    │  36px
└─────────────────────────────────────────────────┘
```

**收益**:
- 转写区从 1/3 升到 60% 宽度 + 全高, 体验焦点集中
- 监控指标下沉到 sidebar, 不再抢戏
- 顶部 Header 精简 (去 padding 浪费)
- 底部 Status Bar 替代页脚, 信息密度提升

### 3.2 Responsive

```
≥ 1440px  三栏 (sidebar 280 / hero flex / caption)
1024-1440px  二栏 (sidebar 280 / hero + 监控内嵌 hero 右侧抽屉)
< 1024px  单栏 (sidebar 抽屉 / hero 占满)
```

---

## 四、组件级别精致化

### 4.1 Recording Button (主 CTA)

```
Before: 普通 .btn 12px padding
After:  圆形 64px, 录音中变停止图标, 内圈脉冲动画
```

### 4.2 Speaker Card (说话人块)

```
┌────────────────────────────┐
│ 🟠 张三  │ ▁▂▃▅▇▆▅▃▂  12.4s │
│ 今天天气很好我们去公园      │
└────────────────────────────┘
```

### 4.3 Metric Tile (指标块)

```
Before: 边框 + 标题大字 + 值
After:  顶部 4px 渐变条 + 数字 24px 紧凑 + 趋势 sparkline 60x16
```

### 4.4 Caption Bar (底部字幕条)

```
固定底部 88px, 圆角 20px, 玻璃拟态, 说话人徽章 + 词级高亮
```

---

## 五、动效语言

### 5.1 转写条目入场
- 从下方 12px 滑入 + opacity 0→1
- 240ms `ease-out`
- 词级高亮过渡 80ms `linear`

### 5.2 录音按钮
- idle: 微光呼吸 2.4s
- hover: scale(1.04) + glow 增强
- active: scale(0.96) + ring 动画
- recording: 红色脉冲 1s

### 5.3 说话人切换
- 头像 / 标签 scale 1.08 → 1
- 颜色 crossfade 200ms

---

## 六、风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 重新设计破坏现有数据契约 | 用 React props 接口, 不改 hooks |
| 用户已经习惯旧版 | 提供 [data-density="compact"] 属性切回旧版 |
| 性能下降 (新动效) | 全部 transform / opacity, 不触 layout |

---

## 七、Sprint 排期

| 任务 | 估时 |
| --- | --- |
| 设计 token 提取 (CSS vars + TS 类型) | 30min |
| 布局骨架重写 (AppLayout 2.0) | 60min |
| 录音按钮组件化 (RecordingButton) | 30min |
| Speaker 卡片 + 颜色体系 | 30min |
| Metric Tile + sparkline | 30min |
| Caption Bar 重新设计 | 30min |
| 动效统一 (motion utils) | 20min |
| 视觉回归 + screenshot | 20min |

总计 ~4 小时。

---

## 八、成功指标

- [ ] 视觉精致度对标 Granola.ai / Otter.ai
- [ ] 任何屏幕首屏看到 1 个焦点 (transcript), 不超载
- [ ] 154 测试全绿 (含新增设计系统测试)
- [ ] Lighthouse 可访问性 ≥ 95
- [ ] FCP < 800ms, LCP < 1.5s (本机)