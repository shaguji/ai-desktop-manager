import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { CategoryKey, CategoryRule, TargetMapping, WallpaperMode, ThemePreset } from '../../shared/types';
import { nextCustomKey, OTHER_KEY } from '../../shared/categories';
import { PRESET_PANEL_BG, FENCE_TITLE, NOTE_TITLE } from '../../shared/defaults';

const THEME_PRESETS: Record<ThemePreset, { name: string; swatch1: string; swatch2: string }> = {
  dark: { name: '深空', swatch1: '#1e2030', swatch2: '#4f8cff' },
  light: { name: '晨雾', swatch1: '#f4f6fa', swatch2: '#dfe6f2' },
  midnight: { name: '午夜蓝', swatch1: '#10162b', swatch2: '#4a5fb0' },
  forest: { name: '松林', swatch1: '#12211c', swatch2: '#3d7a5f' }
};

const MODE_OPTIONS: { value: WallpaperMode; label: string }[] = [
  { value: 'fill', label: '填充' },
  { value: 'fit', label: '适应' },
  { value: 'stretch', label: '拉伸' },
  { value: 'tile', label: '平铺' },
  { value: 'center', label: '居中' }
];

/** 便签的一键尺寸（px）；不选就是按内容自适应。 */
const NOTE_SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '小', w: 240, h: 240 },
  { label: '中', w: 300, h: 360 },
  { label: '大', w: 420, h: 520 }
];

const listToText = (v?: string[]) => (v ?? []).join(', ');
const textToList = (s: string) =>
  s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 归类规则编辑器：内置分类可改名/停用，自定义分类可增删。 */
function migrateDraft(rules: CategoryRule[]): CategoryRule[] {
  // 旧版单映射（keywords + targetDir）→ 显式 mappings，编辑保存后写回新结构。
  return rules.map((r) =>
    !r.mappings && r.targetDir && (r.keywords?.length ?? 0) > 0
      ? { ...r, mappings: [{ keywords: r.keywords!, targetDir: r.targetDir }], targetDir: undefined }
      : r
  );
}

