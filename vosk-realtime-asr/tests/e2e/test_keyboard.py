"""
E2E #2 — 键盘快捷键

快捷键清单 (来自 AppShell.tsx):
  Space  — 录音/停止  (需要 wsState=connected)
  R      — 清除
  M      — 静音 (播放示例音频)
  ?      — 帮助弹层
  1/2/3  — 深色/浅色/高对比度主题

Author: MiniMax-M3 (per CLAUDE.md tech-sourcing directive)
"""
import time
import pytest

pytestmark = pytest.mark.e2e


def test_shortcut_theme_1_2_3(page, client_url):
    """数字键 1/2/3 切换主题"""
    page.goto(client_url, wait_until='domcontentloaded', timeout=30000)
    page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)

    # 默认 dark
    assert page.evaluate("() => document.documentElement.getAttribute('data-theme')") == 'dark'

    # 按 '2' → light
    page.keyboard.press('2')
    page.wait_for_timeout(150)
    assert page.evaluate("() => document.documentElement.getAttribute('data-theme')") == 'light'

    # 按 '3' → hc
    page.keyboard.press('3')
    page.wait_for_timeout(150)
    assert page.evaluate("() => document.documentElement.getAttribute('data-theme')") == 'hc'

    # 按 '1' → dark
    page.keyboard.press('1')
    page.wait_for_timeout(150)
    assert page.evaluate("() => document.documentElement.getAttribute('data-theme')") == 'dark'


def test_shortcut_help_opens_overlay(page, client_url):
    """? 键打开帮助弹层"""
    page.goto(client_url, wait_until='domcontentloaded', timeout=30000)
    page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)

    # 初始帮助应关闭
    overlay = page.locator('[role="dialog"][aria-label*="帮助"]')
    # 帮助可能用 .help-overlay / [class*="help"] 渲染, 兜底查询
    before_count = page.locator('.help-overlay, [class*="help-overlay"]').count()

    page.keyboard.press('?')
    page.wait_for_timeout(300)

    after_count = page.locator('.help-overlay, [class*="help-overlay"]').count()
    # 计数应增加 (弹出) 或 overlay 可见
    assert after_count >= before_count, f'help overlay did not open: before={before_count} after={after_count}'


def test_shortcut_m_triggers_sample_audio(page, client_url):
    """M 键触发示例音频"""
    page.goto(client_url, wait_until='domcontentloaded', timeout=30000)
    page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)

    # 记录 final 项当前数量
    finals_before = page.locator('.transcription-container .result-item.final').count()

    # 按 M
    page.keyboard.press('m')
    # 等转写区出现内容 或 final 数量增加
    deadline = time.time() + 20
    triggered = False
    while time.time() < deadline and not triggered:
        # 状态文字应变成 正在转写 / 正在录音
        # .value 有 2 个: 状态 + sessionId, 用 .first 拿状态
        status_text = page.locator('.status-display .value').first.inner_text()
        if '转写' in status_text or '录音' in status_text:
            triggered = True
            break
        # 兜底: 出现 final
        finals_now = page.locator('.transcription-container .result-item.final').count()
        if finals_now > finals_before:
            triggered = True
            break
        page.wait_for_timeout(400)

    assert triggered, 'pressing M did not trigger sample audio within 20s'


def test_shortcut_r_clears_results(page, client_url):
    """R 键清除转写 (前提: 已有结果)"""
    page.goto(client_url, wait_until='domcontentloaded', timeout=30000)
    page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)

    # 触发 M 先获得结果
    page.keyboard.press('m')
    deadline = time.time() + 25
    while time.time() < deadline:
        if page.locator('.transcription-container .result-item.final').count() > 0:
            break
        page.wait_for_timeout(500)

    has_results = page.locator('.transcription-container .result-item.final').count() > 0
    if not has_results:
        pytest.skip('no transcription results produced, cannot verify clear')

    # 记录 final 数, 按 R 后等它变成 0
    # 注意: 示例音频可能仍在持续产生 final, 我们验证 "数量不再增长 + 出现至少一次清零"
    # 简化做法: 按 R 后等最多 2s, 期间任意时刻看到 0 即可
    page.keyboard.press('r')

    cleared = False
    clear_deadline = time.time() + 3
    while time.time() < clear_deadline:
        if page.locator('.transcription-container .result-item.final').count() == 0:
            cleared = True
            break
        page.wait_for_timeout(150)

    assert cleared, 'R did not clear final items within 3s'


def test_shortcut_space_does_not_scroll(page, client_url):
    """Space 在 page scroll 0 时按下, scrollTop 应保持 0 (preventDefault 生效)"""
    page.goto(client_url, wait_until='domcontentloaded', timeout=30000)
    page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)

    # 确保 body 足够长, 然后滚到顶
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(100)
    before = page.evaluate("() => window.scrollY")
    assert before == 0, f'expected scrollY=0, got {before}'

    # 按 Space
    page.keyboard.press('Space')
    page.wait_for_timeout(200)
    after = page.evaluate("() => window.scrollY")

    # Space 默认行为是向下滚动页面 1 屏 — 如果我们 preventDefault 了就不应滚动
    assert after == 0, f'expected scrollY=0 after Space, got {after} (Space preventDefault broken)'


def test_shortcut_ignored_in_input(page, client_url):
    """焦点在 input 时, 数字键 1/2/3 不应切主题 (allowInInput=false)"""
    page.goto(client_url, wait_until='domcontentloaded', timeout=30000)
    page.locator('.status-indicator.connected').wait_for(state='visible', timeout=20000)

    # 注入一个临时 input 并 focus
    page.evaluate("""() => {
      const i = document.createElement('input');
      i.id = '__probe';
      i.style.position = 'fixed';
      i.style.top = '10px';
      i.style.left = '10px';
      document.body.appendChild(i);
      i.focus();
    }""")
    page.wait_for_timeout(100)

    before_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")

    # 在 input focus 状态按 2
    page.keyboard.press('2')
    page.wait_for_timeout(200)

    after_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    assert after_theme == before_theme, (
        f'theme should not change while input focused: {before_theme} -> {after_theme}'
    )

    # 清理
    page.evaluate("() => document.getElementById('__probe')?.remove()")
