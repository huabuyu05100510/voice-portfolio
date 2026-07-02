/** Vosk 实时语音转写 Demo - Sprint 5 重构版 (Claude Opus 4.8)
 *  Sprint 16: Admin layout — 左侧菜单切换, 右侧内容区变化, Shell 不动
 *  Sprint 18: 7 项 AI 能力全量集成到左侧菜单 (转写·生成·音色)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { trace } from '@opentelemetry/api';
import { useWebSocket } from './hooks/useWebSocket';
import { useRecorder } from './hooks/useRecorder';
import { useTranscription } from './hooks/useTranscription';
import { useDebugLog } from './hooks/useDebugLog';
import { useSampleAudio } from './hooks/useSampleAudio';
import { useTtsPlayback } from './hooks/useTtsPlayback';
import { useRealtimeConversation, defaultRealtimeWsUrl } from './hooks/useRealtimeConversation';
import { useSimultaneousInterpretation } from './hooks/useSimultaneousInterpretation';
import { useVoiceCloning } from './hooks/useVoiceCloning';
import { AppLayoutV2 } from './AppLayoutV2';
import { RealtimeChat } from './components/RealtimeChat';
import { VoiceDesigner } from './components/VoiceDesigner';
import { BilingualCaption } from './components/BilingualCaption';
import { TranscriptHero } from './components/TranscriptHero';
import { CaptionBar } from './components/CaptionBar';
import { RecordingButton } from './components/RecordingButton';
import { FileRecognition } from './components/FileRecognition';
import { PodcastGenerator } from './components/PodcastGenerator';
import { VoiceLibrary } from './components/VoiceLibrary';
import { VoiceCloningWizard } from './components/VoiceCloningWizard';
import type { TranscriptionResult, AppStatus } from './types';
import type { PerfMonitorHandle } from './PerfMonitor';
import { ALL_MODES, type AppMode } from './components/ModeTabs';
import AppShell from './AppShell';

const clientTracer = trace.getTracer('voice-portfolio-client', '1.0.0');

export default AppShell;

// ---------------------------------------------------------------------------
// App — always renders the shell, swaps content based on mode
// ---------------------------------------------------------------------------
export const App = () => {
  const [mode, setMode] = useState<AppMode>(() => {
    try {
      const stored = localStorage.getItem('voice-portfolio:mode');
      // Sprint 18: 白名单 7 mode, 脏值回退 transcribe
      if (stored && (ALL_MODES as readonly string[]).includes(stored)) return stored as AppMode;
      return 'transcribe';
    } catch { return 'transcribe'; }
  });
  useEffect(() => {
    try { localStorage.setItem('voice-portfolio:mode', mode); } catch { /* ignore */ }
  }, [mode]);

  // ----- Transcribe hooks (always mounted so shell gets session/metrics/wsState) -----
  const ws = useWebSocket(import.meta.env.VITE_WS_URL ?? window.location.origin);
  const tr = useTranscription();
  const dbg = useDebugLog();
  const sampleAudio = useSampleAudio();
  const tts = useTtsPlayback(true);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [bilingualEnabled, setBilingualEnabled] = useState(() => {
    try { return localStorage.getItem('voice-portfolio:bilingual') === 'true'; } catch { return false; }
  });
  const interpRowIdRef = useRef(0);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const statusRef = useRef(status); statusRef.current = status;
  const perfHandleRef = useRef<PerfMonitorHandle | null>(null);
  const pendingStopRef = useRef(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- Sprint 18: 4 个新 AI 能力共享 hooks -----
// FileRecognition / PodcastGenerator / VoiceCloningWizard 内部自带 hook,
// 这里只在 App 顶层挂 useVoiceCloning, 给 VoiceLibrary 共享 voices 列表.
const voiceCloning = useVoiceCloning({ speakerId: 'default-user' });

// mode 切换的可观测性 — dbg + OTel span
useEffect(() => {
  dbg.push('NAV', `→ ${mode}`);
  const span = clientTracer.startSpan('ui.mode_switch', { attributes: { 'app.mode': mode } });
  span.end();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [mode]);

  const interp = useSimultaneousInterpretation({ socket: ws.socket, enabled: bilingualEnabled });

  const recorder = useRecorder({
    onAudioData: (data) => {
      tr.recordAudioChunk(data.byteLength);
      if (statusRef.current === 'recording' || statusRef.current === 'transcribing') {
        const buf = new ArrayBuffer(data.byteLength);
        new Int16Array(buf).set(data);
        ws.clientRef.current?.sendAudio(buf);
      }
    },
  });

  // ----- WS transcription handlers -----
  useEffect(() => {
    ws.onTranscription((r: TranscriptionResult) => {
      if (r.isFinal) {
        tr.pushFinal(r, r.isCumulative);
        const rowId = `row-${Date.now()}-${interpRowIdRef.current++}`;
        interp.onTranscriptionFinal(r, rowId);
      } else {
        tr.pushPartial(r.text, r.fullText ?? '', r.speaker_id ?? null);
        interp.onSourcePartial(r.text || '');
      }
      dbg.push('TRANSCRIPT', `${r.isFinal ? 'FINAL' : 'PART '} ${JSON.stringify(r.text)}${
        r.isFinal && r.words ? ` (${r.words.length}词)` : ''
      }${r.speaker_id ? ` [${r.speaker_id}]` : ''}${r.speakers && r.speakers.length ? ` (${r.speakers.length}人)` : ''}`);
      if (statusRef.current === 'recording' || statusRef.current === 'transcribing') {
        setStatus('transcribing');
      }
    });
    ws.onLatency((ms) => perfHandleRef.current?.recordLatency(ms));
    ws.onSessionStatus((m) => tr.updateMetrics(m));
    ws.onTtsAudio((p) => tts.enqueue(p));
    ws.onRecordingStopped(() => {
      dbg.push('WS', 'recording_stopped: 启动 1.5s grace 接收最后一句');
      if (forceStopTimerRef.current) { clearTimeout(forceStopTimerRef.current); forceStopTimerRef.current = null; }
      graceTimerRef.current = setTimeout(() => {
        dbg.push('WS', 'grace window 结束, 真正完成');
        pendingStopRef.current = false;
        graceTimerRef.current = null;
        setStatus('completed');
      }, 1500);
    });
  }, [ws, tr, dbg, tts, interp]);

  useEffect(() => {
    if (ws.connectionStatus === 'ready' && status === 'idle') { setStatus('ready'); dbg.push('STATE', '→ ready (WebSocket 已连接)'); }
    else if (ws.connectionStatus === 'error' && status !== 'error') { setStatus('error'); }
  }, [ws.connectionStatus, status, dbg]);

  // ----- Conversation hooks (always mounted, dormant until mode switches) -----
  // Sprint 19: use Socket.IO transport so the browser routes through the
  // existing Flask-SocketIO backend which proxies to Volcengine Realtime WSS.
  const rt = useRealtimeConversation({
    url: defaultRealtimeWsUrl(),
    transport: 'socketio',
    socket: ws.socket,
    autoConnect: false,
    autoCapture: false,
  });

  // Auto-connect only when in conversation mode, disconnect on leave
  useEffect(() => {
    if (mode === 'conversation') {
      if (rt.state.status === 'idle') rt.connect();
    } else {
      if (rt.state.status !== 'idle') rt.disconnect();
    }
  }, [mode, rt.connect, rt.disconnect, rt.state.status]);

  // ----- Actions -----
  const startRecording = useCallback(async () => {
    dbg.push('CLICK', '开始录音按钮');
    const span = clientTracer.startSpan('user.start_recording');
    try {
      span.setAttribute('tts.enabled', tts.enabled);
      setStatus('connecting');
      try { await recorder.start(); } catch (e: any) {
        dbg.push('ERROR', `录音器启动失败: ${e?.message ?? e}`);
        setStatus('error');
        span.recordException(e); span.setStatus({ code: 2, message: String(e?.message ?? e) });
        return;
      }
      const client = ws.clientRef.current;
      if (!client) {
        dbg.push('ERROR', 'WebSocket client 不可用');
        recorder.stop(); setStatus('error');
        span.setStatus({ code: 2, message: 'no ws client' });
        return;
      }
      try {
        await client.startRecording({ enable_tts: tts.enabled });
        dbg.push('WS', `WSS 握手完成, 开始推送音频 (tts=${tts.enabled})`);
        setStatus('recording'); span.setStatus({ code: 1 });
      } catch (e: any) {
        dbg.push('ERROR', `startRecording 失败: ${e?.message ?? e}`);
        recorder.stop(); setStatus('error');
        span.recordException(e); span.setStatus({ code: 2, message: String(e?.message ?? e) });
      }
    } finally { span.end(); }
  }, [recorder, ws.clientRef, dbg, tts.enabled]);

  const stopRecording = useCallback(() => {
    const span = clientTracer.startSpan('user.stop_recording');
    try {
      recorder.stop();
      ws.clientRef.current?.stopRecording();
      dbg.push('WS', 'emit stop_recording');
      pendingStopRef.current = true; setStatus('transcribing');
      span.setAttribute('pending_stop', true);
      forceStopTimerRef.current = setTimeout(() => {
        if (pendingStopRef.current && statusRef.current === 'transcribing') {
          dbg.push('WS', 'recording_stopped 超时, 强制完成');
          pendingStopRef.current = false;
          forceStopTimerRef.current = null;
          setStatus('completed');
        }
      }, 3000);
      span.setStatus({ code: 1 });
    } finally { span.end(); }
  }, [recorder, ws.clientRef, dbg]);

  const clearTranscription = useCallback(() => {
    tr.clear();
    setStatus(ws.connectionStatus === 'ready' ? 'ready' : 'idle');
  }, [tr, ws.connectionStatus]);

  const playSample = useCallback(
    () => sampleAudio.play({ wsClient: ws.clientRef.current, tr, dbg, setStatus }),
    [sampleAudio, ws.clientRef, tr, dbg],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onToggle = () => {
      const s = statusRef.current;
      if (s === 'ready' && ws.wsState === 'connected') void startRecording();
      else if (s === 'recording' || s === 'transcribing') stopRecording();
    };
    document.addEventListener('vosk:shortcut:toggle-record', onToggle);
    document.addEventListener('vosk:shortcut:clear', clearTranscription);
    document.addEventListener('vosk:shortcut:mute', () => void playSample());
    return () => {
      document.removeEventListener('vosk:shortcut:toggle-record', onToggle);
      document.removeEventListener('vosk:shortcut:clear', clearTranscription);
      document.removeEventListener('vosk:shortcut:mute', () => void playSample());
    };
  }, [startRecording, stopRecording, clearTranscription, playSample, ws.wsState]);

  // Cleanup timers
  useEffect(() => () => {
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    if (forceStopTimerRef.current) clearTimeout(forceStopTimerRef.current);
  }, []);

  // ----- Derived state -----
  const { state: t } = tr;
  const visibleError = ws.error && ws.error !== dismissedError ? ws.error : null;
  const bilingualCaptionNode = bilingualEnabled ? (
    <BilingualCaption
      rows={interp.state.rows}
      partialSource={interp.state.partialSource}
      partialTarget={interp.state.partialTarget}
      sourceLang={interp.state.sourceLang}
      targetLang={interp.state.targetLang}
      fallbackMode={interp.state.fallbackMode}
      translationConnected={interp.state.translationConnected}
    />
  ) : null;
  const isRecording = status === 'recording' || status === 'transcribing';
  const canStart = status === 'ready' && ws.wsState === 'connected';
  const currentSpeaker = t.currentSpeakerId
    ? t.speakers.find((s) => s.id === t.currentSpeakerId) ?? null
    : null;
  const hasResults = t.results.length > 0;

  // ----- Content based on mode -----
  const content = (() => {
    switch (mode) {
      case 'transcribe':
        return (
          <TranscriptHero
            key="transcribe-content"
            results={t.results}
            currentText={t.currentText}
            fullText={t.fullText}
            speakers={t.speakers}
            onCopy={() => navigator.clipboard.writeText(t.fullText)}
            canCopy={!!t.fullText}
            emptyStateSlot={
              <RecordingButton state={status} isRecording={isRecording} disabled={!canStart}
                onStart={startRecording} onStop={stopRecording} variant="hero" />
            }
          >
            <CaptionBar
              currentText={t.currentText}
              fullText={t.fullText}
              currentSpeaker={currentSpeaker
                ? { id: currentSpeaker.id, label: currentSpeaker.label, color: currentSpeaker.color }
                : null}
              isRecording={isRecording}
            />
            {bilingualEnabled && bilingualCaptionNode && (
              <div className="app-bilingual-slot" data-bilingual-mounted="true">
                {bilingualCaptionNode}
              </div>
            )}
          </TranscriptHero>
        );
      case 'conversation':
        return (
          <RealtimeChat
            key="conversation-content"
            state={rt.state}
            onConnect={rt.connect}
            onDisconnect={rt.disconnect}
            onClear={rt.clear}
          />
        );
      case 'voice_design':
        return <VoiceDesigner key="voice-design-content" />;
      case 'file_recognition':
        return (
          <FileRecognition
            key="file-recognition-content"
            dispatch={tr.dispatch}
            onError={(msg) => { setDismissedError(null); /* 不在 App 顶部重复展示, 由子组件自管 */ void msg; }}
          />
        );
      case 'podcast':
        return (
          <PodcastGenerator
            key="podcast-content"
            transcript={t.fullText}
            onGenerated={(r) => {
              dbg.push('PODCAST', `生成: ${r.task_id}`);
            }}
          />
        );
      case 'voice_library':
        return (
          <VoiceLibrary
            key="voice-library-content"
            voices={voiceCloning.voices}
            activeVoiceId={voiceCloning.activeVoiceId}
            onDelete={(id) => { void voiceCloning.deleteVoice(id); }}
            onPreview={(id) => { dbg.push('VOICE', `preview ${id}`); }}
            onSetActive={voiceCloning.setActiveVoice}
          />
        );
      case 'voice_cloning':
        return (
          <VoiceCloningWizard
            key="voice-cloning-content"
            state={voiceCloning.state}
            onStartRecording={voiceCloning.startRecording}
            onStopRecording={() => {
              // 简化: stop 触发 onRecordingDone(空 blob 由 consumer 负责)
              // 实际录音 → blob 链路需 AudioCapture.start/stop 配对; 这里只触发 reducer 状态
              dbg.push('CLONE', 'stop requested');
            }}
            onRecordingDone={(blob) => { void voiceCloning.onRecordingDone(blob); }}
            onReset={voiceCloning.reset}
            onComplete={(id) => dbg.push('CLONE', `完成 voice_id=${id}`)}
          />
        );
      default:
        return (
          <div className="empty-state" role="status">
            <div className="empty-orbit">
              <div className="orbit-core" />
            </div>
            <p>未知模式, 请刷新页面或重新选择左侧菜单</p>
          </div>
        );
    }
  })();

  return (
    <AppLayoutV2
      mode={mode}
      onModeChange={setMode}
      status={status}
      wsState={ws.wsState}
      isRecording={isRecording}
      canStart={canStart}
      onStart={startRecording}
      onStop={stopRecording}
      ttsEnabled={tts.enabled}
      onTtsToggle={tts.toggle}
      bilingualEnabled={bilingualEnabled}
      onBilingualToggle={() => {
        const next = !bilingualEnabled;
        setBilingualEnabled(next);
        try { localStorage.setItem('voice-portfolio:bilingual', String(next)); } catch { /* ignore */ }
        if (!next) interp.clear();
      }}
      onExport={() => {}}
      onPlaySample={playSample}
      hasResults={hasResults}
      sessionId={ws.sessionId}
      metrics={t.metrics}
      error={visibleError}
      onDismissError={() => setDismissedError(ws.error)}
      speakers={t.speakers}
      currentSpeakerId={t.currentSpeakerId}
      onRenameSpeaker={tr.renameSpeaker}
      mediaStream={recorder.mediaStream}
      latestAudio={recorder.latestAudio}
      bindWaveformCanvas={recorder.bindWaveformCanvas}
      podcastTranscript={t.fullText}
      onPodcastGenerated={() => {}}
      podcastResult={null}
      debugLog={dbg.log}
      resultsForExport={t.results}
      onClear={clearTranscription}
      onCopy={() => navigator.clipboard.writeText(t.fullText)}
    >
      {content}
    </AppLayoutV2>
  );
};