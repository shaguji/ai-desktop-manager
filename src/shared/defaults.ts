import type { WidgetState, ThemeConfig, ThemePreset } from './types';

/** 收纳窗口的默认标题；旧版本叫「桌面收纳」，加载配置时统一迁移过来。 */
export const FENCE_TITLE = '收你没商量';
export const LEGACY_FENCE_TITLE = '桌面收纳';

/** panelBg recommended for each preset (users can still override it). */
export const PRESET_PANEL_BG: Record<ThemePreset, string> = {
  dark: '#1e2030',
  light: '#f4f6fa',
  midnight: '#182144',
  forest: '#1b2f28'
};

export const DEFAULT_THEME: ThemeConfig = {
  preset: 'dark',
  accent: '#4f8cff',
  panelBg: PRESET_PANEL_BG.dark,
  panelOpacity: 0.82,
  blur: true
};

export const DEFAULT_WIDGETS: WidgetState = {
  clock: { enabled: true, x: 24, y: 24 },
  calendar: { enabled: false, x: 24, y: 220 },
  note: {
    enabled: true,
    x: -320,
    y: 24,
    // A few starter lines so the status colours are discoverable; they are
    // plain entries the user can edit or delete.
    items: [
      { id: 'n1', text: '点文字可直接修改', status: 'todo', at: 0 },
      { id: 'n2', text: '点左侧圆点切换状态', status: 'doing', at: 0 },
      { id: 'n3', text: '完成后自动变绿并划掉', status: 'done', at: 0 }
    ]
  }
};
