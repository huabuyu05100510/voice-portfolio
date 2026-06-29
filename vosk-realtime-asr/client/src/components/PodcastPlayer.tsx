/**
 * PodcastPlayer — 播客播放器
 *
 * 设计语言: Apple Podcasts / Spotify
 * - 大封面 (gradient + 头像占位)
 * - 标题 + 总时长 + 章节数
 * - 主持人 A 左 / B 右 对话气泡
 * - 右侧章节列表 (点击跳转)
 * - 底部播放控制 (播/暂/前 15s/后 15s/倍速)
 * - 真实 <audio> 元素承载 audio_url (每个 turn 一段)
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  PodcastResult,
  HostTurn,
  PodcastChapter,
} from '../hooks/usePodcastGeneration';

export interface PodcastPlayerProps {
  result: PodcastResult;
  /** 自定义 className (供宿主覆盖) */
  className?: string;
}

const SPEEDS: number[] = [0.75, 1, 1.25, 1.5, 2];

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function PodcastPlayerImpl({ result, className }: PodcastPlayerProps): React.ReactElement {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTurnIdx, setActiveTurnIdx] = useState(0);
  const [rate, setRate] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 当前应该播放的 audio_url (= active turn 的 audio_url)
  const currentTurn: HostTurn | undefined = result.script[activeTurnIdx];
  const currentAudioUrl = currentTurn?.audio_url ?? '';

  // audio element 时间同步
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrentTime(a.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      // 推进到下一 turn
      if (activeTurnIdx < result.script.length - 1) {
        setActiveTurnIdx(activeTurnIdx + 1);
      } else {
        setIsPlaying(false);
      }
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.playbackRate = rate;
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }, [activeTurnIdx, rate, result.script.length]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
    } else {
      a.pause();
    }
  }, []);

  const seekBy = useCallback(
    (deltaSec: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = Math.max(0, a.currentTime + deltaSec);
      setCurrentTime(a.currentTime);
    },
    [],
  );

  const jumpToChapter = useCallback(
    (chapter: PodcastChapter) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = chapter.start_ms / 1000;
      setCurrentTime(a.currentTime);
      // 同时把 active turn 同步到 start_ms 附近
      let cumMs = 0;
      for (let i = 0; i < result.script.length; i += 1) {
        const t = result.script[i];
        const next = cumMs + t.duration_ms;
        if (cumMs <= chapter.start_ms && chapter.start_ms < next) {
          setActiveTurnIdx(i);
          break;
        }
        cumMs = next;
      }
    },
    [result.script],
  );

  const onRateClick = useCallback((r: number) => {
    setRate(r);
    const a = audioRef.current;
    if (a) a.playbackRate = r;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-15);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(15);
      }
    },
    [seekBy, togglePlay],
  );

  const totalLabel = useMemo(
    () => formatDuration(result.total_duration_ms),
    [result.total_duration_ms],
  );

  return (
    <div
      className={`podcast-player ${className ?? ''}`}
      role="region"
      aria-label="播客播放器"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <audio
        ref={audioRef}
        src={currentAudioUrl}
        preload="metadata"
        data-testid="podcast-audio"
      />

      {/* 大封面 */}
      <div className="podcast-cover" aria-hidden="true">
        <div className="podcast-cover-inner">
          <div className="podcast-cover-host podcast-cover-host-a">A</div>
          <div className="podcast-cover-host podcast-cover-host-b">B</div>
        </div>
      </div>

      {/* 标题 + 时长 */}
      <div className="podcast-meta">
        <h2 className="podcast-title">会议播客</h2>
        <p className="podcast-subtitle">
          <span>{result.script.length} 段对话</span>
          <span aria-hidden="true"> · </span>
          <span data-testid="podcast-total-duration">{totalLabel}</span>
        </p>
      </div>

      <div className="podcast-body">
        {/* 对话气泡 */}
        <ol className="podcast-bubbles" aria-label="对话内容">
          {result.script.map((turn, idx) => (
            <li
              key={idx}
              className={`podcast-bubble ${turn.role === 'host_a' ? 'host-a' : turn.role === 'host_b' ? 'host-b' : 'host-other'} ${idx === activeTurnIdx ? 'is-active' : ''}`}
              data-testid={`podcast-turn-${idx}`}
              onClick={() => {
                const a = audioRef.current;
                if (a) {
                  setActiveTurnIdx(idx);
                  a.currentTime = 0;
                }
              }}
            >
              <div className="podcast-bubble-avatar" aria-hidden="true">
                {turn.role === 'host_a' ? 'A' : turn.role === 'host_b' ? 'B' : '?'}
              </div>
              <div className="podcast-bubble-text">{turn.text}</div>
              <div className="podcast-bubble-meta">
                {(turn.duration_ms / 1000).toFixed(1)}s
              </div>
            </li>
          ))}
        </ol>

        {/* 章节列表 */}
        <aside className="podcast-chapters" aria-label="章节列表">
          <h3 className="podcast-chapters-title">章节</h3>
          <ol>
            {result.chapters.map((ch, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  className="podcast-chapter-item"
                  onClick={() => jumpToChapter(ch)}
                  data-testid={`podcast-chapter-${idx}`}
                >
                  <span className="podcast-chapter-index">{idx + 1}</span>
                  <span className="podcast-chapter-title">{ch.title}</span>
                  <span className="podcast-chapter-duration">
                    {formatDuration(ch.end_ms - ch.start_ms)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      {/* 底部控制 */}
      <div className="podcast-controls">
        <button
          type="button"
          className="podcast-ctrl podcast-ctrl-back"
          onClick={() => seekBy(-15)}
          aria-label="后退 15 秒"
          data-testid="podcast-back-15"
        >
          −15s
        </button>
        <button
          type="button"
          className={`podcast-ctrl podcast-ctrl-play ${isPlaying ? 'is-playing' : ''}`}
          onClick={togglePlay}
          aria-label={isPlaying ? '暂停' : '播放'}
          data-testid="podcast-play"
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="podcast-ctrl podcast-ctrl-forward"
          onClick={() => seekBy(15)}
          aria-label="前进 15 秒"
          data-testid="podcast-forward-15"
        >
          +15s
        </button>
        <div className="podcast-rate" role="radiogroup" aria-label="倍速">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={rate === s}
              className={`podcast-rate-chip ${rate === s ? 'is-active' : ''}`}
              onClick={() => onRateClick(s)}
              data-testid={`podcast-rate-${s}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* 进度 */}
      <div className="podcast-progress" aria-hidden="true">
        <div
          className="podcast-progress-bar"
          style={{
            width: `${Math.min(100, (currentTime / Math.max(1, result.total_duration_ms / 1000)) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}

export const PodcastPlayer = React.memo(PodcastPlayerImpl);
PodcastPlayer.displayName = 'PodcastPlayer';

export default PodcastPlayer;