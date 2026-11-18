/* ═══════════════════════════════════════════════════
   桌面管家 ⇄ 笔记 桥接层
   · 在 Electron 中由 preload 注入 window.electronAPI
   · 纯浏览器打开时自动降级（localStorage + 直连 API）
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const api = global.electronAPI;
  const inShell = !!(api && typeof api.notesLoad === 'function');

  const Bridge = {
    /** true 表示运行在桌面管家的笔记窗口里（数据落盘到 notes.json） */
    inShell,

    /**
     * 读取 notes.json。
     * 返回 { state }（正常）、{ corrupt, error }（文件损坏）或 null（非壳环境 / 无文件）。
     * 损坏信息必须传给上层：绝不能让上层把示例数据当“首次运行”写回覆盖原文件。
     */
    async loadState() {
      if (!inShell) return null;
      try {
        const raw = await api.notesLoad();
        if (!raw) return null;
        if (typeof raw === 'string') {
          /* 兼容旧主进程（直接返回字符串） */
          return { state: JSON.parse(raw) };
        }
        if (raw.corrupt) return { corrupt: true, error: raw.error || '' };
        if (typeof raw.raw === 'string') return { state: JSON.parse(raw.raw) };
        return null;
      } catch (e) {
        /* JSON 解析失败同样按损坏处理 */
        console.warn('[bridge] 读取笔记失败', e);
        return { corrupt: true, error: String((e && e.message) || e) };
      }
    },

    /** 主进程返回 { ok, error }；任何形式的失败都返回 false，调用方负责兜底 */
    async saveState(json) {
      if (!inShell) return false;
      try {
        const r = await api.notesSave(json);
        return !!r && r.ok !== false;
      } catch (e) {
        console.warn('[bridge] 保存笔记失败', e);
        return false;
      }
    },

    /* ── 便签 ── */
    async getSticky() {
      if (!inShell) return null;
      try {
        return await api.stickyGet();
      } catch (e) {
        return null;
      }
    },

    async setStickyStatus(id, status) {
      if (!inShell) return null;
      try {
        return await api.stickySetStatus(id, status);
      } catch (e) {
        return null;
      }
    },

    /** 笔记里新建待办 → 追加到桌面便签列表 */
    async addSticky(item) {
      if (!inShell || typeof api.stickyAdd !== 'function') return null;
      try {
        return await api.stickyAdd(item);
      } catch (e) {
        console.warn('[bridge] 写入便签失败', e);
        return null;
      }
    },

    /** 用笔记里的待办列表整体校准桌面便签（items 为全部未完成待办） */
    async syncSticky(payload) {
      if (!inShell || typeof api.stickySync !== 'function') return null;
      try {
        return await api.stickySync(payload);
      } catch (e) {
        console.warn('[bridge] 校准便签失败', e);
        return null;
      }
    },

    onStickyChanged(cb) {
      if (!inShell || typeof api.on !== 'function') return () => {};
      return api.on('notes:sticky', (items) => cb(items));
    },

    /** 桌面便签点「详情」时，主进程把便签 id 发过来 */
    onTrackFocus(cb) {
      if (!inShell || typeof api.on !== 'function') return () => {};
      return api.on('notes:focusTrack', (payload) => cb(payload));
    },

    /** 窗口刚启动时取一次挂起的跳转（避免消息在脚本注册前丢失） */
    async takeTrackFocus() {
      if (!inShell || typeof api.notesTakeTrackFocus !== 'function') return null;
      try {
        return await api.notesTakeTrackFocus();
      } catch (e) {
        return null;
      }
    },

    /* ── AI ── */
    async getAIConfig() {
      if (!inShell) return null;
      try {
        return await api.notesAIGetConfig();
      } catch (e) {
        return null;
      }
    },

    async setAIConfig(cfg) {
      if (!inShell) return false;
      try {
        await api.notesAISetConfig(cfg);
        return true;
      } catch (e) {
        return false;
      }
    },

    /** 统一走主进程请求，避免 CORS；浏览器模式由 ai.js 自行 fetch */
    async chat(messages, opts) {
      if (!inShell) return null;
      return api.notesAIChat(messages, opts || {});
    },

    /** 保存粘贴的图片，返回可直接放进 markdown 的 URL */
    async saveImage(dataUrl) {
      if (!inShell) return null;
      try {
        return await api.notesSaveImage(dataUrl);
      } catch (e) {
        console.warn('[bridge] 图片保存失败', e);
        return null;
      }
    },

    /** 保存手写图片 / 语音录音等附件（比塞进笔记正文更省空间） */
    async saveMedia(dataUrl) {
      if (!inShell) return null;
      try {
        if (typeof api.notesSaveMedia === 'function') return await api.notesSaveMedia(dataUrl);
        return await api.notesSaveImage(dataUrl);
      } catch (e) {
        console.warn('[bridge] 附件保存失败', e);
        return null;
      }
    },

    /** 附件（图片 / 录音 / 手写）保存目录 */
    async mediaDir() {
      if (!inShell || typeof api.notesMediaDirGet !== 'function') return '';
      try {
        return await api.notesMediaDirGet();
      } catch (e) {
        return '';
      }
    },

    /** 设置附件目录；传空字符串恢复默认 */
    async setMediaDir(dir) {
      if (!inShell || typeof api.notesMediaDirSet !== 'function') return '';
      return await api.notesMediaDirSet(dir);
    },

    /** 弹系统目录选择框，返回生效后的目录；取消返回 null */
    async pickMediaDir(current) {
      if (!inShell || typeof api.notesMediaDirPick !== 'function') return null;
      return await api.notesMediaDirPick(current);
    },

    /** 删掉一个刚写入的附件（例如用户丢弃了这段录音） */
    async removeMedia(url) {
      if (!inShell || typeof api.notesMediaRemove !== 'function') return false;
      try {
        return await api.notesMediaRemove(url);
      } catch (e) {
        return false;
      }
    },

    /** 流程图连线数据 sidecar：存 / 读（图片同名 .flow.json） */
    async saveFlow(url, json) {
      if (!inShell || typeof api.notesFlowSave !== 'function') return false;
      try {
        return await api.notesFlowSave(url, json);
      } catch (e) {
        return false;
      }
    },

    async loadFlow(url) {
      if (!inShell || typeof api.notesFlowLoad !== 'function') return null;
      try {
        return await api.notesFlowLoad(url);
      } catch (e) {
        return null;
      }
    },

    /** 语音转文字（ASR）：交给主进程发 multipart，避开 CORS */
    async transcribe(dataUrl, mime) {
      if (!inShell || typeof api.notesASR !== 'function') return null;
      try {
        return await api.notesASR(dataUrl, mime);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /* ── 办公网识别（内网 AI 工作台）── */

    /** 是否支持办公网识别（只有桌面管家的笔记窗口里才有） */
    officeSupported() {
      return inShell && typeof api.notesOfficePrepare === 'function';
    },

    /** 图片复制到剪贴板并唤起工作台窗口，返回 { ok, url?, error? } */
    async officePrepare(dataUrl) {
      if (!inShell || typeof api.notesOfficePrepare !== 'function') {
        return { ok: false, error: '当前环境不支持办公网识别' };
      }
      try {
        return await api.notesOfficePrepare(dataUrl);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 识别完成后读剪贴板文本，返回 { ok, text?, error? } */
    async officeRead() {
      if (!inShell || typeof api.notesOfficeRead !== 'function') {
        return { ok: false, error: '当前环境不支持办公网识别' };
      }
      try {
        return await api.notesOfficeRead();
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 直接唤起工作台窗口（不复制图片），返回 { ok, url? } */
    async officeOpen() {
      if (!inShell || typeof api.notesOfficeOpen !== 'function') return { ok: false };
      try {
        return await api.notesOfficeOpen();
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 当前配置的工作台地址 */
    async officeUrl() {
      if (!inShell || typeof api.notesOfficeUrl !== 'function') return '';
      try {
        return String(await api.notesOfficeUrl() || '');
      } catch (e) {
        return '';
      }
    },

    /** 是否支持「办公网生成」（文本版剪贴板接力） */
    officeTextSupported() {
      return inShell && typeof api.notesOfficePrepareText === 'function';
    },

    /**
     * 生成总结用：把提示词复制到剪贴板并唤起工作台。
     * 返回 { ok, url?, error? }；网络不通时主进程已弹窗说明并关窗。
     */
    async officeCopy(text) {
      if (!inShell || typeof api.notesOfficePrepareText !== 'function') {
        return { ok: false, error: '当前环境不支持办公网生成' };
      }
      try {
        return await api.notesOfficePrepareText(text);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 生成完成后读剪贴板里的总结正文，返回 { ok, text?, error? } */
    async officeReadText() {
      if (!inShell || typeof api.notesOfficeReadText !== 'function') {
        return { ok: false, error: '当前环境不支持办公网生成' };
      }
      try {
        return await api.notesOfficeReadText();
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 是否支持自动执行（粘贴→发送→读回复全自动） */
    officeAutoSupported() {
      return inShell && typeof api.notesOfficeAuto === 'function';
    },

    /**
     * 自动执行一次办公网任务。
     * prep: { type:'image', dataUrl } | { type:'text', text } | { type:'file', dataUrl, mime, name, prompt? }
     * 返回 { ok:true, text, via } 或 { ok:false, error, manual? } —— manual=true 表示已降级手动接力。
     */
    async officeAuto(prep, siteOverride, opts) {
      if (!inShell || typeof api.notesOfficeAuto !== 'function') {
        return { ok: false, error: '当前环境不支持办公网自动执行' };
      }
      try {
        return await api.notesOfficeAuto(prep, siteOverride, opts);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 取消正在进行的自动执行（窗口保留，转手动接力） */
    async officeAutoCancel() {
      if (!inShell || typeof api.notesOfficeAutoCancel !== 'function') return false;
      try {
        return !!await api.notesOfficeAutoCancel();
      } catch (e) {
        return false;
      }
    },

    /** 读 / 写站点适配器（输入框、发送按钮、回复区的 CSS 选择器等） */
    async officeGetSite() {
      if (!inShell || typeof api.notesOfficeGetSite !== 'function') return null;
      try {
        return await api.notesOfficeGetSite();
      } catch (e) {
        return null;
      }
    },

    /** 关闭办公网工作台窗口（结果回填成功后调用；失败路径保持打开） */
    officeClose() {
      if (!inShell || typeof api.notesOfficeClose !== 'function') return;
      try { void api.notesOfficeClose(); } catch (e) { /* ignore */ }
    },
    async officeSetSite(patch) {
      if (!inShell || typeof api.notesOfficeSetSite !== 'function') {
        return { ok: false, error: '当前环境不支持' };
      }
      try {
        return await api.notesOfficeSetSite(patch);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 桌面「随手记」：主进程要求回到首页 */
    onHome(cb) {
      if (!inShell || typeof api.on !== 'function') return () => {};
      if (typeof api.notesHome === 'function') return api.notesHome(cb);
      return api.on('notes:home', () => cb());
    },

    /** 窗口被再次唤起：主进程要求把焦点交回正文 */
    onFocusEdit(cb) {
      if (!inShell || typeof api.on !== 'function') return () => {};
      if (typeof api.notesFocusEdit === 'function') return api.notesFocusEdit(cb);
      return api.on('notes:focusEdit', () => cb());
    },

    openNotes() {
      if (inShell) api.notesOpen();
    }
  };

  global.NoteBridge = Bridge;
})(window);
