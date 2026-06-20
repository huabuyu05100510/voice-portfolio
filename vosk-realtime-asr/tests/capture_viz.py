"""
Playwright 截图脚本 — Sprint 3 多模态音频可视化

策略:
  1. 打开 dist 静态页面
  2. 点击 "测试示例音频" 触发 sample 流
  3. 在 sample 播放过程中 (录制中) 截图, 此时 Visualizer 正在 rAF 绘制
  4. 等待 ~2s 后截图, 累积足够历史
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

OUT = '/Users/huabuyu/resume/语音/changes/2026-06-20-sprint-3-viz.png'
URL = 'http://localhost:4173/'


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        ctx = await browser.new_context(
            viewport={'width': 1400, 'height': 900},
            permissions=[],  # 不授予 mic
        )
        page = await ctx.new_page()

        page.on('console', lambda msg: print(f'  [{msg.type[:3]}] {msg.text[:200]}', file=sys.stderr))
        page.on('pageerror', lambda err: print(f'  [PAGE ERR] {err}', file=sys.stderr))

        print(f'-> open {URL}')
        await page.goto(URL, wait_until='networkidle', timeout=15000)
        await page.wait_for_selector('.visualizer-panel', timeout=10000)
        print('-> visualizer-panel rendered')

        # Click "测试示例音频"
        print('-> click "测试示例音频"')
        await page.click('button:has-text("测试示例音频")', timeout=5000)

        # 等 1.5s — sample 在流式播放, visualizer 在绘制
        # Sample 6s @ 50ms/chunk = 24 chunks; 我们在 ~1.5s 时已经积了 ~12 帧
        print('-> wait 1.5s for visualizer to accumulate frames')
        await asyncio.sleep(1.5)

        # 截图: 此时 status 还是 'recording' 或 'transcribing', visualizer active
        print(f'-> screenshot -> {OUT}')
        await page.screenshot(path=OUT, full_page=True)
        size = os.path.getsize(OUT)
        print(f'-> done ({size} bytes)')

        # 也截一张 visualizer 局部
        local = OUT.replace('.png', '-crop.png')
        try:
            elem = await page.query_selector('.visualizer-panel')
            if elem:
                await elem.screenshot(path=local)
                print(f'-> crop -> {local} ({os.path.getsize(local)} bytes)')
        except Exception as e:
            print(f'  crop failed: {e}')

        await browser.close()


asyncio.run(main())
