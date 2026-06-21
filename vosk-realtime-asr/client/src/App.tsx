/** Vosk 实时语音转写 Demo - Sprint 5 重构版 (Claude Opus 4.8) */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useRecorder } from './hooks/useRecorder';
import { useTranscription } from './hooks/useTranscription';
import { useDebugLog } from './hooks/useDebugLog';
import { useSampleAudio } from './hooks/useSampleAudio';
import { AppLayout } from './AppLayout';
import type { TranscriptionResult, AppStatus } from './types';
import type { PerfMonitorHandle } from './PerfMonitor';
import AppShell from './AppShell';

export default AppShell;
export const App = () => {
  const ws = useWebSocket('http://localhost:5000');
  const tr = useTranscription();
  const dbg = useDebugLog();
  const sampleAudio = useSampleAudio();
  const [status, setStatus] = useState<AppStatus>('idle');
  const statusRef = useRef(status); statusRef.current = status;
  const perfHandleRef = useRef<PerfMonitorHandle | null>(null);

  const recorder = useRecorder({
    onAudioData: (data) => {
      tr.recordAudioChunk(data.byteLength);
      const s = statusRef.current;
      if (s !== 'idle' && s !== 'error' && s !== 'completed') {
        const buf = new ArrayBuffer(data.byteLength);
        new Int16Array(buf).set(data);
        ws.client?.sendAudio(buf);
      }
    },
  });

  useEffect(() => {
    ws.onTranscription((r: TranscriptionResult) => {
      if (r.isFinal) {
        tr.pushFinal(r);
      } else {
        tr.pushPartial(r.text, r.fullText ?? '', r.speaker_id ?? null);
      }
      dbg.push('TRANSCRIPT', `${r.isFinal ? 'FINAL' : 'PART '} ${JSON.stringify(r.text)}${
        r.isFinal && r.words ? ` (${r.words.length}词)` : ''
      }${r.speaker_id ? ` [${r.speaker_id}]` : ''}${r.speakers && r.speakers.length ? ` (${r.speakers.length}人)` : ''}`);
      setStatus('transcribing');
    });
    ws.onLatency((ms) => perfHandleRef.current?.recordLatency(ms));
    ws.onSessionStatus((m) => tr.updateMetrics(m));
  }, [ws, tr, dbg]);

  // 修复: 当 WebSocket 连接成功时, 把本地 status 同步到 'ready'
  // 否则 ControlPanel 的 disabled 条件 (status !== 'ready') 永远 true, 按钮永远禁用
  useEffect(() => {
    if (ws.connectionStatus === 'ready' && status === 'idle') {
      setStatus('ready');
      dbg.push('STATE', '→ ready (WebSocket 已连接)');
    } else if (ws.connectionStatus === 'error' && status !== 'error') {
      setStatus('error');
    }
  }, [ws.connectionStatus, status, dbg]);

  const startRecording = useCallback(async () => {
    setStatus('connecting'); dbg.push('CLICK', '开始录音按钮');
    await recorder.start();
    ws.client?.startRecording(); dbg.push('WS', 'emit start_recording');
    setStatus('recording');
  }, [recorder, ws.client, dbg]);

  const stopRecording = useCallback(() => {
    recorder.stop(); ws.client?.stopRecording();
    dbg.push('WS', 'emit stop_recording'); setStatus('completed');
  }, [recorder, ws.client, dbg]);

  const clearTranscription = useCallback(() => {
    tr.clear();
    setStatus(ws.connectionStatus === 'ready' ? 'ready' : 'idle');
  }, [tr, ws.connectionStatus]);

  const playSample = useCallback(
    () => sampleAudio.play({ wsClient: ws.client, tr, dbg, setStatus }),
    [sampleAudio, ws.client, tr, dbg],
  );

  useEffect(() => {
    const onToggle = () => {
      const s = statusRef.current;
      if (s === 'ready' && ws.wsState === 'connected') void startRecording();
      else if (s === 'recording') stopRecording();
    };
    const onClear = () => clearTranscription();
    const onMute = () => void playSample();
    document.addEventListener('vosk:shortcut:toggle-record', onToggle);
    document.addEventListener('vosk:shortcut:clear', onClear);
    document.addEventListener('vosk:shortcut:mute', onMute);
    return () => {
      document.removeEventListener('vosk:shortcut:toggle-record', onToggle);
      document.removeEventListener('vosk:shortcut:clear', onClear);
      document.removeEventListener('vosk:shortcut:mute', onMute);
    };
  }, [startRecording, stopRecording, clearTranscription, playSample, ws.wsState]);

  const { state: t } = tr;
  return (
    <AppLayout
      status={status} wsState={ws.wsState} sessionId={ws.sessionId} error={ws.error}
      results={t.results} currentText={t.currentText} fullText={t.fullText}
      words={t.words} finalStartTime={t.finalStartTime} metrics={t.metrics}
      speakers={t.speakers} currentSpeakerId={t.currentSpeakerId}
      utterances={t.currentUtterances}
      mediaStream={recorder.mediaStream} latestAudio={recorder.latestAudio}
      bindWaveformCanvas={recorder.bindWaveformCanvas} debugLog={dbg.log}
      onStart={startRecording} onStop={stopRecording}
      onPlaySample={playSample} onClear={clearTranscription}
      onCopy={() => navigator.clipboard.writeText(t.fullText)}
    />
  );
};