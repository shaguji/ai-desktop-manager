import { contextBridge, ipcRenderer } from 'electron';

/**
 * 归墨笔记窗口专用 preload —— 只暴露笔记、便签、附件和 AI 转写接口。
 *
 * 渲染层是最低信任级别的输入面（笔记正文可以粘贴任何外部内容），
 * 所以这个上下文里拿不到桌面整理、壁纸、shell.openPath、全局配置等
 * 高权限能力；壳模式下由主进程负责所有需要特权的动作。
 */
const CHANNELS_OUT = new Set([
  'notes:home',
  'notes:focusEdit',
  'notes:sticky',
  'notes:focusTrack'
]);

const api = {
  // ---- 笔记状态 ----
  notesLoad: () => ipcRenderer.invoke('notes:load'),
  notesSave: (json: string) => ipcRenderer.invoke('notes:save', json),
  notesOpen: () => ipcRenderer.invoke('notes:open'),
  notesOpenHome: () => ipcRenderer.invoke('notes:openHome'),
  notesHome: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('notes:home', listener);
    return () => ipcRenderer.removeListener('notes:home', listener);
  },
  notesFocusEdit: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('notes:focusEdit', listener);
    return () => ipcRenderer.removeListener('notes:focusEdit', listener);
  },

  // ---- 附件 / 流程图 ----
  notesSaveMedia: (dataUrl: string) => ipcRenderer.invoke('notes:media:save', dataUrl),
  notesSaveImage: (dataUrl: string) => ipcRenderer.invoke('notes:image:save', dataUrl),
  notesFlowSave: (url: string, json: string) => ipcRenderer.invoke('notes:flow:save', url, json),
  notesFlowLoad: (url: string) => ipcRenderer.invoke('notes:flow:load', url),
  notesMediaDirGet: () => ipcRenderer.invoke('notes:media:dir:get'),
  notesMediaDirSet: (dir: string) => ipcRenderer.invoke('notes:media:dir:set', dir),
  notesMediaDirPick: (current?: string) => ipcRenderer.invoke('notes:media:dir:pick', current),
  notesMediaRemove: (url: string) => ipcRenderer.invoke('notes:media:remove', url),

  // ---- 便签同步 ----
  notesOpenTrack: (stickyId: string) => ipcRenderer.invoke('notes:openTrack', stickyId),
  notesTakeTrackFocus: () => ipcRenderer.invoke('notes:takeTrackFocus'),
  stickyGet: () => ipcRenderer.invoke('notes:sticky:get'),
  stickySetStatus: (id: string, status: string) => ipcRenderer.invoke('notes:sticky:status', id, status),
  stickyAdd: (item: { id?: string; text: string; status?: string; at?: number }) =>
    ipcRenderer.invoke('notes:sticky:add', item),
  stickySync: (payload: { items: any[]; managedIds: string[] }) =>
    ipcRenderer.invoke('notes:sticky:sync', payload),

  // ---- AI（对话 / 转写都由主进程持有密钥并发请求）----
  notesAIGetConfig: () => ipcRenderer.invoke('notes:ai:getConfig'),
  notesAISetConfig: (cfg: any) => ipcRenderer.invoke('notes:ai:setConfig', cfg),
  notesAIChat: (messages: any[], opts?: any) => ipcRenderer.invoke('notes:ai:chat', messages, opts),
  notesASR: (dataUrl: string, mime?: string) => ipcRenderer.invoke('notes:asr', dataUrl, mime),

  // ---- 办公网识别 / 生成（内网 AI 工作台：剪贴板接力，主进程只收发 data:image 与纯文本）----
  notesOfficePrepare: (dataUrl: string) => ipcRenderer.invoke('notes:office:prepare', dataUrl),
  notesOfficeRead: () => ipcRenderer.invoke('notes:office:read'),
  /* 文本版：提示词进剪贴板 + 唤窗，结果从剪贴板取回（生成总结用） */
  notesOfficePrepareText: (text: string) => ipcRenderer.invoke('notes:office:prepareText', text),
  notesOfficeReadText: () => ipcRenderer.invoke('notes:office:readText'),
  notesOfficeOpen: () => ipcRenderer.invoke('notes:office:open'),
  notesOfficeUrl: () => ipcRenderer.invoke('notes:office:url'),
  /* 自动执行：图片/文本/文件 注入工作台并自动读取回复（失败降级手动接力） */
  notesOfficeAuto: (prep: any, siteOverride?: any, opts?: any) =>
    ipcRenderer.invoke('notes:office:auto', prep, siteOverride, opts),
  notesOfficeAutoCancel: () => ipcRenderer.invoke('notes:office:autoCancel'),
  notesOfficeGetSite: () => ipcRenderer.invoke('notes:office:getSite'),
  notesOfficeSetSite: (patch: any) => ipcRenderer.invoke('notes:office:setSite', patch),

  // ---- 事件 ----
  on: (channel: string, cb: (...args: any[]) => void) => {
    if (!CHANNELS_OUT.has(channel)) return () => { /* 未登记的通道直接忽略 */ };
    const listener = (_e: any, ...args: any[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('electronAPI', api);
