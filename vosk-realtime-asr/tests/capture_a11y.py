"""
Playwright 截图脚本 — Sprint 4 可访问性 + 主题切换

策略:
  1. 打开 vite preview 静态页面 (端口 4567)
  2. 等 WS 连接, 等 DOM 稳定
  3. 截图 dark (默认)
  4. 按 "2" 切换 light → 截图
  5. 按 "3" 切换 hc (高对比度) → 截图
  6. 按 "?" 打开帮助弹层 → 截图
  7. 保存到 changes/2026-06-20-sprint-4-a11y.png
"""
import asyncio
import sys
from playwright.async_api import async_playwright

URL = 'http://localhost:4567/'
OUT_DIR = '/Users/huabuyu/resume/语音/changes'
MAIN_OUT = f'{OUT_DIR}/2026-06-20-sprint-4-a11y.png'


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        ctx = await browser.new_context(
            viewport={'width': 1400, 'height': 900},
            permissions=[],  # 不授予 mic
        )
        page = await ctx.new_page()
        page.on('console', lambda msg: print(f'  [{msg.type[:3]}] {msg.text[:200]}', file=sys.stderr))
        page.on('pageerror', lambda err: print(f'  [PAGE ERR] {err}', file=sys.stderr))

        await page.goto(URL, wait_until='domcontentloaded')
        # 等 WS 连接 + 状态变为 ready
        await page.wait_for_timeout(2000)

        # 1) 截 dark 默认主题
        await page.screenshot(path=f'{OUT_DIR}/2026-06-20-sprint-4-dark.png', full_page=True)

        # 2) 按 "2" 切到 light
        await page.keyboard.press('2')
        await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT_DIR}/2026-06-20-sprint-4-light.png', full_page=True)

        # 3) 按 "3" 切到 hc
        await page.keyboard.press('3')
        await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT_DIR}/2026-06-20-sprint-4-hc.png', full_page=True)

        # 4) 按 "?" 打开帮助弹层
        await page.keyboard.press('?')
        await page.wait_for_timeout(300)
        await page.screenshot(path=MAIN_OUT, full_page=False)
        print(f'  saved {MAIN_OUT}')

        # 5) 校验: 主题属性确实写到 <html>
        theme = await page.evaluate("document.documentElement.getAttribute('data-theme')")
        print(f'  final data-theme = {theme}')

        await browser.close()
        return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))