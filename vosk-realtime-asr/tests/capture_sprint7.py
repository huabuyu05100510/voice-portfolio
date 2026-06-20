"""
Playwright 截图脚本 — Sprint 7 性能优化 + 文档整合回归
  - 打开 vite preview 静态页面 (端口 4173)
  - 等 DOM 稳定 (WS 会断, 但 UI 仍渲染)
  - 截全屏图, 保存到 changes/2026-06-20-sprint-7-final.png
"""
import asyncio
import sys
from playwright.async_api import async_playwright

URL = 'http://localhost:4173/'
OUT = '/Users/huabuyu/resume/语音/changes/2026-06-20-sprint-7-final.png'


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        ctx = await browser.new_context(
            viewport={'width': 1400, 'height': 900},
            permissions=[],
        )
        page = await ctx.new_page()
        page.on('console', lambda msg: print(f'  [{msg.type[:3]}] {msg.text[:200]}', file=sys.stderr))
        page.on('pageerror', lambda err: print(f'  [PAGE ERR] {err}', file=sys.stderr))

        await page.goto(URL, wait_until='domcontentloaded')
        await page.wait_for_timeout(2500)

        # 校验 App 已挂载 — 找 header 标题
        title = await page.evaluate("document.querySelector('h1')?.textContent || ''")
        print(f'  h1 = {title}', file=sys.stderr)

        # 校验 hooks 接管后, 控件按钮还都存在
        button_count = await page.evaluate("document.querySelectorAll('button').length")
        print(f'  buttons = {button_count}', file=sys.stderr)

        # Sprint 7 新增校验: 校验 PerfMonitor toggle 按钮存在 (性能面板入口)
        perf_toggle = await page.evaluate(
            "document.querySelector('[data-perf-toggle]') ? 'ok' : 'missing'"
        )
        print(f'  perf-toggle = {perf_toggle}', file=sys.stderr)

        # 校验 visualizer panel
        viz_present = await page.evaluate(
            "document.querySelector('.visualizer-panel') ? 'ok' : 'missing'"
        )
        print(f'  visualizer = {viz_present}', file=sys.stderr)

        # 校验 subtitle overlay
        subtitle_present = await page.evaluate(
            "document.querySelector('.subtitle-overlay') ? 'ok' : 'missing'"
        )
        print(f'  subtitle = {subtitle_present}', file=sys.stderr)

        # 测量 DOM size (Sprint 7 性能优化可见性: React.memo 后 DOM 节点稳定)
        dom_size = await page.evaluate("document.querySelectorAll('*').length")
        print(f'  dom size = {dom_size}', file=sys.stderr)

        await page.screenshot(path=OUT, full_page=True)
        print(f'  saved {OUT}')
        await browser.close()
        return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
