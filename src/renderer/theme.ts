/** 主题落地：把配置里的面板色 / 强调色应用到 <html> 上。
 *  desktop 和 finder 两个窗口共用，保证面板观感一致。 */

export type ThemeLike = {
  preset?: string;
  accent?: string;
  panelBg?: string;
  panelOpacity?: number;
  blur?: boolean;
};

/**
 * 把主题面板色和不透明度合成一个 rgba。面板背景要单独带 alpha，
 * 而不是给整块元素设 opacity：后者会连标题、正文一起变成半透明，
 * 浅色主题下正文就成了「灰底上的灰黑字」。
 */
export function withAlpha(color: string, alpha: number): string {
  const c = String(color || '').trim();
  let r = 20;
  let g = 22;
  let b = 30;
  let a = 1;
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const full = hex.length === 3 || hex.length === 4
      ? hex.split('').map((ch) => ch + ch).join('')
      : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
    if (full.length >= 8) a = parseInt(full.slice(6, 8), 16) / 255;
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(/[,/]/).map((p) => p.trim());
      r = parseFloat(parts[0] ?? '0');
      g = parseFloat(parts[1] ?? '0');
      b = parseFloat(parts[2] ?? '0');
      if (parts[3]) a = parts[3].includes('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    }
  }
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const fix = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
  return `rgba(${fix(r)}, ${fix(g)}, ${fix(b)}, ${clamp(a * alpha, 0, 1).toFixed(3)})`;
}

export function applyTheme(theme: ThemeLike | null | undefined): void {
  const t = theme || {};
  const r = document.documentElement;
  r.dataset.theme = t.preset ?? 'dark';
  if (t.accent) r.style.setProperty('--accent', t.accent);
  if (t.panelBg) r.style.setProperty('--panel-bg', t.panelBg);
  const op = typeof t.panelOpacity === 'number' ? t.panelOpacity : 1;
  r.style.setProperty('--panel-opacity', String(op));
  r.style.setProperty('--panel-bg-a', withAlpha(t.panelBg || '#0d0f14', op));
  r.style.setProperty('--blur', t.blur ? 'blur(8px)' : 'none');
}
