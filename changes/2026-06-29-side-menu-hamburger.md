# 2026-06-29 侧边菜单响应式修复

## 问题
- SideMenu 在屏幕宽度 <= 1279px 时被 `display: none` 完全隐藏
- 没有任何替代导航入口 (无 hamburger、无 drawer、无底部栏)
- 用户在小屏幕/非全屏窗口/DevTools 打开时无法切换模式

## 修复内容

### 1. icons.tsx — 新增 MenuIcon (hamburger)
- 标准三横线图标, 24x24 viewBox

### 2. TopBar.tsx — 新增 hamburger 按钮
- 新增 `onMenuToggle?: () => void` prop
- 左侧新增 `.app-topbar-menu-btn` 按钮，大屏幕隐藏，小屏幕显示

### 3. AppLayoutV2.tsx — 新增 menuOpen 状态
- 新增 `menuOpen` state 控制移动端抽屉
- `data-menu-open` 属性传递给 `.app-body`
- 点击菜单项后自动关闭 drawer (`setMenuOpen(false)`)
- 新增 `.side-menu-overlay` 遮罩层, 点击关闭

### 4. styles.css — 重写响应式断点
- 新增 `.app-topbar-menu-btn` 样式 (大屏 `display:none`, 小屏 `inline-flex`)
- 新增 `.side-menu-overlay` 样式
- <= 1279px: SideMenu 从 `display:none` 改为 `position:fixed` + `translateX(-100%)` drawer
- 通过 `[data-menu-open="true"]` 控制抽屉滑入 + overlay 显示

## 表现
- 大屏 (> 1279px): 行为和之前完全一样, hamburger 隐藏
- 小屏 (<= 1279px): hamburger 出现, 点击展开左侧抽屉菜单, 点击遮罩或菜单项关闭
- 58 测试文件 628 测试全部通过