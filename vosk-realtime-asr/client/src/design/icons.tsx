/**
 * design/icons.tsx — Sprint 12 UI Redesign
 *
 * 行业级内联 SVG 图标库 (16-20 个核心图标):
 *  - 不引入额外依赖 (lucide / heroicons 等)
 *  - 24×24 viewBox, stroke-width 2, currentColor
 *  - 支持 size / className / aria-hidden / title
 *
 * 设计原则 (对标 Lucide / Heroicons / Phosphor):
 *  - 极简线性, 不带填充
 *  - 圆角端点 (stroke-linecap: round)
 *  - 24px 默认, 可缩放至 12 / 16 / 20 / 32 / 48
 *
 * Author: MiniMax-M3
 */
import React from 'react';

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24 | 28 | 32 | 36 | 48;

export interface IconProps {
  size?: IconSize;
  className?: string;
  title?: string;
  /** 默认 true; false 时屏幕阅读器可读取 (如标题旁图标) */
  decorative?: boolean;
}

const baseProps = (p: IconProps, defaultTitle?: string) => ({
  width: p.size ?? 20,
  height: p.size ?? 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: p.className,
  role: p.decorative === false ? 'img' : undefined,
  'aria-hidden': p.decorative === false ? undefined : (p.title ? undefined : true),
  'aria-label': p.decorative === false ? (p.title ?? defaultTitle) : undefined,
});

/* ============================================================================
 * Core icons
 * ========================================================================== */

export const MicIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '麦克风')}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);

export const StopIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '停止')}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const PlayIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '播放')}>
    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
  </svg>
);

export const PauseIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '暂停')}>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
  </svg>
);

export const DownloadIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '下载')}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '复制')}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '删除')}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '设置')}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const UsersIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '说话人')}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const ChartIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '指标')}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6"  y1="20" x2="6"  y2="14" />
    <line x1="3"  y1="20" x2="21" y2="20" />
  </svg>
);

export const ActivityIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '波形')}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '展开')}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const ChevronUpIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '收起')}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '右')}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '关闭')}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '确认')}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const AlertIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '警告')}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const InfoIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '提示')}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const EditIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '编辑')}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const SparklesIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, 'AI')}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </svg>
);

export const FileTextIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '文档')}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '亮色主题')}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '暗色主题')}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/* ============================================================================
 * Sprint 16 layout restructuring — new icons
 * ========================================================================== */

export const Volume2Icon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '朗读')}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

export const VolumeXIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '静音')}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </svg>
);

export const LanguagesIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '同声传译')}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10" />
    <path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10" />
  </svg>
);

export const BugIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '调试')}>
    <path d="M8 2l1.88 1.88" />
    <path d="M14.12 3.88L16 2" />
    <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
    <path d="M12 20c-3.3 0-6-2.24-6-5s2.7-5 6-5 6 2.24 6 5-2.7 5-6 5z" />
    <path d="M6 10H3" />
    <path d="M18 10h3" />
    <line x1="12" y1="20" x2="12" y2="15" />
    <line x1="8" y1="15" x2="16" y2="15" />
  </svg>
);

export const MusicIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '音乐')}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export const SkipForwardIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '跳过')}>
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </svg>
);

export const PanelRightIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '侧边栏')}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);

export const PanelRightCloseIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '收起侧边栏')}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
    <polyline points="12 9 9 12 12 15" />
  </svg>
);

export const MenuIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '菜单')}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

/* ============================================================================
 * Sprint 18 — SideMenu AI 能力集成 (新增 3 个图标)
 * ========================================================================== */

/** UploadIcon — 文件识别 (上传到云) */
export const UploadIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '文件识别')}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

/** LibraryIcon — 音色库 (4 条平行竖线 = 书架) */
export const LibraryIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '音色库')}>
    <path d="M16 6l4 14" />
    <path d="M12 6v14" />
    <path d="M8 8v12" />
    <path d="M4 4v16" />
  </svg>
);

/** RecordVoiceIcon — 语音克隆 (Mic + 录音指示点) */
export const RecordVoiceIcon: React.FC<IconProps> = (p) => (
  <svg {...baseProps(p, '语音克隆')}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <circle cx="20" cy="4" r="2" fill="currentColor" stroke="none" />
  </svg>
);

/* ============================================================================
 * Icon Registry — 按 string key 取图标 (供动态组件)
 * ========================================================================== */

export const ICONS = {
  mic: MicIcon,
  stop: StopIcon,
  play: PlayIcon,
  pause: PauseIcon,
  download: DownloadIcon,
  copy: CopyIcon,
  trash: TrashIcon,
  settings: SettingsIcon,
  users: UsersIcon,
  chart: ChartIcon,
  activity: ActivityIcon,
  chevronDown: ChevronDownIcon,
  chevronUp: ChevronUpIcon,
  chevronRight: ChevronRightIcon,
  close: CloseIcon,
  check: CheckIcon,
  alert: AlertIcon,
  info: InfoIcon,
  edit: EditIcon,
  sparkles: SparklesIcon,
  fileText: FileTextIcon,
  sun: SunIcon,
  moon: MoonIcon,
  volume2: Volume2Icon,
  volumeX: VolumeXIcon,
  languages: LanguagesIcon,
  bug: BugIcon,
  music: MusicIcon,
  skipForward: SkipForwardIcon,
  panelRight: PanelRightIcon,
  panelRightClose: PanelRightCloseIcon,
  menu: MenuIcon,
  upload: UploadIcon,
  library: LibraryIcon,
  recordVoice: RecordVoiceIcon,
} as const;

export type IconKey = keyof typeof ICONS;
