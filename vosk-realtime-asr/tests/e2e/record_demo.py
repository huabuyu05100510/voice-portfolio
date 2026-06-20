"""
录 30 秒 demo 视频 — 用 Playwright video recording

脚本不依赖 pytest, 直接 python3 record_demo.py
产物: e2e/videos/<random>.webm
然后用 ffmpeg 转 vp9 压到 5MB 以下, 保存到 /Users/huabuyu/resume/语音/changes/demo-30s.webm

剧本 (30s 内):
  0-3s   打开页面 + 等连接
  3-5s   展示主题切换 (dark -> light)
  5-7s   切回 dark
  7-9s   点开 PerfMonitor 折叠面板
  9-12s  等 FPS / 延迟数字刷新
  12-14s 关闭 PerfMonitor
  14-16s 点测试示例音频
  16-26s 等转写文本 + 词级高亮出现
  26-30s 切到高对比度 + 切回 dark 收尾

Author: MiniMax-M3 (per CLAUDE.md tech-sourcing directive)
"""
import os
import sys
import time
import shutil
import subprocess
import pathlib
import tempfile

from playwright.sync_api import sync_playwright


THIS = pathlib.Path(__file__).parent.resolve()
VIDEOS_RAW = THIS / 'videos'
ARTIFACTS = THIS / 'artifacts'
VIDEOS_RAW.mkdir(parents=True, exist_ok=True)
ARTIFACTS.mkdir(parents=True, exist_ok=True)

CLIENT_URL = os.environ.get('E2E_CLIENT_URL', 'http://localhost:3001')
FINAL_DEST = pathlib.Path('/Users/huabuyu/resume/语音/changes/demo-30s.webm')
FINAL_DEST.parent.mkdir(parents=True, exist_ok=True)


def record_30s() -> pathlib.Path:
    """用 playwright 录 30s 浏览器画面"""
    out_dir = VIDEOS_RAW / f'session-{int(time.time())}'
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
        )
        context = browser.new_context(
            viewport={'width': 1280, 'height': 800},
            record_video_dir=str(out_dir),
            record_video_size={'width': 1280, 'height': 800},
            # VP9 是 chromium 默认 video codec (在 --enable-features=PlatformHEVCDecoderSupport 之前)
        )
        page = context.new_page()
        try:
            # 0-3s: 打开 + 等连接
            page.goto(CLIENT_URL, wait_until='domcontentloaded', timeout=30000)
            page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)
            page.wait_for_timeout(2500)  # 留 2.5s 让连接状态稳定

            # 3-5s: 切到浅色
            page.get_by_role('radio', name='切换到浅色主题').click()
            page.wait_for_timeout(1500)
            # 5-7s: 切回 dark
            page.get_by_role('radio', name='切换到深色主题').click()
            page.wait_for_timeout(1500)

            # 7-9s: 展开 PerfMonitor
            page.locator('[data-perf-toggle]').click()
            page.locator('[data-perf-panel]').wait_for(state='visible', timeout=5000)
            page.wait_for_timeout(1500)

            # 9-12s: 等 FPS 数字更新
            page.wait_for_timeout(2500)

            # 12-14s: 关闭 PerfMonitor
            page.locator('[data-perf-toggle]').click()
            page.wait_for_timeout(1500)

            # 14-16s: 触发示例音频
            page.get_by_role('button', name='测试示例音频 (快捷键 M)').click()
            page.wait_for_timeout(1500)

            # 16-26s: 等转写 + 词级高亮
            page.wait_for_timeout(8000)

            # 26-28s: 切到高对比度
            page.get_by_role('radio', name='切换到高对比度主题').click()
            page.wait_for_timeout(1500)

            # 28-30s: 切回 dark 收尾
            page.get_by_role('radio', name='切换到深色主题').click()
            page.wait_for_timeout(2000)

        finally:
            # 抓最后一帧
            try:
                page.screenshot(path=str(ARTIFACTS / 'demo-final-frame.png'), full_page=True)
            except Exception:
                pass
            context.close()
            browser.close()

    # 找到录的视频
    videos = list(out_dir.glob('*.webm'))
    if not videos:
        raise RuntimeError(f'no video recorded in {out_dir}')
    return videos[0]


def compress_to_target(src: pathlib.Path, dest: pathlib.Path, target_mb: float = 5.0) -> pathlib.Path:
    """用 ffmpeg 把 webm 重编码为 vp9, 控制大小 ≤ target_mb"""
    if shutil.which('ffmpeg') is None:
        # 没 ffmpeg 就直接拷贝
        shutil.copy2(src, dest)
        return dest

    # 探测原文件大小
    src_mb = src.stat().st_size / (1024 * 1024)
    print(f'[demo] raw video size: {src_mb:.2f} MB')

    if src_mb <= target_mb:
        # 已经在范围内, 直接 copy (remux)
        subprocess.run([
            'ffmpeg', '-y', '-i', str(src),
            '-c:v', 'copy', '-c:a', 'copy',
            str(dest),
        ], check=True, capture_output=True)
        return dest

    # 用 vp9 crf 压, 目标 ≤ 5MB
    # 时长 30s, 30 * 1024 * 1024 / 30s ≈ 1.0 Mbps 是上限
    # 留余量, 用 800k
    crf = 36  # vp9 crf (0-63, 越高质量越好)
    bitrate = '700k'
    for attempt in range(4):
        cmd = [
            'ffmpeg', '-y', '-i', str(src),
            '-c:v', 'libvpx-vp9',
            '-b:v', bitrate,
            '-crf', str(crf),
            '-deadline', 'realtime',
            '-cpu-used', '8',
            '-row-mt', '1',
            '-pix_fmt', 'yuv420p',
            '-an',  # 不要音频
            str(dest),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f'[demo] ffmpeg attempt {attempt} failed: {result.stderr[-500:]}')
            # 加大压缩
            crf = min(63, crf + 4)
            bitrate = str(int(int(bitrate.rstrip('k')) * 0.7)) + 'k'
            continue
        size_mb = dest.stat().st_size / (1024 * 1024)
        print(f'[demo] compressed (crf={crf}, br={bitrate}): {size_mb:.2f} MB')
        if size_mb <= target_mb:
            return dest
        # 再压一档
        crf = min(63, crf + 4)
        bitrate = str(max(200, int(int(bitrate.rstrip('k')) * 0.7))) + 'k'

    return dest


def main():
    print(f'[demo] recording 30s at {CLIENT_URL}')
    raw = record_30s()
    print(f'[demo] raw video: {raw}')

    final = compress_to_target(raw, FINAL_DEST, target_mb=5.0)
    size_mb = final.stat().st_size / (1024 * 1024)
    print(f'[demo] FINAL: {final} ({size_mb:.2f} MB)')

    if size_mb > 5.0:
        print(f'[demo] WARNING: {size_mb:.2f}MB exceeds 5MB target')
    return 0 if size_mb <= 5.0 else 1


if __name__ == '__main__':
    sys.exit(main())
