/**
 * A category key. Built-in keys are stable strings ('document' | 'app' | ...),
 * user-defined categories get generated keys like 'custom-1712345678'.
 */
export type CategoryKey = string;

/** 一条「关键字 → 归属目录」移动映射。 */
export interface TargetMapping {
  /** 文件名关键字（小写、去重）；命中任意一个即移动。 */
  keywords: string[];
  /** 归属目录绝对路径，目录不存在时自动创建。 */
  targetDir: string;
}

/** One classification rule. Rules are evaluated custom-first, then built-in. */
export interface CategoryRule {
  key: CategoryKey;
  /** Display name, also used as the folder name under 桌面/整理/ */
  label: string;
  /** Extensions without the dot, lower-case. */
  exts: string[];
  /** Optional file-name keywords; a hit wins over extension matching. */
  keywords?: string[];
  /**
   * 归属目录（可选，绝对路径，旧版单映射字段）。一键整理时，文件名命中
   * keywords 的顶层项目会被移动到该目录。已被 mappings 取代，仅为兼容保留：
   * 没有配置 mappings 时它仍作为该规则的兜底映射参与匹配。
   */
  targetDir?: string;
  /**
   * 移动映射表（可选）：一条规则内配置多组「关键字 → 归属目录」。
   * 匹配顺序：先于 targetDir 兜底映射。
   */
  mappings?: TargetMapping[];
  /** When true this rule collects directories instead of files. */
  matchDir?: boolean;
  /** Built-in rules cannot be deleted (but can be renamed / disabled). */
  builtin: boolean;
  enabled: boolean;
}

export interface FileItemInfo {
  name: string;
  path: string;
  isDir: boolean;
  ext: string;
  size: number;
  mtime: number;
}

export interface CategoryGroup {
  key: CategoryKey;
  label: string;
  items: FileItemInfo[];
}

export interface ScanResult {
  desktopPath: string;
  /**
   * Every desktop folder that was scanned. Windows paints one desktop from
   * both the per-user folder and the shared (Public) folder, so this usually
   * holds two entries.
   */
  roots: string[];
  categories: CategoryGroup[];
  total: number;
  organized: boolean;
  /**
   * 存在可还原的移动记录：旧版整理搬进「整理」文件夹的数据，或归属目录
   * 规则移动过的文件。true 时 UI 显示「还原文件」，可把它们放回原位置。
   */
  legacy?: boolean;
}

export type WallpaperMode = 'fill' | 'fit' | 'stretch' | 'tile' | 'center';

export interface WallpaperSchedule {
  enabled: boolean;
  intervalMin: number;
  random: boolean;
  dir: string;
}

export interface WidgetPosition {
  enabled: boolean;
  x: number;
  y: number;
  /**
   * Panel size, in px. 0 or undefined means "fit the content" (the default
   * look). Drag the grip at the bottom-right corner to change it.
   */
  w?: number;
  h?: number;
  /**
   * 收成标题条（最小化）：只留标题栏，位置与内容都保留，再点还原。
   * 缺省 / false = 展开。
   */
  collapsed?: boolean;
}

/** Where a note entry stands. Drives its background colour. */
export type NoteStatus = 'todo' | 'doing' | 'done';

export interface NoteItem {
  id: string;
  text: string;
  status: NoteStatus;
  /** Creation time — keeps ordering stable when text is edited. */
  at: number;
}

/**
 * One alarm on the clock widget.
 *
 * `days` is the repeat set (0 = Sunday … 6 = Saturday). An empty set means
 * "just once": the alarm switches itself off after it rings.
 */
export interface AlarmItem {
  id: string;
  /** 24h "HH:mm". */
  time: string;
  label: string;
  enabled: boolean;
  days: number[];
  /**
   * Local date key (YYYY-MM-DD) of the last ring, so a repeating alarm cannot
   * fire twice on the same day (e.g. after a renderer reload).
   */
  lastFired?: string;
  /** Epoch ms; while in the future a snoozed alarm stays quiet. */
  snoozeUntil?: number;
  /**
   * 一次性提醒的目标日期（YYYY-MM-DD）。设了就只在当天响，`days` 不再参与；
   * 便签里「11 月 20 日 09:00 提醒」用这个表达，普通闹铃不填。
   */
  date?: string;
  /**
   * 关联的便签待办 id。有值即为「待办提醒」：标题跟待办文字同步，
   * 待办完成 / 删除时提醒自动撤掉。
   */
  todoId?: string;
}

export interface WidgetState {
  clock: WidgetPosition & {
    alarms?: AlarmItem[];
    /** Ringtone on/off. Flashing + system notification always happen. */
    alarmSound?: boolean;
  };
  calendar: WidgetPosition;
  note: WidgetPosition & {
    items: NoteItem[];
    /** Legacy plain-text body; migrated into `items` on config load. */
    text?: string;
  };
}

export type ThemePreset = 'dark' | 'light' | 'midnight' | 'forest';

export interface ThemeConfig {
  /** Overall colour scheme; drives <html data-theme>. */
  preset: ThemePreset;
  accent: string;
  panelBg: string;
  panelOpacity: number;
  blur: boolean;
}

export interface AppSettings {
  autoOrganizeOnStart: boolean;
  hideIconsOnStart: boolean;
  /**
   * Hide 此电脑/回收站 on the real desktop (they stay available as virtual
   * items inside the 系统 category — shell objects cannot be moved to a folder).
   */
  sysIconsHidden: boolean;
  loginItem: boolean;
  /**
   * Escape hatch: keep the desktop layer always interactive.
   * Useful when the OS does not forward mouse-move messages to a
   * transparent window, which would otherwise make the UI unclickable.
   */
  alwaysInteractive: boolean;
  /** Toolbar tucked upward into a small pill at the top-right corner. */
  toolbarCollapsed: boolean;
  /**
   * Where the user dragged the toolbar to (screen px, top-left corner).
   * Missing = the default top-right corner.
   */
  toolbarPos?: { x: number; y: number };
}

export interface AppConfig {
  version: number;
  fences: FenceLayout[];
  widgets: WidgetState;
  wallpaper: { schedule: WallpaperSchedule; lastWallpaper: string; mode: WallpaperMode };
  theme: ThemeConfig;
  categories: CategoryRule[];
  settings: AppSettings;
  /**
   * 桌面是否处于「原位分组」状态。
   *
   * 与旧版不同：整理不再移动任何文件，只是在桌面层按分类把图标分组展示，
   * 文件 / 文件夹留在原来的位置。隐藏系统桌面图标后由收纳窗口接管显示。
   */
  organized: boolean;
}

/**
 * One收纳窗口. A single window hosts MANY categories as switchable tabs,
 * so the desktop is not flooded with one window per category.
 */
export interface FenceLayout {
  id: string;
  title: string;
  /** Category keys rendered as tabs inside this window. */
  categories: CategoryKey[];
  /** Currently selected tab (falls back to categories[0]). */
  active?: CategoryKey;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
}
