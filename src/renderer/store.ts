import { create } from 'zustand';
import type {
  AlarmItem,
  AppConfig,
  AppSettings,
  CategoryKey,
  CategoryRule,
  FenceLayout,
  NoteItem,
  ScanResult,
  WidgetState,
  ThemeConfig
} from '../shared/types';
import { DEFAULT_WIDGETS, DEFAULT_THEME, FENCE_TITLE, LEGACY_FENCE_TITLE } from '../shared/defaults';
import { cloneDefaultCategories, normalizeCategories, OTHER_KEY, tabRank } from '../shared/categories';
import {
  buildTodoAlarm,
  findTodoAlarm,
  reconcileTodoAlarms,
  remindWhenLabel,
  type ReminderPlan
} from '../shared/reminder';
import { api } from './api';
import { startRingtone, stopRingtone } from './ringtone';

const DEFAULT_SETTINGS: AppSettings = {
  autoOrganizeOnStart: false,
  hideIconsOnStart: false,
  sysIconsHidden: false,
  loginItem: false,
  alwaysInteractive: false,
  toolbarCollapsed: true
};

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

/** The alarm currently going off (drives the overlay + flashing clock panel). */
export interface RingingAlarm {
  alarm: AlarmItem;
  at: number;
}

interface State {
  mode: 'desktop' | 'settings';
  scan: ScanResult | null;
  fences: FenceLayout[];
  widgets: WidgetState;
  theme: ThemeConfig;
  categories: CategoryRule[];
  settings: AppSettings;
  icons: Record<string, string>;
  iconsHidden: boolean;
  toasts: Toast[];
  ringing: RingingAlarm | null;

  init: () => Promise<void>;
  setMode: (m: 'desktop' | 'settings') => void;
  applyConfig: (cfg: AppConfig) => void;
  refreshScan: () => Promise<void>;
  applyOrganize: (incremental?: boolean) => Promise<void>;
  undoOrganize: () => Promise<void>;
  updateFence: (id: string, patch: Partial<FenceLayout>) => void;
  addFence: (categories: CategoryKey[], title: string) => void;
  removeFence: (id: string) => void;
  updateWidgets: (patch: Partial<WidgetState>) => void;
  /** 保存便签事项，并同步校正关联的提醒（改文案 / 完成 / 删除）。 */
  saveNotes: (items: NoteItem[]) => void;
  /** 给某条待办设置（或修改）提醒时间。 */
  setTodoReminder: (todoId: string, plan: ReminderPlan) => void;
  clearTodoReminder: (todoId: string) => void;
  /** 响铃时直接标记完成：待办变绿，提醒同时撤掉。 */
  completeTodo: (todoId: string) => void;
  updateTheme: (patch: Partial<ThemeConfig>) => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  updateCategories: (rules: CategoryRule[]) => Promise<void>;
  resetCategories: () => Promise<void>;
  toggleIcons: () => Promise<void>;
  getIcon: (p: string, size?: number) => Promise<string>;
  /** Persist the clock's alarm list. */
  updateAlarms: (alarms: AlarmItem[], extra?: { alarmSound?: boolean }) => void;
  ringAlarm: (alarm: AlarmItem) => void;
  stopRinging: () => void;
  snoozeRinging: (minutes?: number) => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
  dismissToast: (id: number) => void;
}

let fenceSeq = 1;
let toastSeq = 1;

/** 旧版「移动文件」数据只提醒一次，避免每次扫描都弹。 */
let legacyNoticeShown = false;

/** Window geometry for the single收纳 window (wide enough for a tab strip). */
const FENCE_W = 430;
const FENCE_H = 340;

/**
 * Build the default layout: ONE window carrying every non-empty category as a
 * tab. Previously this produced one window per category, which buried the
 * desktop under a wall of small panels.
 */
