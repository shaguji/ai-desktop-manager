import type {
  AppConfig,
  CategoryKey,
  FenceLayout,
  FileItemInfo,
  ScanResult,
  WallpaperSchedule,
  WidgetState,
  ThemeConfig
} from '../shared/types';

interface ElectronAPI {
  platform: string;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): Promise<void>;
  getCursorPos(): Promise<{ x: number; y: number } | null>;
  getDesktopPath(): Promise<string>;
  hideIcons(): Promise<{ ok: boolean; error?: string }>;
  showIcons(): Promise<{ ok: boolean; error?: string }>;
  isIconsHidden(): Promise<boolean>;
  isSysIconsHidden(): Promise<boolean>;
  setSysIconsHidden(hidden: boolean): Promise<boolean>;
  getFileIcon(p: string, size?: number): Promise<string>;
  scan(): Promise<ScanResult>;
  applyOrganize(): Promise<{ ok: boolean; moved: number; blocked: number; legacy: boolean; error?: string }>;
  undoOrganize(): Promise<{ ok: boolean; restored: number; blocked: number }>;
  hasManifest(): Promise<boolean>;
  setWallpaper(p: string): Promise<boolean>;
  getWallpaper(): Promise<string>;
  listWallpapers(dir: string): Promise<string[]>;
  setWallpaperMode(mode: string): Promise<boolean>;
  getSchedule(): Promise<WallpaperSchedule>;
  setSchedule(s: WallpaperSchedule): Promise<WallpaperSchedule>;
  nextWallpaper(): Promise<string | null>;
  listBuiltinWallpapers(): Promise<{ name: string; path: string; thumb: string; current: boolean }[]>;
  openPath(p: string): Promise<string>;
  showItemInFolder(p: string): Promise<void>;
  getConfig(): Promise<AppConfig>;
  setConfig(c: Partial<AppConfig>): Promise<AppConfig>;
  resetConfig(): Promise<AppConfig>;
  getWidgets(): Promise<WidgetState>;
  setWidgets(s: Partial<WidgetState>): Promise<WidgetState>;
  setLoginItem(enabled: boolean): Promise<boolean>;
  openSettings(): Promise<void>;
  notifyDesktop(title: string, body: string): Promise<boolean>;
  quit(): Promise<void>;
  openDirectory(): Promise<string | null>;
  openFile(): Promise<string | null>;
  // 工作笔记（归墨）
  notesLoad(): Promise<string | null>;
  notesSave(json: string): Promise<boolean>;
  notesOpen(): Promise<boolean>;
  notesOpenHome?(): Promise<boolean>;
  notesHome?(cb: () => void): () => void;
  notesSaveMedia?(dataUrl: string): Promise<{ url: string; path: string }>;
  notesFlowSave?(url: string, json: string): Promise<boolean>;
  notesFlowLoad?(url: string): Promise<string | null>;
  notesMediaDirGet?(): Promise<string>;
  notesMediaDirSet?(dir: string): Promise<string>;
  notesMediaDirPick?(current?: string): Promise<string | null>;
  notesMediaRemove?(url: string): Promise<boolean>;
  stickyGet(): Promise<import('../shared/types').NoteItem[]>;
  stickySetStatus(id: string, status: string): Promise<import('../shared/types').NoteItem[]>;
  stickyAdd(item: { id?: string; text: string; status?: string; at?: number }):
    Promise<import('../shared/types').NoteItem | null>;
  stickySync(payload: { items: any[]; managedIds: string[] }): Promise<{
    items: import('../shared/types').NoteItem[];
    changed: boolean;
  }>;
  notesSaveImage(dataUrl: string): Promise<{ url: string; path: string }>;
  notesAIGetConfig(): Promise<any>;
  notesAISetConfig(cfg: any): Promise<boolean>;
  notesAIChat(messages: any[], opts?: any): Promise<{ ok: boolean; content?: string; error?: string }>;
  notesASR(dataUrl: string, mime?: string): Promise<{ ok: boolean; text?: string; error?: string }>;

  // ---- 本地查找 ----
  finderSearch(query: string, limit?: number): Promise<any>;
  finderStatus(): Promise<any>;
  finderRebuild(): Promise<any>;
  finderOpen(target: string): Promise<string>;
  finderReveal(target: string): Promise<boolean>;
  finderHide(): Promise<boolean>;
  finderReady(): Promise<any>;
  finderOnStatus(cb: (status: any) => void): () => void;
  finderOnFocus(cb: () => void): () => void;

  on(channel: string, cb: (...args: any[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
