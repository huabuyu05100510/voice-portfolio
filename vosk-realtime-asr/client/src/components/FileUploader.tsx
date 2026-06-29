/**
 * FileUploader — 拖拽 + 点击选择
 *
 * 视觉:
 *   - dashed border, hover/dragover 高亮
 *   - 大号 dropzone + format icons
 *   - disabled 状态: 灰, 不可拖入
 *
 * 行为:
 *   - 拖入 / 点击 → 校验格式 + 大小 → 触发 onSubmit(file_url, meta)
 *   - 失败 → onError(reason)
 *   - 注: file_url 在浏览器端是 URL.createObjectURL(File) 出的 objectURL,
 *         服务端需要能 fetch 它的 (Vite proxy 直通同一 origin).
 *
 * Author: MiniMax-M3 (2026-06-27)
 */
import React, { useCallback, useRef, useState } from 'react';
import { checkFileMeta, SUPPORTED_FORMATS, isVideoFile } from '../utils/audioFormat';

export interface FileSubmitMeta {
  filename: string;
  size_bytes: number;
  format: string;
  file_url: string;
  duration_sec?: number;
}

export interface FileUploaderProps {
  /** 提交 (返回 Promise — UI 显示 uploading 状态) */
  onSubmit: (meta: FileSubmitMeta) => Promise<void> | void;
  /** 校验失败 / 网络错误 */
  onError: (reason: string) => void;
  /** 禁用 (全局上传中 / 录音中) */
  disabled?: boolean;
  /** 自定义文案 */
  hint?: string;
  /** 拖拽中视觉 */
  onDragActiveChange?: (active: boolean) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = (p) => {
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (p.disabled) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      const file = list[0];
      const check = checkFileMeta(file.name, file.size);
      if (!check.ok) {
        p.onError(check.reason);
        return;
      }
      setBusy(true);
      try {
        const file_url = URL.createObjectURL(file);
        let duration_sec: number | undefined;
        try {
          if (file.type.startsWith('audio/') || isVideoFile(file.name)) {
            const arr = await file.arrayBuffer();
            const Ctx: typeof AudioContext =
              (window as any).AudioContext || (window as any).webkitAudioContext;
            if (Ctx) {
              const ctx = new Ctx();
              try {
                const buf = await ctx.decodeAudioData(arr.slice(0));
                duration_sec = buf.duration;
              } catch {
                /* ignore */
              }
              try {
                ctx.close();
              } catch {
                /* ignore */
              }
            }
          }
        } catch {
          /* ignore duration 读失败 */
        }
        await p.onSubmit({
          filename: file.name,
          size_bytes: file.size,
          format: check.format,
          file_url,
          duration_sec,
        });
        setTimeout(() => URL.revokeObjectURL(file_url), 60_000);
      } catch (e: any) {
        p.onError(e?.message || 'submit failed');
      } finally {
        setBusy(false);
      }
    },
    [p.onSubmit, p.onError, p.disabled],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (p.disabled) return;
    if (!dragActive) {
      setDragActive(true);
      p.onDragActiveChange?.(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragActive) {
      setDragActive(false);
      p.onDragActiveChange?.(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    p.onDragActiveChange?.(false);
    if (p.disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };
  const onClick = () => {
    if (p.disabled) return;
    inputRef.current?.click();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (p.disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFiles(e.target.files);
      e.target.value = ''; // 允许重复选同一文件
    }
  };

  const formats = SUPPORTED_FORMATS.map((f) => f.replace('.', '')).join(' / ');
  return (
    <div
      className={`file-uploader ${dragActive ? 'is-drag-active' : ''} ${
        p.disabled ? 'is-disabled' : ''
      } ${busy ? 'is-busy' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={p.disabled ? -1 : 0}
      aria-disabled={p.disabled}
      aria-label="文件上传区, 拖拽或点击选择"
      data-testid="file-uploader-dropzone"
    >
      <div className="file-uploader-icon" aria-hidden="true">
        {busy ? (
          <div className="file-uploader-spinner" />
        ) : (
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        )}
      </div>
      <div className="file-uploader-text">
        <strong>
          {busy
            ? '正在准备…'
            : p.hint || (dragActive ? '松开以上传' : '拖拽音频 / 视频文件到此处')}
        </strong>
        <span className="file-uploader-hint">
          {p.disabled
            ? '当前不可上传'
            : `或点击选择 · 支持 ${formats} · 最大 100MB`}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_FORMATS.join(',')}
        onChange={onChange}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          left: -9999,
        }}
        disabled={p.disabled}
        data-testid="file-uploader-input"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
};

FileUploader.displayName = 'FileUploader';