function layoutFences(rules: CategoryRule[], scan: ScanResult | null): FenceLayout[] {
  // Only an organised desktop has content inside the fence — before that the
  // window is an empty shell waiting for 一键整理.
  const nonEmpty = scan?.organized
    ? (scan.categories ?? []).filter((c) => c.items.length > 0).map((c) => c.key)
    : [];
  const enabled = rules.filter((r) => r.enabled);
  // Prefer categories that actually have files; otherwise keep a few tabs so
  // the window is not empty on a clean desktop.
  const tabs =
    nonEmpty.length > 0
      ? nonEmpty
      : enabled.filter((r) => r.key !== OTHER_KEY).slice(0, 4).map((r) => r.key);
  if (tabs.length === 0) return [];
  return [
    {
      id: 'f' + fenceSeq++,
      title: FENCE_TITLE,
      categories: tabs,
      active: tabs[0],
      x: 24,
      y: 24,
      width: FENCE_W,
      height: FENCE_H,
      collapsed: false
    }
  ];
}

/**
 * Repair fences loaded from disk. Handles the v2 shape (`category: 'document'`,
 * one window per category) by folding all of them into a single window whose
 * tabs are the union of their categories — so upgrading does not leave the user
 * with a dozen windows.
 */
function normalizeFences(raw: any): FenceLayout[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .filter((f) => f && typeof f === 'object')
    .map((f) => {
      let cats: CategoryKey[] = [];
      if (Array.isArray(f.categories)) {
        cats = f.categories.filter((k: any) => typeof k === 'string' && k.length > 0);
      } else if (typeof f.category === 'string' && f.category !== 'custom') {
        cats = [f.category];
      }
      // Keep a single occurrence per category and enforce the canonical tab
      // order (系统 → 应用程序 → 文件夹 → 文件 …), even for layouts that were
      // saved before the order was fixed.
      cats = Array.from(new Set(cats)).sort((a, b) => tabRank(a) - tabRank(b));
      const active =
        typeof f.active === 'string' && cats.includes(f.active) ? f.active : cats[0];
      return {
        id: String(f.id ?? 'f' + fenceSeq++),
        /* 旧配置里叫「桌面收纳」的统一迁移；用户自定义过的标题原样保留 */
        title: (() => {
          const t = String(f.title ?? FENCE_TITLE);
          return t === LEGACY_FENCE_TITLE ? FENCE_TITLE : t;
        })(),
        categories: cats,
        active,
        x: Number.isFinite(f.x) ? Number(f.x) : 24,
        y: Number.isFinite(f.y) ? Number(f.y) : 24,
        width: Number.isFinite(f.width) && f.width > 200 ? Number(f.width) : FENCE_W,
        height: Number.isFinite(f.height) && f.height > 160 ? Number(f.height) : FENCE_H,
        collapsed: !!f.collapsed
      } as FenceLayout;
    });

  if (parsed.length === 0) return [];

  // Fold legacy multi-window layouts into one window with all tabs merged.
  const isLegacy = parsed.length > 1 && parsed.every((f) => f.categories.length <= 1);
  if (isLegacy) {
    const merged: CategoryKey[] = [];
    for (const f of parsed) {
      for (const k of f.categories) if (!merged.includes(k)) merged.push(k);
    }
    const first = parsed[0];
    return [
      {
        ...first,
        id: first.id,
        title: FENCE_TITLE,
        categories: merged,
        active: merged[0],
        width: Math.max(first.width, FENCE_W),
        height: Math.max(first.height, FENCE_H)
      }
    ];
  }

  return parsed;
}

