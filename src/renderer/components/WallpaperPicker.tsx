import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { enterInteractive, leaveInteractive } from '../interaction';

interface WpItem {
  name: string;
  path: string;
  thumb: string;
  current: boolean;
}

/** Glass gallery overlay for choosing a built-in wallpaper. */
export function WallpaperPicker({ onClose }: { onClose: () => void }) {
  const notify = useStore((s) => s.notify);
  const [items, setItems] = useState<WpItem[] | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.listBuiltinWallpapers().then((list) => {
      if (!alive) return;
      setItems(list);
      setActive(list.find((i) => i.current)?.path ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const apply = async (w: WpItem) => {
    const ok = await api.setWallpaper(w.path);
    if (ok) {
      setActive(w.path);
      notify(`壁纸已更换：${w.name}`);
    } else {
      notify('壁纸更换失败', 'error');
    }
  };

  return (
    <div
      className="wp-overlay"
      data-interactive
      onMouseEnter={enterInteractive}
      onMouseLeave={leaveInteractive}
      onClick={onClose}
    >
      <div className="wp-card" onClick={(e) => e.stopPropagation()}>
        <div className="wp-head">
          <span className="wp-title">选择壁纸</span>
          <button className="fence-btn" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        {items === null ? (
          <div className="wp-loading">加载中…</div>
        ) : (
          <div className="wp-grid">
            {items.map((w) => (
              <button
                key={w.path}
                className={'wp-item' + (w.path === active ? ' on' : '')}
                title={w.name}
                onClick={() => void apply(w)}
              >
                <img src={w.thumb} alt={w.name} />
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
