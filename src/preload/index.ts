import { contextBridge, ipcRenderer } from 'electron';

const api = {
  platform: process.platform,

  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) =>
    ipcRenderer.invoke('window:setIgnoreMouseEvents', ignore, options),
  getCursorPos: () => ipcRenderer.invoke('window:getCursorPos'),

  getDesktopPath: () => ipcRenderer.invoke('app:getDesktopPath'),
  hideIcons: () => ipcRenderer.invoke('app:hideIcons'),
  showIcons: () => ipcRenderer.invoke('app:showIcons'),
  isIconsHidden: () => ipcRenderer.invoke('app:isIconsHidden'),
  isSysIconsHidden: () => ipcRenderer.invoke('app:isSysIconsHidden'),
  setSysIconsHidden: (hidden: boolean) => ipcRenderer.invoke('app:setSysIconsHidden', hidden),
  getFileIcon: (p: string, size?: number) => ipcRenderer.invoke('app:getFileIcon', p, size),

  scan: () => ipcRenderer.invoke('organizer:scan'),
  applyOrganize: () => ipcRenderer.invoke('organizer:apply'),
  undoOrganize: () => ipcRenderer.invoke('organizer:undo'),
  hasManifest: () => ipcRenderer.invoke('organizer:hasManifest'),

  setWallpaper: (p: string) => ipcRenderer.invoke('wallpaper:set', p),
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  listWallpapers: (dir: string) => ipcRenderer.invoke('wallpaper:list', dir),
  setWallpaperMode: (mode: string) => ipcRenderer.invoke('wallpaper:setMode', mode),
  getSchedule: () => ipcRenderer.invoke('wallpaper:getSchedule'),
  setSchedule: (s: any) => ipcRenderer.invoke('wallpaper:setSchedule', s),
  nextWallpaper: () => ipcRenderer.invoke('wallpaper:next'),
  listBuiltinWallpapers: () => ipcRenderer.invoke('wallpaper:builtin'),

  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),
  showItemInFolder: (p: string) => ipcRenderer.invoke('shell:showItemInFolder', p),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c: any) => ipcRenderer.invoke('config:set', c),
  resetConfig: () => ipcRenderer.invoke('config:reset'),

  getWidgets: () => ipcRenderer.invoke('widgets:getState'),
  setWidgets: (s: any) => ipcRenderer.invoke('widgets:setState', s),

  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('app:setLoginItem', enabled),
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
  notifyDesktop: (title: string, body: string) =>
    ipcRenderer.invoke('app:notify', title, body),
  quit: () => ipcRenderer.invoke('app:quit'),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),

  // ---- 工作笔记（归墨） ----
  notesLoad: () => ipcRenderer.invoke('notes:load'),
  notesSave: (json: string) => ipcRenderer.invoke('notes:save', json),
  notesOpen: () => ipcRenderer.invoke('notes:open'),
  notesOpenHome: () => ipcRenderer.invoke('notes:openHome'),
  notesHome: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('notes:home', listener);
    return () => ipcRenderer.removeListener('notes:home', listener);
  },
  /** 窗口被再次唤起时让正文拿回焦点（主进程 notes:focusEdit） */
  notesFocusEdit: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('notes:focusEdit', listener);
    return () => ipcRenderer.removeListener('notes:focusEdit', listener);
  },
  notesSaveMedia: (dataUrl: string) => ipcRenderer.invoke('notes:media:save', dataUrl),
  notesFlowSave: (url: string, json: string) => ipcRenderer.invoke('notes:flow:save', url, json),
  notesFlowLoad: (url: string) => ipcRenderer.invoke('notes:flow:load', url),
  notesMediaDirGet: () => ipcRenderer.invoke('notes:media:dir:get'),
  notesMediaDirSet: (dir: string) => ipcRenderer.invoke('notes:media:dir:set', dir),
  notesMediaDirPick: (current?: string) => ipcRenderer.invoke('notes:media:dir:pick', current),
  notesMediaRemove: (url: string) => ipcRenderer.invoke('notes:media:remove', url),
  notesOpenTrack: (stickyId: string) => ipcRenderer.invoke('notes:openTrack', stickyId),
  notesTakeTrackFocus: () => ipcRenderer.invoke('notes:takeTrackFocus'),
  stickyGet: () => ipcRenderer.invoke('notes:sticky:get'),
  stickySetStatus: (id: string, status: string) =>
    ipcRenderer.invoke('notes:sticky:status', id, status),
  stickyAdd: (item: { id?: string; text: string; status?: string; at?: number }) =>
    ipcRenderer.invoke('notes:sticky:add', item),
  stickySync: (payload: { items: any[]; managedIds: string[] }) =>
    ipcRenderer.invoke('notes:sticky:sync', payload),
  notesSaveImage: (dataUrl: string) => ipcRenderer.invoke('notes:image:save', dataUrl),
  notesAIGetConfig: () => ipcRenderer.invoke('notes:ai:getConfig'),
  notesAISetConfig: (cfg: any) => ipcRenderer.invoke('notes:ai:setConfig', cfg),
  notesAIChat: (messages: any[], opts?: any) =>
    ipcRenderer.invoke('notes:ai:chat', messages, opts),
  notesASR: (dataUrl: string, mime?: string) =>
    ipcRenderer.invoke('notes:asr', dataUrl, mime),

  // ---- 本地查找 ----
  finderSearch: (query: string, limit?: number) => ipcRenderer.invoke('finder:search', query, limit),
  finderStatus: () => ipcRenderer.invoke('finder:status'),
  finderRebuild: () => ipcRenderer.invoke('finder:rebuild'),
  finderOpen: (target: string) => ipcRenderer.invoke('finder:open', target),
  finderReveal: (target: string) => ipcRenderer.invoke('finder:reveal', target),
  finderHide: () => ipcRenderer.invoke('finder:hide'),
  finderReady: () => ipcRenderer.invoke('finder:ready'),
  finderOnStatus: (cb: (status: any) => void) => {
    const listener = (_e: any, status: any) => cb(status);
    ipcRenderer.on('finder:status', listener);
    return () => ipcRenderer.removeListener('finder:status', listener);
  },
  finderOnFocus: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('finder:focus', listener);
    return () => ipcRenderer.removeListener('finder:focus', listener);
  },

  on: (channel: string, cb: (...args: any[]) => void) => {
    const listener = (_e: any, ...args: any[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('electronAPI', api);
