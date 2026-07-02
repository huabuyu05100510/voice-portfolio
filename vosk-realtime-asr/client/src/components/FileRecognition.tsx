/**
 * FileRecognition — 文件识别面板 (录音文件识别 2.0)
 *
 * 整合 FileUploader + FileTaskList, 与实时转写通过 useFileAsr.merge 入口联动.
 * 不破坏现有实时转写 UI — 只在主区下方追加一个"文件任务"区.
 *
 * Author: MiniMax-M3 (2026-06-27)
 */
import React, { useState } from 'react';
import { FileUploader, type FileSubmitMeta } from './FileUploader';
import { FileTaskList } from './FileTaskList';
import { useFileAsr, type FileAsrTask } from '../hooks/useFileAsr';
import type { TranscriptionAction } from '../types';

export interface FileRecognitionProps {
  /** transcription reducer 的 dispatch — 文件结果会通过它 merge 到实时转写 */
  dispatch: React.Dispatch<TranscriptionAction>;
  /** 文件 URL 缓存: 供 retry 重新提交 (key: local_id, value: file_url) */
  onFileUrlChange?: (local_id: string, file_url: string) => void;
  /** 用户已 dismiss 错误时 */
  onError?: (msg: string) => void;
}

export const FileRecognition: React.FC<FileRecognitionProps> = React.memo((p) => {
  const fileRef = React.useRef<Map<string, File>>(new Map());
  const fileAsr = useFileAsr({ dispatch: p.dispatch, pollIntervalMs: 2000, fileRef });

  const onSubmit = async (meta: FileSubmitMeta) => {
    const task = await fileAsr.submit(meta.file, {
      filename: meta.filename,
      size_bytes: meta.size_bytes,
      format: meta.format,
    });
    if (task.local_id) {
      fileRef.current.set(task.local_id, meta.file);
    }
  };

  const onRetry = (local_id: string) => {
    const f = fileRef.current.get(local_id);
    if (f) {
      void fileAsr.retry(local_id, '');  // retry will re-fetch from fileRef
    } else {
      p.onError?.('无法重试: 文件引用已失效, 请重新上传');
    }
  };

  const onOpen = (local_id: string) => {
    const t = fileAsr.tasks.find((x) => x.local_id === local_id);
    if (t && t.merged_dispatch_payload) {
      // 已经 merge 进 reducer — 用户在 Hero 区能看到.
      // 这里可以做高亮, 但简单起见, scroll 到 Hero 区.
      const hero = document.getElementById('main-content');
      hero?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <section className="file-recognition" aria-label="文件识别 2.0">
      <header className="file-recognition-header">
        <h3>文件识别 2.0</h3>
        <p>支持 mp3 / wav / m4a / mp4 / mov 等格式, 最大 100MB</p>
      </header>
      <FileUploader
        onSubmit={onSubmit}
        onError={(reason) => p.onError?.(reason)}
        disabled={fileAsr.isUploading}
      />
      <FileTaskList
        tasks={fileAsr.tasks}
        onCancel={fileAsr.cancel}
        onRetry={onRetry}
        onOpen={onOpen}
      />
      {fileAsr.tasks.some((t) => t.status === 'done' || t.status === 'failed') && (
        <footer className="file-recognition-footer">
          <button
            type="button"
            className="file-recognition-clear"
            onClick={fileAsr.clearFinished}
          >
            清除已完成
          </button>
        </footer>
      )}
    </section>
  );
});

FileRecognition.displayName = 'FileRecognition';