export const useStore = create<State>()((set, get) => ({
  mode: location.hash === '#settings' ? 'settings' : 'desktop',
  scan: null,
  fences: [],
  widgets: JSON.parse(JSON.stringify(DEFAULT_WIDGETS)),
  theme: { ...DEFAULT_THEME },
  categories: cloneDefaultCategories(),
  settings: { ...DEFAULT_SETTINGS },
  icons: {},
  iconsHidden: false,
  toasts: [],
  ringing: null,

  async init() {
    try {
      const cfg: AppConfig = await api.getConfig();
      get().applyConfig(cfg);
    } catch (e) {
      get().notify('读取配置失败：' + String(e), 'error');
    }
    try {
      set({ iconsHidden: await api.isIconsHidden() });
    } catch {
      /* non-Windows or FFI unavailable */
    }
    await get().refreshScan();

    if (get().fences.length === 0) {
      const fences = layoutFences(get().categories, get().scan);
      if (fences.length) {
        set({ fences });
        await api.setConfig({ fences });
      }
    }
  },

  setMode(m) {
    set({ mode: m });
  },

  applyConfig(cfg) {
    const categories = normalizeCategories(cfg.categories);
    /* v5 merge: drop tabs whose category no longer exists (图片/视频/… folded
       into 文件), and drop windows left with no tab at all. */
    const keys = new Set(categories.map((c) => c.key));
    const fences = normalizeFences(cfg.fences)
      .map((f) => ({ ...f, categories: f.categories.filter((k) => keys.has(k)) }))
      .filter((f) => f.categories.length > 0)
      .map((f) => ({
        ...f,
        active: f.active && f.categories.includes(f.active) ? f.active : f.categories[0]
      }));
    set({
      fences,
      widgets: cfg.widgets ?? get().widgets,
      theme: cfg.theme ?? get().theme,
      categories,
      settings: { ...DEFAULT_SETTINGS, ...(cfg.settings ?? {}) }
    });
  },

  async refreshScan() {
    try {
      // Plain scan only. Auto-filing lives in applyOrganize / app start —
      // doing it here used to re-enter itself through the organizer:changed
      // broadcast (applyOrganize → scan → applyOrganize → …).
      const scan = await api.scan();
      set({ scan });
      /* 之前整理移动过的文件（旧版整理或归属目录规则）：提示一次 */
      if (scan.legacy && !legacyNoticeShown) {
        legacyNoticeShown = true;
        get().notify('检测到之前整理移动过的文件，点「还原文件」可放回原位置');
      }
      // Self-heal the fence window: an older 撤销整理 wiped it from the config
      // and the only way back was a restart. In organised mode the window is
      // the whole point, so bring it back.
      if (scan.organized && get().fences.length === 0) {
        const fences = layoutFences(get().categories, scan);
        if (fences.length) {
          set({ fences });
          await api.setConfig({ fences });
        }
      }
    } catch (e) {
      get().notify('扫描桌面失败：' + String(e), 'error');
    }
  },

  /**
   * 一键整理。incremental=true 用于「分组状态下整理新文件」：桌面新增的
   * 文件按规则增量移动/分组，不弹出「先还原旧移动」确认，已移走的文件不动。
   */
  async applyOrganize(incremental = false) {
    const r = await api.applyOrganize();
    if (!r?.ok) {
      get().notify('整理失败：' + (r?.error ?? '未知错误'), 'error');
      await get().refreshScan();
      return;
    }

    /* 之前整理确实移动过文件（旧版整理或归属目录规则）：先问一句要不要还原。
       还原后重新开启分组，保持桌面干净。增量整理（整理新文件）跳过此确认。 */
    let restored = 0;
    if (r.legacy && !incremental) {
      let yes = true;
      try {
        yes = window.confirm(
          '检测到之前一键整理移动过的桌面文件（旧版整理或归属目录规则）。\n\n' +
            '是否先把它们还原到原来的位置，再重新整理？\n' +
            '（选「取消」则保留现状，仅重新分组显示）'
        );
      } catch {
        /* 个别窗口环境下 confirm 不可用：默认还原，符合用户预期 */
        yes = true;
      }
      if (!yes) {
        await get().refreshScan();
        get().notify('保持现状：文件仍在「整理」文件夹里，随时可点「撤销整理」还原');
        return;
      }
      const u = await api.undoOrganize();
      restored = u?.restored ?? 0;
      await api.applyOrganize();
    }

    // 分组显示后桌面由收纳窗口接管，系统图标隐藏，避免同一个人看到两份。
    if (!get().iconsHidden) {
      try {
        const res = await api.hideIcons();
        if (res.ok) set({ iconsHidden: true });
      } catch {
        /* best effort */
      }
    }
    await get().refreshScan();
    if (get().fences.length === 0) {
      const fences = layoutFences(get().categories, get().scan);
      if (fences.length) {
        set({ fences });
        await api.setConfig({ fences });
      }
    }
    get().notify(
      incremental
        ? r.moved > 0
          ? `已整理新文件：${r.moved} 个移动到归属目录` +
            (r.blocked > 0 ? `，${r.blocked} 个失败（可能被占用）` : '') +
            '，点「还原文件」可移回原位置'
          : r.blocked > 0
            ? `${r.blocked} 个新文件移动归属目录失败（可能被占用）`
            : '桌面上没有命中移动规则的新文件'
        : restored > 0
          ? `已把 ${restored} 个项目还原到原位置，并按分类分组显示`
          : r.moved > 0
            ? `已按分类分组显示；${r.moved} 个文件已移动到归属目录` +
              (r.blocked > 0 ? `，${r.blocked} 个移动失败（可能被占用）` : '') +
              '，点「还原文件」可移回原位置'
            : r.blocked > 0
              ? `已按分类分组显示；${r.blocked} 个文件移动归属目录失败（可能被占用）`
              : '已按分类分组显示，文件仍在原来的位置'
    );
  },

  async undoOrganize() {
    const r = await api.undoOrganize();
    if (!r?.ok) {
      get().notify('撤销失败：无法退出分组显示', 'error');
      return;
    }
    // 退出分组：系统桌面图标回来，收纳窗口清空；文件本来就没动过，
    // 旧版收纳的文件在这一步还原到原来的路径。
    try {
      const res = await api.showIcons();
      if (res.ok) set({ iconsHidden: false });
    } catch {
      /* best effort */
    }
    try {
      const ok = await api.setSysIconsHidden(false);
      if (ok) await get().updateSettings({ sysIconsHidden: false });
    } catch {
      /* non-Windows */
    }
    // Give the shell a beat to settle before re-reading the desktop, so the
    // fence does not pick up a half-restored state.
    await new Promise((res) => setTimeout(res, 450));
    await get().refreshScan();
    if (r.restored > 0) {
      get().notify(
        r.blocked
          ? `已还原 ${r.restored} 个项目，${r.blocked} 个被占用未能还原`
          : `已还原 ${r.restored} 个项目到原来的位置，桌面图标已恢复`
      );
    } else {
      get().notify('已退出分组显示，桌面图标已恢复（文件始终在原位置，未做移动）');
    }
  },

  updateFence(id, patch) {
    const fences = get().fences.map((f) => (f.id === id ? { ...f, ...patch } : f));
    set({ fences });
    void api.setConfig({ fences });
  },

  addFence(categories, title) {
    const cats = categories.filter((k) => typeof k === 'string' && k.length > 0);
    const f: FenceLayout = {
      id: 'f' + fenceSeq++,
      title: title || FENCE_TITLE,
      categories: cats,
      active: cats[0],
      x: 24,
      y: 24,
      width: FENCE_W,
      height: FENCE_H,
      collapsed: false
    };
    const fences = [...get().fences, f];
    set({ fences });
    void api.setConfig({ fences });
    get().notify(`已添加收纳窗口「${f.title}」`);
  },

  removeFence(id) {
    const fences = get().fences.filter((f) => f.id !== id);
    set({ fences });
    void api.setConfig({ fences });
  },

  updateWidgets(patch) {
    const widgets = { ...get().widgets, ...patch } as WidgetState;
    set({ widgets });
    void api.setWidgets(widgets);
  },

  updateAlarms(alarms, extra) {
    const clock = { ...get().widgets.clock, ...extra, alarms };
    get().updateWidgets({ clock });
  },

  saveNotes(items) {
    const note = { ...get().widgets.note, items };
    const clock = get().widgets.clock;
    const rec = reconcileTodoAlarms(clock.alarms, items);
    if (rec.changed) {
      get().updateWidgets({ note, clock: { ...clock, alarms: rec.alarms } });
    } else {
      get().updateWidgets({ note });
    }
  },

  setTodoReminder(todoId, plan) {
    const note = get().widgets.note;
    const item = (note.items ?? []).find((i) => i.id === todoId);
    if (!item) return;
    const clock = get().widgets.clock;
    const alarms = clock.alarms ?? [];
    const existing = findTodoAlarm(alarms, todoId);
    const next = buildTodoAlarm(item, plan, existing);
    const list = existing
      ? alarms.map((a) => (a.todoId === todoId ? next : a))
      : [...alarms, next];
    get().updateWidgets({ clock: { ...clock, alarms: list } });
    get().notify(`「${item.text.trim() || '待办'}」提醒：${remindWhenLabel(next)}`);
  },

  clearTodoReminder(todoId) {
    const clock = get().widgets.clock;
    const alarms = clock.alarms ?? [];
    if (!alarms.some((a) => a.todoId === todoId)) return;
    get().updateWidgets({
      clock: { ...clock, alarms: alarms.filter((a) => a.todoId !== todoId) }
    });
    get().notify('已取消这条待办的提醒');
  },

  completeTodo(todoId) {
    const note = get().widgets.note;
    const items = note.items ?? [];
    const item = items.find((i) => i.id === todoId);
    if (!item) return;
    const nextItems = items.map((i) => (i.id === todoId ? { ...i, status: 'done' as const } : i));
    const clock = get().widgets.clock;
    const rec = reconcileTodoAlarms(clock.alarms, nextItems);
    // 先停铃再写配置：updateWidgets 会触发一次落盘，顺序反了会短暂出现「响铃中但提醒已删」。
    if (get().ringing?.alarm.todoId === todoId) get().stopRinging();
    get().updateWidgets({
      note: { ...note, items: nextItems },
      clock: { ...clock, alarms: rec.alarms }
    });
    get().notify(`已完成「${item.text.trim() || '待办'}」`);
  },

  ringAlarm(alarm) {
    set({ ringing: { alarm, at: Date.now() } });
    if (get().widgets.clock.alarmSound !== false) startRingtone();
    // A transparent desktop layer is easy to miss when another window is in
    // front, so also raise a real Windows notification.
    const isTodo = !!alarm.todoId;
    void api.notifyDesktop(
      isTodo ? `待办提醒 ${alarm.time}` : `闹铃 ${alarm.time}`,
      isTodo
        ? alarm.label || '该处理这条待办了'
        : alarm.label
          ? `${alarm.label} · 该起身了`
          : '闹铃时间到'
    );
  },

  stopRinging() {
    stopRingtone();
    set({ ringing: null });
  },

  snoozeRinging(minutes = 5) {
    const r = get().ringing;
    if (!r) return;
    const clock = get().widgets.clock;
    const alarms = (clock.alarms ?? []).map((a) =>
      a.id === r.alarm.id
        ? // Re-arm the one-shot alarm: the engine disabled it when it rang.
          { ...a, enabled: true, snoozeUntil: Date.now() + Math.max(1, minutes) * 60000 }
        : a
    );
    stopRingtone();
    set({ ringing: null });
    get().updateWidgets({ clock: { ...clock, alarms } });
    get().notify(`已稍后提醒，${minutes} 分钟后再响`);
  },

  updateTheme(patch) {
    const theme = { ...get().theme, ...patch };
    set({ theme });
    void api.setConfig({ theme });
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await api.setConfig({ settings });
  },

  async updateCategories(rules) {
    const categories = normalizeCategories(rules);
    set({ categories });
    await api.setConfig({ categories });
    await get().refreshScan();
  },

  async resetCategories() {
    await get().updateCategories(cloneDefaultCategories());
    get().notify('已恢复默认归类规则');
  },

  async toggleIcons() {
    const next = !get().iconsHidden;
    const result = next ? await api.hideIcons() : await api.showIcons();
    if (!result.ok) {
      get().notify(
        '切换系统桌面图标失败' + (result.error ? `：${result.error}` : '（需要 Windows）'),
        'error'
      );
      return;
    }
    set({ iconsHidden: next });
    // One switch for the whole desktop: hiding removes every icon including
    // 此电脑/回收站, showing brings all of them back — no second button needed.
    try {
      const ok = await api.setSysIconsHidden(next);
      if (ok) await get().updateSettings({ sysIconsHidden: next });
    } catch {
      /* cosmetic nicety, never block the toggle */
    }
    get().notify(next ? '已隐藏桌面全部图标' : '已恢复桌面图标');
  },

  async getIcon(p, size = 32) {
    const cached = get().icons[p];
    if (cached) return cached;
    try {
      const d = await api.getFileIcon(p, size);
      set((s) => ({ icons: { ...s.icons, [p]: d } }));
      return d;
    } catch {
      return '';
    }
  },

  notify(text, kind = 'info') {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    window.setTimeout(() => get().dismissToast(id), 3200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }
}));
