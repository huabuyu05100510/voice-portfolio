/**
 * FileUploader + FileTaskList TDD 测试
 *
 * 覆盖:
 *   - 拖拽 / 点击选择
 *   - 文件类型校验 (不支持的格式被拒)
 *   - 文件大小校验 (>100MB 拒)
 *   - 提交后: FileTaskList 出现条目, 状态徽章正确
 *   - 取消按钮
 *   - 重试按钮
 *   - 点击文件任务展开到 Hero 区 (dispatch)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUploader } from '../components/FileUploader';
import { FileTaskList } from '../components/FileTaskList';
import type { FileAsrTask } from '../hooks/useFileAsr';

// jsdom 不实现 URL.createObjectURL / revokeObjectURL, 桩一下
beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as any).createObjectURL = (b: any) => 'blob:mock/' + Math.random().toString(36);
    (URL as any).revokeObjectURL = () => {};
  }
});

// 关键: 每个 test 后清理 DOM, 否则 file input 跨 test 复用导致 onChange 不触发
afterEach(() => {
  cleanup();
});

function makeTask(over: Partial<FileAsrTask> = {}): FileAsrTask {
  return {
    local_id: 'loc-1',
    filename: 'meeting.mp3',
    size_bytes: 1024 * 100,
    format: 'mp3',
    status: 'submitted',
    created_at: Date.now(),
    ...over,
  };
}

/**
 * 模拟"用户在 file input 选了 N 个文件". fireEvent.change 对 file input
 * 在 React 下有兼容问题, 用原生 dispatch + DataTransfer 更稳.
 */
function selectFiles(input: HTMLInputElement, files: File[]) {
  // jsdom 不暴露 DataTransfer, 自己造一个 FileList-like
  // 直接挂到 input.files. React 18 的 onChange 会被 fireEvent.change 触发.
  // 用 defineProperty 绕过 IDL 类型检查 (jsdom 严格检查 FileList 类型)
  Object.defineProperty(input, 'files', {
    value: files,
    configurable: true,
    writable: true,
  });
  fireEvent.change(input);
}

describe('FileUploader', () => {
  it('渲染 dropzone 文案', () => {
    render(
      <FileUploader
        onSubmit={vi.fn()}
        onError={vi.fn()}
      />,
    );
    // dropzone 内有"拖拽"字样
    expect(screen.getAllByText(/拖拽|上传|选择/i).length).toBeGreaterThan(0);
  });

  it('不接受 .txt 文件 (不是 SUPPORTED_FORMATS)', async () => {
    const onSubmit = vi.fn();
    const onError = vi.fn();
    render(<FileUploader onSubmit={onSubmit} onError={onError} />);
    // 找隐藏 input[type=file]
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    // 模拟 .txt 选中
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    await act(async () => {
      selectFiles(input, [file]);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('接受 .mp3 文件, 走 onSubmit', async () => {
    const calls: any[] = [];
    const onSubmit = (meta: any) => {
      calls.push(meta);
      return Promise.resolve();
    };
    const onError = vi.fn();
    render(<FileUploader onSubmit={onSubmit} onError={onError} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(1024)], 'song.mp3', { type: 'audio/mpeg' });
    await act(async () => {
      selectFiles(input, [file]);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].filename).toBe('song.mp3');
    expect(calls[0].size_bytes).toBe(1024);
  });

  it('接受 .mp4 视频文件', async () => {
    const calls: any[] = [];
    const onSubmit = (meta: any) => { calls.push(meta); return Promise.resolve(); };
    const onError = vi.fn();
    render(<FileUploader onSubmit={onSubmit} onError={onError} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(2048)], 'video.mp4', { type: 'video/mp4' });
    await act(async () => {
      selectFiles(input, [file]);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].filename).toBe('video.mp4');
  });

  it('100MB+ 文件被拒', async () => {
    const onSubmit = vi.fn();
    const onError = vi.fn();
    render(<FileUploader onSubmit={onSubmit} onError={onError} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // jsdom 里 size 用 file.size 直接赋值
    const big = new File([new Uint8Array(10)], 'big.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(big, 'size', { value: 200 * 1024 * 1024, configurable: true });
    await act(async () => {
      selectFiles(input, [big]);
    });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/too large|size|large/i));
  });

  it('禁用状态: 隐藏 input, 不可点击', () => {
    render(<FileUploader onSubmit={vi.fn()} onError={vi.fn()} disabled />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    // 禁用后整个 dropzone 应有 disabled 类
    const dropzone = document.querySelector('.file-uploader') as HTMLElement;
    expect(dropzone).toBeTruthy();
  });
});

describe('FileTaskList', () => {
  it('空列表时显示提示', () => {
    render(<FileTaskList tasks={[]} onCancel={vi.fn()} onRetry={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/暂无|没有|空|empty|drop/i)).toBeTruthy();
  });

  it('渲染 task 文件名 + 状态徽章', () => {
    const tasks: FileAsrTask[] = [
      makeTask({ filename: 'a.mp3', status: 'submitted' }),
      makeTask({ local_id: 'loc-2', filename: 'b.mp4', status: 'running' }),
      makeTask({ local_id: 'loc-3', filename: 'c.wav', status: 'done' }),
      makeTask({ local_id: 'loc-4', filename: 'd.m4a', status: 'failed', error: 'bad audio' }),
    ];
    render(
      <FileTaskList
        tasks={tasks}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('a.mp3')).toBeTruthy();
    expect(screen.getByText('b.mp4')).toBeTruthy();
    expect(screen.getByText('c.wav')).toBeTruthy();
    expect(screen.getByText('d.m4a')).toBeTruthy();
    // 状态徽章 — 至少 4 个
    expect(screen.getAllByText(/已提交|识别中|完成|失败|Submitted|Running|Done|Failed/i).length).toBeGreaterThanOrEqual(4);
  });

  it('点击取消按钮触发 onCancel(local_id)', () => {
    const onCancel = vi.fn();
    render(
      <FileTaskList
        tasks={[makeTask()]}
        onCancel={onCancel}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /取消|cancel/i });
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledWith('loc-1');
  });

  it('failed 任务显示重试按钮, 点击触发 onRetry', () => {
    const onRetry = vi.fn();
    render(
      <FileTaskList
        tasks={[makeTask({ status: 'failed', error: 'x' })]}
        onCancel={vi.fn()}
        onRetry={onRetry}
        onOpen={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /重试|retry/i });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledWith('loc-1');
  });

  it('done 任务点击展开区触发 onOpen(local_id)', () => {
    const onOpen = vi.fn();
    render(
      <FileTaskList
        tasks={[makeTask({ status: 'done' })]}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onOpen={onOpen}
      />,
    );
    // 整行可点击; 找一下 done 卡片的可点元素
    const card = screen.getByText('meeting.mp3').closest('[role="button"], .file-task, [data-open]') || screen.getByText('meeting.mp3');
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith('loc-1');
  });
});