function CategoryEditor() {
  const categories = useStore((s) => s.categories);
  const updateCategories = useStore((s) => s.updateCategories);
  const resetCategories = useStore((s) => s.resetCategories);
  const notify = useStore((s) => s.notify);

  const [draft, setDraft] = useState<CategoryRule[]>(() => migrateDraft(categories));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(migrateDraft(categories));
  }, [categories, dirty]);

  const patch = (key: string, p: Partial<CategoryRule>) => {
    setDirty(true);
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };

  const patchMapping = (key: string, idx: number, p: Partial<TargetMapping>) => {
    setDirty(true);
    setDraft((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const maps = (r.mappings ?? []).map((m, i) => (i === idx ? { ...m, ...p } : m));
        return { ...r, mappings: maps };
      })
    );
  };

  const addMapping = (key: string) => {
    setDirty(true);
    setDraft((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, mappings: [...(r.mappings ?? []), { keywords: [], targetDir: '' }] } : r
      )
    );
  };

  const delMapping = (key: string, idx: number) => {
    setDirty(true);
    setDraft((prev) =>
      prev.map((r) => (r.key === key ? { ...r, mappings: (r.mappings ?? []).filter((_, i) => i !== idx) } : r))
    );
  };

  const move = (key: string, dir: -1 | 1) => {
    setDirty(true);
    setDraft((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      if (prev[i].key === OTHER_KEY || prev[j].key === OTHER_KEY) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const addRule = () => {
    setDirty(true);
    setDraft((prev) => {
      const rule: CategoryRule = {
        key: nextCustomKey(prev),
        label: '新分类',
        exts: [],
        keywords: [],
        builtin: false,
        enabled: true
      };
      const otherIdx = prev.findIndex((r) => r.key === OTHER_KEY);
      const next = [...prev];
      next.splice(otherIdx < 0 ? next.length : otherIdx, 0, rule);
      return next;
    });
  };

  const removeRule = (key: string) => {
    setDirty(true);
    setDraft((prev) => prev.filter((r) => r.key !== key));
  };

  const save = async () => {
    const bad = draft.find((r) => !r.label.trim());
    if (bad) {
      notify('分类名称不能为空', 'error');
      return;
    }
    await updateCategories(draft);
    setDirty(false);
    notify('归类规则已保存');
  };

  return (
    <section className="card card-wide">
      <h2>归类规则（自定义归类）</h2>
      <p className="hint">
        按扩展名或文件名关键字归类。<b>自定义分类优先于内置分类</b>，「其他」是兜底项。
        在「移动映射」里可配置多组「关键字 → 归属目录」，一键整理会把命中关键字的桌面文件自动移动到对应目录（可通过「还原文件」撤销）。
        修改后点「保存规则」生效，再点「按规则重建围栏」刷新桌面围栏。
      </p>

      <div className="rule-list">
        {draft.map((r, i) => {
          const isOther = r.key === OTHER_KEY;
          return (
            <div className={'rule' + (isOther ? ' rule-other' : '')} key={r.key}>
              <div className="rule-head">
                <label className="check rule-enable">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={isOther}
                    onChange={(e) => patch(r.key, { enabled: e.target.checked })}
                  />
                  启用
                </label>
                <input
                  className="rule-label"
                  value={r.label}
                  placeholder="分类名称"
                  onChange={(e) => patch(r.key, { label: e.target.value })}
                />
                <span className="rule-tag">{r.builtin ? '内置' : '自定义'}</span>
                <span className="rule-ops">
                  <button className="mini" title="上移" disabled={isOther || i === 0} onClick={() => move(r.key, -1)}>
                    ↑
                  </button>
                  <button
                    className="mini"
                    title="下移"
                    disabled={isOther || i >= draft.length - 2}
                    onClick={() => move(r.key, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="mini danger"
                    title={r.builtin ? '内置分类不可删除，可停用' : '删除分类'}
                    disabled={r.builtin}
                    onClick={() => removeRule(r.key)}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {isOther ? (
                <p className="hint">未匹配任何规则的项目会归到这里。</p>
              ) : (
                <>
                  <label className="field">
                    扩展名（逗号分隔，无需带点）
                    <input
                      value={listToText(r.exts)}
                      placeholder="如 docx, pdf, txt"
                      onChange={(e) => patch(r.key, { exts: textToList(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    文件名关键字（可选，命中优先于扩展名）
                    <input
                      value={listToText(r.keywords)}
                      placeholder="如 报销, 周报"
                      onChange={(e) => patch(r.key, { keywords: textToList(e.target.value) })}
                    />
                  </label>
                  <div className="map-list">
                    <p className="hint map-title">
                      移动映射（一键整理时按文件名关键字移动到对应目录，可配置多组）
                    </p>
                    {(r.mappings ?? []).map((m, mi) => (
                      <div className="map-row" key={mi}>
                        <input
                          className="map-keywords"
                          value={m.keywords.join(', ')}
                          placeholder="关键字，如 报销, 发票"
                          onChange={(e) => patchMapping(r.key, mi, { keywords: textToList(e.target.value) })}
                        />
                        <input
                          className="map-dir"
                          value={m.targetDir}
                          placeholder="归属目录，如 D:\工作\报销"
                          onChange={(e) => patchMapping(r.key, mi, { targetDir: e.target.value })}
                        />
                        <button className="mini danger" title="删除此映射" onClick={() => delMapping(r.key, mi)}>
                          ✕
                        </button>
                      </div>
                    ))}
                    <button className="mini map-add" onClick={() => addMapping(r.key)}>
                      + 添加映射
                    </button>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={r.matchDir === true}
                      onChange={(e) => patch(r.key, { matchDir: e.target.checked })}
                    />
                    收纳文件夹（而非文件）
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="row rule-actions">
        <button onClick={addRule}>+ 新增自定义分类</button>
        <button className={dirty ? 'primary' : ''} onClick={() => void save()}>
          {dirty ? '保存规则（有修改）' : '保存规则'}
        </button>
        <button
          onClick={async () => {
            await resetCategories();
            setDirty(false);
          }}
        >
          恢复默认
        </button>
      </div>
    </section>
  );
}

export function Settings() {
  const scan = useStore((s) => s.scan);
  const fences = useStore((s) => s.fences);
  const addFence = useStore((s) => s.addFence);
  const removeFence = useStore((s) => s.removeFence);
  const widgets = useStore((s) => s.widgets);
  const updateWidgets = useStore((s) => s.updateWidgets);
  const theme = useStore((s) => s.theme);
  const updateTheme = useStore((s) => s.updateTheme);
  const categories = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const init = useStore((s) => s.init);
  const toasts = useStore((s) => s.toasts);

  const [schedule, setSchedule] = useState({
    enabled: false,
    intervalMin: 30,
    random: true,
    dir: ''
  });
  const [mode, setMode] = useState<WallpaperMode>('fill');
  const [currentWallpaper, setCurrentWallpaper] = useState('');
  const [newFenceCats, setNewFenceCats] = useState<CategoryKey[]>(['document']);
  const [newFenceName, setNewFenceName] = useState('');

  const fenceOptions = useMemo(() => categories.filter((c) => c.enabled), [categories]);

  const labelOf = useMemo(
    () => new Map(categories.map((c) => [c.key, c.label])),
    [categories]
  );

  useEffect(() => {
    void init();
    (async () => {
      const cfg = await api.getConfig();
      setSchedule(cfg.wallpaper.schedule);
      setMode(cfg.wallpaper.mode);
      try {
        setCurrentWallpaper(await api.getWallpaper());
      } catch {
        /* ignore */
      }
    })();
  }, [init]);

  const chooseWallpaperFile = async () => {
    const p = await api.openFile();
    if (p) {
      await api.setWallpaper(p);
      setCurrentWallpaper(p);
      await api.setConfig({ wallpaper: { lastWallpaper: p } } as any);
    }
  };

  const chooseWallpaperDir = async () => {
    const d = await api.openDirectory();
    if (d) changeSchedule({ dir: d });
  };

  const changeMode = (m: WallpaperMode) => {
    setMode(m);
    void api.setWallpaperMode(m);
    void api.setConfig({ wallpaper: { mode: m } } as any);
  };

  const changeSchedule = (patch: Partial<typeof schedule>) => {
    const next = { ...schedule, ...patch };
    setSchedule(next);
    void api.setSchedule(next);
  };

  const defaultFenceTitle = () => {
    const names = newFenceCats.map((k) => labelOf.get(k)).filter(Boolean) as string[];
    if (names.length === 0) return FENCE_TITLE;
    if (names.length <= 2) return names.join('·');
    return `${names[0]}等 ${names.length} 类`;
  };

  return (
    <div className="settings-root">
      <header className="settings-top">
        <h1>桌面管家 · 设置</h1>
        <span className="hint">桌面文件：{scan?.total ?? 0} 个</span>
      </header>

      <div className="settings-body">
        <section className="card">
          <h2>桌面整理</h2>
          <div className="row">
            {scan?.organized ? (
              <>
                <button
                  onClick={() => void useStore.getState().applyOrganize(true)}
                  title="按规则增量整理桌面新增的文件；已移走的文件不受影响"
                >
                  整理新文件
                </button>
                <button onClick={() => void useStore.getState().undoOrganize()}>
                  {scan.legacy ? '还原文件到原位置' : '退出分组显示'}
                </button>
              </>
            ) : (
              <button onClick={() => void useStore.getState().applyOrganize()}>一键整理</button>
            )}
            <button onClick={() => void useStore.getState().refreshScan()}>重新扫描</button>
          </div>
          <p className="hint">
            {scan?.legacy
              ? '之前整理移动过文件（旧版整理或归属目录规则）。点「还原文件到原位置」可让它们回到原来的路径。'
              : '一键整理采用「原位分组」：只按分类把桌面图标收进收纳窗口，'}
            {!scan?.legacy && (
              <>
                <b>文件与文件夹留在原来的位置</b>
                ，不移动、不改名，资源管理器里的路径保持不变。
              </>
            )}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoOrganizeOnStart}
              onChange={(e) => void updateSettings({ autoOrganizeOnStart: e.target.checked })}
            />
            开机自动整理
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.hideIconsOnStart}
              onChange={(e) => void updateSettings({ hideIconsOnStart: e.target.checked })}
            />
            开机隐藏系统桌面图标
          </label>

          <h3>分类统计</h3>
          <ul className="fence-list">
            {(scan?.categories ?? [])
              .filter((c) => c.items.length > 0)
              .map((c) => (
                <li key={c.key}>
                  <span>{c.label}</span>
                  <span className="hint">{c.items.length} 个</span>
                </li>
              ))}
          </ul>

          <h3>收纳窗口</h3>
          <p className="hint">
            所有分类都收在同一个窗口里，用窗口顶部标签切换。通常只需要一个窗口；
            如果想把某些分类单独放，也可以在下面另建一个。
          </p>
          <ul className="fence-list">
            {fences.map((f) => (
              <li key={f.id}>
                <span>
                  {f.title}
                  <span className="hint">（{f.categories.length} 个标签）</span>
                </span>
                <button onClick={() => removeFence(f.id)}>删除</button>
              </li>
            ))}
          </ul>
          <div className="field">
            窗口里包含哪些分类
            <div className="cat-checks">
              {fenceOptions.map((c) => (
                <label key={c.key} className="check">
                  <input
                    type="checkbox"
                    checked={newFenceCats.includes(c.key)}
                    onChange={(e) =>
                      setNewFenceCats((prev) =>
                        e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key)
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <input
              value={newFenceName}
              onChange={(e) => setNewFenceName(e.target.value)}
              placeholder={defaultFenceTitle()}
            />
            <button
              onClick={() => addFence(newFenceCats, newFenceName.trim() || defaultFenceTitle())}
            >
              添加窗口
            </button>
          </div>
        </section>

        <CategoryEditor />

        <section className="card">
          <h2>壁纸美化</h2>
          <p className="hint break">{currentWallpaper || '（未获取到当前壁纸）'}</p>
          <div className="row">
            <button onClick={() => void chooseWallpaperFile()}>选择图片设为壁纸</button>
            <button onClick={() => void api.nextWallpaper()}>立即换一张</button>
          </div>
          <label className="field">
            填充方式
            <select value={mode} onChange={(e) => changeMode(e.target.value as WallpaperMode)}>
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            壁纸目录（定时切换）
            <span className="row">
              <input value={schedule.dir} readOnly placeholder="未选择" />
              <button onClick={() => void chooseWallpaperDir()}>浏览</button>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => changeSchedule({ enabled: e.target.checked })}
            />
            启用定时/随机切换
          </label>
          <label className="field">
            切换间隔（分钟）
            <input
              type="number"
              min={1}
              value={schedule.intervalMin}
              onChange={(e) => changeSchedule({ intervalMin: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.random}
              onChange={(e) => changeSchedule({ random: e.target.checked })}
            />
            随机顺序
          </label>
        </section>

        <section className="card">
          <h2>桌面组件</h2>
          {(
            [
              ['clock', '时钟'],
              ['calendar', '日历'],
              ['note', NOTE_TITLE]
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={(widgets as any)[key].enabled}
                onChange={(e) =>
                  updateWidgets({
                    [key]: { ...(widgets as any)[key], enabled: e.target.checked }
                  } as any)
                }
              />
              {label}
            </label>
          ))}

          <div className="row note-size-row">
            <span className="note-size-label">便签大小</span>
            {NOTE_SIZE_PRESETS.map((p) => {
              const on = widgets.note.w === p.w && widgets.note.h === p.h;
              return (
                <button
                  key={p.label}
                  className={on ? 'primary' : ''}
                  title={`${p.w} × ${p.h}`}
                  onClick={() => {
                    /* 右侧停靠（x<0）的便签：变宽时左移，保持右边缘贴边 */
                    const cur = widgets.note.w || 238;
                    const x =
                      widgets.note.x < 0 ? widgets.note.x - (p.w - cur) : widgets.note.x;
                    updateWidgets({ note: { ...widgets.note, w: p.w, h: p.h, x } });
                  }}
                >
                  {p.label}
                </button>
              );
            })}
            <button
              className={!widgets.note.w && !widgets.note.h ? 'primary' : ''}
              title="恢复按内容自适应的高度"
              onClick={() =>
                updateWidgets({ note: { ...widgets.note, w: 0, h: 0 } })
              }
            >
              自适应
            </button>
          </div>
          <p className="hint">
            也可以直接拖便签右下角的把手调大小；双击把手回到自适应。
          </p>
        </section>

        <section className="card">
          <h2>主题</h2>
          <div className="theme-presets">
            {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((p) => (
              <button
                key={p}
                className={`theme-preset${theme.preset === p ? ' on' : ''}`}
                onClick={() => updateTheme({ preset: p, panelBg: PRESET_PANEL_BG[p] })}
                title={THEME_PRESETS[p].name}
              >
                <span
                  className="theme-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${THEME_PRESETS[p].swatch1}, ${THEME_PRESETS[p].swatch2})`
                  }}
                />
                {THEME_PRESETS[p].name}
              </button>
            ))}
          </div>
          <label className="field">
            强调色
            <input
              type="color"
              value={theme.accent}
              onChange={(e) => updateTheme({ accent: e.target.value })}
            />
          </label>
          <label className="field">
            面板不透明度 {Math.round(theme.panelOpacity * 100)}%
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.02}
              value={theme.panelOpacity}
              onChange={(e) => updateTheme({ panelOpacity: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={theme.blur}
              onChange={(e) => updateTheme({ blur: e.target.checked })}
            />
            毛玻璃模糊
          </label>
        </section>

        <section className="card">
          <h2>常规</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.alwaysInteractive}
              onChange={(e) => {
                void updateSettings({ alwaysInteractive: e.target.checked });
                if (e.target.checked) {
                  useStore
                    .getState()
                    .notify('已开启整层拦截：桌面图标（此电脑/回收站等）将无法点击', 'error');
                }
              }}
            />
            整层拦截鼠标（会挡住桌面图标）
          </label>
          <p className="hint">
            默认关闭：桌面层只在围栏/组件上响应鼠标，其余区域穿透给系统桌面，
            <b>此电脑、回收站等原生图标照常可点</b>。
            仅在调试「按钮点不动」时才需要开启——开启后整层吃掉全部点击，桌面图标会失效。
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.loginItem}
              onChange={(e) => {
                void updateSettings({ loginItem: e.target.checked });
                void api.setLoginItem(e.target.checked);
              }}
            />
            开机自动启动
          </label>
          <div className="row">
            <button
              onClick={async () => {
                await api.resetConfig();
                location.reload();
              }}
            >
              重置所有设置
            </button>
            <button onClick={() => void api.quit()}>退出程序</button>
          </div>
        </section>
      </div>

      {toasts.length > 0 && (
        <div className="toast-host toast-host-settings">
          {toasts.map((t) => (
            <div key={t.id} className={'toast' + (t.kind === 'error' ? ' toast-error' : '')}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
