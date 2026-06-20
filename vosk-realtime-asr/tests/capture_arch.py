"""
Playwright 截图脚本 — Sprint 5 架构重构回归
  - 打开 vite preview 静态页面 (端口 4173)
  - 等 DOM 稳定 (WS 会断, 但 UI 仍渲染)
  - 截全屏图, 保存到 changes/2026-06-20-sprint-5-arch.png
"""
import asyncio
import sys
from playwright.async_api import async_playwright

URL = 'http://localhost:4173/'
OUT = '/Users/huabuyu/resume/语音/changes/2026-06-20-sprint-5-arch.png'


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

        await page.screenshot(path=OUT, full_page=True)
        print(f'  saved {OUT}')
        await browser.close()
        return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))