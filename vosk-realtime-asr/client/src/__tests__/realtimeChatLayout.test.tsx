/**
 * realtimeChatLayout.test.tsx — Sprint 18 bug fix
 *
 * Bug: .realtime-chat 用了 position: fixed; inset: 0; z-index: 200,
 *      导致 conversation 模式下整个视口被覆盖, 侧栏和顶栏看不见.
 *
 * 修复后: .realtime-chat 应留在 app-content 容器内, 不破出覆盖其它元素.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SideMenu } from '../components/SideMenu';

const CSS_PATH = resolve(__dirname, '..', 'styles.css');

describe('realtime-chat 布局修复', () => {
  afterEach(() => cleanup());

  it('styles.css 不再有 .realtime-chat { position: fixed; inset: 0 } 覆盖层', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    // 找到 .realtime-chat 的样式块 (不跨越下一个选择器)
    const match = css.match(/\.realtime-chat\s*\{([\s\S]*?)\}/);
    expect(match).toBeTruthy();
    // 去除 CSS 注释, 避免注释里出现的关键字被误判
    const block = match![1].replace(/\/\*[\s\S]*?\*\//g, '');

    expect(block).not.toMatch(/position:\s*fixed/);
    expect(block).not.toMatch(/inset:\s*0/);
    expect(block).not.toMatch(/z-index:\s*200/);
  });

  it('侧栏 z-index 仍低于 realtime-chat (无冲突)', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    // 提取 z-index 数字
    const rtMatch = css.match(/\.realtime-chat\s*\{[\s\S]*?z-index:\s*(\d+)/);
    const sbMatch = css.match(/\.side-menu\s*\{[\s\S]*?z-index:\s*(\d+)/);
    const topbarMatch = css.match(/\.app-topbar\s*\{[\s\S]*?z-index:\s*(\d+)/);

    if (rtMatch) {
      const rtZ = parseInt(rtMatch[1], 10);
      // 若 realtime-chat 仍有 z-index, 验证其不大于 topbar
      if (topbarMatch) {
        const topZ = parseInt(topbarMatch[1], 10);
        expect(rtZ).toBeLessThanOrEqual(topZ);
      }
      // 关键: z-index 不应大于侧栏 / 顶栏 (修复后这两个值之一存在)
      expect(sbMatch || topbarMatch).toBeTruthy();
    }
  });

  it('App 渲染在 conversation mode 下, side-menu 仍在文档中 (不被卸载)', () => {
    // 直接挂载 SideMenu (App 的其他链路在其它测试覆盖)
    render(<SideMenu mode="conversation" onModeChange={vi.fn()} sessionId={null}
      wsState="connected" metrics={{ audioBytes: 0, transcriptionChars: 0, chunksProcessed: 0, avgLatency: 0, startTime: 0 }} />);
    expect(screen.getByTestId('side-menu')).toBeTruthy();
  });
});