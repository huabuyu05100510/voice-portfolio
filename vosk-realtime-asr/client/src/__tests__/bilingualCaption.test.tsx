/**
 * BilingualCaption 组件测试
 *
 * 验收:
 *   - 渲染双行字幕 (source 上 / target 下)
 *   - 空态显示 fallback 文案
 *   - fontSize: 'small' | 'medium' | 'large' 影响字号 className
 *   - position: 'top' | 'middle' | 'bottom' 影响位置 className
 *   - fallbackMode=true 时只显示 source 行
 *   - rows 倒序渲染 (最新行在前)
 *   - partialSource / partialTarget 单独处理 (灰色 vs 高亮色)
 *
 * Author: MiniMax-M3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { BilingualCaption } from '../components/BilingualCaption';
import type { AlignedRow } from '../state/translationReducer';

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
});

const buildRow = (over: Partial<AlignedRow> = {}): AlignedRow => ({
  id: 'r1',
  source: '你好',
  target: 'Hello',
  timestamp: 1000,
  latencyMs: 120,
  ...over,
});

describe('BilingualCaption', () => {
  it('空态: 显示提示文案', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource=""
        partialTarget=""
        sourceLang="zh"
        targetLang="en"
      />,
    );
    const root = container.querySelector('.bilingual-caption');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('data-empty')).toBe('true');
  });

  it('fallbackMode=true: 隐藏 target 行', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="你好"
        partialTarget=""
        fallbackMode={true}
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-row-target')).toBeNull();
    // partialSource 应显示
    expect(container.querySelector('.bilingual-row-source')?.textContent).toContain('你好');
  });

  it('正常模式: 显示 partialSource 和 partialTarget 两行', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="你好世界"
        partialTarget="Hello world"
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-row-source')?.textContent).toContain('你好世界');
    expect(container.querySelector('.bilingual-row-target')?.textContent).toContain('Hello world');
  });

  it('fontSize=small → className 含 bilingual-size-small', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="x"
        partialTarget="y"
        fontSize="small"
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-caption')?.className).toMatch(/bilingual-size-small/);
  });

  it('fontSize=large → className 含 bilingual-size-large', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="x"
        partialTarget="y"
        fontSize="large"
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-caption')?.className).toMatch(/bilingual-size-large/);
  });

  it('position=top → className 含 bilingual-position-top', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="x"
        partialTarget="y"
        position="top"
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-caption')?.className).toMatch(/bilingual-position-top/);
  });

  it('position=bottom → className 含 bilingual-position-bottom', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="x"
        partialTarget="y"
        position="bottom"
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-caption')?.className).toMatch(/bilingual-position-bottom/);
  });

  it('rows 渲染: 倒序 (最新在前)', () => {
    const rows: AlignedRow[] = [
      buildRow({ id: 'old', source: '旧', target: 'old', timestamp: 1 }),
      buildRow({ id: 'new', source: '新', target: 'new', timestamp: 2 }),
    ];
    const { container } = render(
      <BilingualCaption
        rows={rows}
        partialSource=""
        partialTarget=""
        sourceLang="zh"
        targetLang="en"
      />,
    );
    const sources = Array.from(container.querySelectorAll('.bilingual-row-source'));
    // 倒序: '新' 在前, '旧' 在后
    expect(sources[0]?.textContent).toContain('新');
    expect(sources[1]?.textContent).toContain('旧');
  });

  it('rows 数量限制 maxRows (避免无限增长)', () => {
    const rows: AlignedRow[] = Array.from({ length: 100 }, (_, i) =>
      buildRow({ id: `r${i}`, source: `s${i}`, target: `t${i}`, timestamp: i }),
    );
    const { container } = render(
      <BilingualCaption
        rows={rows}
        partialSource=""
        partialTarget=""
        maxRows={5}
        sourceLang="zh"
        targetLang="en"
      />,
    );
    const sources = container.querySelectorAll('.bilingual-row-source');
    expect(sources.length).toBe(5);
  });

  it('source 行不应出现 target 文字', () => {
    const rows: AlignedRow[] = [buildRow({ source: '你好', target: 'Hello' })];
    const { container } = render(
      <BilingualCaption rows={rows} partialSource="" partialTarget="" sourceLang="zh" targetLang="en" />,
    );
    const sourceRow = container.querySelector('.bilingual-row-source');
    expect(sourceRow?.textContent).not.toContain('Hello');
  });

  it('translationConnected=false 时整体灰显', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="你好"
        partialTarget="Hello"
        translationConnected={false}
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-caption')?.getAttribute('data-translation-connected')).toBe('false');
  });

  it('fallbackMode=true 时显示"翻译离线"提示', () => {
    const { container } = render(
      <BilingualCaption
        rows={[]}
        partialSource="你好"
        partialTarget=""
        fallbackMode={true}
        sourceLang="zh"
        targetLang="en"
      />,
    );
    expect(container.querySelector('.bilingual-fallback-notice')?.textContent).toContain('离线');
  });
});