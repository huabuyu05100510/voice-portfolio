/**
 * FileTaskList — 文件识别任务列表
 *
 * 显示每个任务:
 *   - 文件名 + 大小 + 格式 icon
 *   - 状态徽章 (Submitted / Running / Done / Failed)
 *   - 操作按钮: 取消 (running 中) / 重试 (failed) / 打开 (done)
 *   - 进度: running 时显示 0-100% (基于 status 字段)
 *
 * Author: MiniMax-M3 (2026-06-27)
 */
import React from 'react';
import type { FileAsrTask, FileAsrStatus } from '../hooks/useFileAsr';

export interface FileTaskListProps {
  tasks: FileAsrTask[];
  onCancel: (local_id: string) => void;
  onRetry: (local_id: string) => void;
  onOpen: (local_id: string) => void;
  /** 自定义空态文案 */
  emptyText?: string;
}

const _STATUS_LABEL: Record<FileAsrStatus, string> = {
  idle: '空闲',
  uploading: '上传中',
  submitted: '已提交',
  running: '识别中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const _STATUS_CLASS: Record<FileAsrStatus, string> = {
  idle: 'is-idle',
  uploading: 'is-uploading',
  submitted: 'is-submitted',
  running: 'is-running',
  done: 'is-done',
  failed: 'is-failed',
  cancelled: 'is-cancelled',
};

function _formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function _formatDuration(sec?: number): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const FileTaskList: React.FC<FileTaskListProps> = React.memo((p) => {
  if (p.tasks.length === 0) {
    return (
      <div className="file-task-list is-empty" role="status">
        <p>{p.emptyText || '暂无文件任务 · 拖拽音频/视频到上方开始识别'}</p>
      </div>
    );
  }
  return (
    <ul className="file-task-list" role="list" aria-label="文件识别任务列表">
      {p.tasks.map((t) => {
        const status = t.status;
        const isFinal = status === 'done' || status === 'failed' || status === 'cancelled';
        return (
          <li
            key={t.local_id}
            className={`file-task ${_STATUS_CLASS[status]}`}
            data-local-id={t.local_id}
            data-open={status === 'done' || undefined}
            role={status === 'done' ? 'button' : undefined}
            tabIndex={status === 'done' ? 0 : -1}
            onClick={(e) => {
              // 点的是按钮时不触发
              if ((e.target as HTMLElement).closest('button')) return;
              if (status === 'done') p.onOpen(t.local_id);
            }}
            onKeyDown={(e) => {
              if (status === 'done' && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                p.onOpen(t.local_id);
              }
            }}
          >
            <div className="file-task-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {status === 'done' ? (
                  <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : status === 'failed' ? (
                  <path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2-2l2 2m7 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : status === 'running' || status === 'submitted' || status === 'uploading' ? (
                  <g>
                    <circle cx="12" cy="12" r="9" strokeOpacity="0.2" />
                    <path d="M12 3a9 9 0 019 9" strokeLinecap="round" />
                  </g>
                ) : (
                  <path d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
                )}
              </svg>
            </div>
            <div className="file-task-body">
              <div className="file-task-name" title={t.filename}>
                {t.filename}
              </div>
              <div className="file-task-meta">
                <span className="file-task-size">{_formatSize(t.size_bytes)}</span>
                <span className="file-task-format">{(t.format || '?').toUpperCase()}</span>
                {t.result && (
                  <span className="file-task-count">
                    {t.result.utterances.length} 段
                  </span>
                )}
                {t.finished_at && t.created_at && (
                  <span className="file-task-elapsed">
                    {Math.round((t.finished_at - t.created_at) / 100) / 10}s
                  </span>
                )}
              </div>
              {status === 'running' && t.progress != null && (
                <div
                  className="file-task-progress"
                  role="progressbar"
                  aria-valuenow={Math.round(t.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="file-task-progress-bar"
                    style={{ width: `${Math.round(t.progress * 100)}%` }}
                  />
                </div>
              )}
              {status === 'failed' && t.error && (
                <div className="file-task-error" role="alert">
                  {t.error}
                </div>
              )}
            </div>
            <div className="file-task-status">
              <span className={`file-task-badge ${_STATUS_CLASS[status]}`}>
                {_STATUS_LABEL[status]}
              </span>
            </div>
            <div className="file-task-actions">
              {(status === 'running' || status === 'submitted' || status === 'uploading') && (
                <button
                  type="button"
                  className="file-task-btn"
                  onClick={() => p.onCancel(t.local_id)}
                  aria-label={`取消 ${t.filename}`}
                  title="取消"
                >
                  取消
                </button>
              )}
              {status === 'failed' && (
                <button
                  type="button"
                  className="file-task-btn is-retry"
                  onClick={() => p.onRetry(t.local_id)}
                  aria-label={`重试 ${t.filename}`}
                  title="重试"
                >
                  重试
                </button>
              )}
              {status === 'done' && (
                <button
                  type="button"
                  className="file-task-btn is-open"
                  onClick={() => p.onOpen(t.local_id)}
                  aria-label={`打开 ${t.filename} 转写结果`}
                  title="查看"
                >
                  查看
                </button>
              )}
            </div>
            {/* 抑制未用变量警告 */}
            {isFinal && null}
          </li>
        );
      })}
    </ul>
  );
});

FileTaskList.displayName = 'FileTaskList';
