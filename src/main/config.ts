import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../shared/types';
import { DEFAULT_WIDGETS, DEFAULT_THEME } from '../shared/defaults';
import { cloneDefaultCategories, normalizeCategories } from '../shared/categories';

let _configDir: string | null = null;
function configDir(): string {
  if (_configDir === null) _configDir = app.getPath('userData');
  return _configDir;
}
function configPath(): string {
  return join(configDir(), 'config.json');
}

export const DEFAULT_CONFIG: AppConfig = {
  version: 3,
  fences: [],
  widgets: DEFAULT_WIDGETS,
  wallpaper: {
    schedule: { enabled: false, intervalMin: 30, random: true, dir: '' },
    lastWallpaper: '',
    mode: 'fill'
  },
  theme: DEFAULT_THEME,
  categories: cloneDefaultCategories(),
  organized: false,
  settings: {
    autoOrganizeOnStart: false,
    hideIconsOnStart: false,
    sysIconsHidden: false,
    loginItem: false,
    alwaysInteractive: false,
    /** Toolbar starts tucked away; users can expand it with the pill button. */
    toolbarCollapsed: true
  }
};

function deepMerge<T>(base: T, patch: any): T {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return (patch as T) ?? base;
  }
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const k of Object.keys(patch)) {
    const bv = (base as any)[k];
    const pv = patch[k];
    if (
      bv &&
      typeof bv === 'object' &&
      !Array.isArray(bv) &&
      pv &&
      typeof pv === 'object' &&
      !Array.isArray(pv)
    ) {
      out[k] = deepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

export function loadConfig(): AppConfig {
  try {
    if (existsSync(configPath())) {
      const raw = JSON.parse(readFileSync(configPath(), 'utf-8'));
      const cfg = deepMerge(DEFAULT_CONFIG, raw);
      // Rule lists come from disk / the UI, so always repair them: this adds
      // categories introduced by a newer version and keeps 其他 last.
      cfg.categories = normalizeCategories(cfg.categories);

      // The countdown widget was removed from the product.
      if (cfg.widgets && 'countdown' in (cfg.widgets as any)) {
        delete (cfg.widgets as any).countdown;
      }

      // The note widget used to be one plain-text blob. It is now a list of
      // entries with a status each; keep whatever the user had typed.
      const note: any = (cfg.widgets as any)?.note;
      if (note) {
        if (!Array.isArray(note.items)) note.items = [];
        const legacy = typeof note.text === 'string' ? note.text.trim() : '';
        if (legacy && legacy !== '双击编辑便签…') {
          const keep = note.items.filter(
            (it: any) => it && !['n1', 'n2', 'n3'].includes(it.id)
          );
          note.items = [
            { id: `legacy-${Date.now()}`, text: legacy, status: 'todo', at: Date.now() },
            ...keep
          ];
        }
        if ('text' in note) delete note.text;
        if (legacy) saveConfig(cfg);
      }

      // v2 -> v3: fences used to be one-window-per-category. Reset them so the
      // renderer rebuilds a single window with category tabs instead of
      // restoring a pile of single-category windows.
      if (Number(raw.version ?? 0) < 3) {
        cfg.version = 3;
        cfg.fences = [];
        saveConfig(cfg);
      }

      return cfg;
    }
  } catch (e) {
    console.error('[config] load failed', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export function saveConfig(cfg: AppConfig): void {
  try {
    if (!existsSync(configDir())) mkdirSync(configDir(), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('[config] save failed', e);
  }
}

export function patchConfig(patch: Partial<AppConfig>): AppConfig {
  const next = deepMerge(loadConfig(), patch);
  if (patch && 'categories' in patch) next.categories = normalizeCategories(next.categories);
  saveConfig(next);
  return next;
}
