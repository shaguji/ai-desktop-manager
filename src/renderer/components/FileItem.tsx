import { useEffect, useState } from 'react';
import type { FileItemInfo } from '../../shared/types';
import { useStore } from '../store';
import { api } from '../api';
import { enterInteractive, leaveInteractive } from '../interaction';

/** Windows hides the shortcut extension on the desktop; do the same here. */
function displayName(name: string): string {
  return name.replace(/\.(lnk|url|appref-ms)$/i, '');
}

export function FileItem({ item }: { item: FileItemInfo }) {
  const getIcon = useStore((s) => s.getIcon);
  const notify = useStore((s) => s.notify);
  const [icon, setIcon] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void getIcon(item.path, 48).then((d) => {
      if (alive) setIcon(d);
    });
    return () => {
      alive = false;
    };
  }, [item.path, getIcon]);

  const open = async () => {
    const err = await api.openPath(item.path);
    if (err) notify('打开失败：' + err, 'error');
  };

  const label = displayName(item.name);

  return (
    <>
      <div
        className="file-item no-drag"
        title={label + '\n（双击打开）'}
        onDoubleClick={() => void open()}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onMouseEnter={enterInteractive}
        onMouseLeave={leaveInteractive}
      >
        {icon ? (
          <img src={icon} width={32} height={32} draggable={false} alt="" />
        ) : (
          <div className="file-icon-placeholder" />
        )}
        <span className="file-name">{label}</span>
      </div>

      {menu && (
        <div
          className="ctx-menu"
          data-interactive
          style={{ left: menu.x, top: menu.y }}
          onMouseEnter={enterInteractive}
          onMouseLeave={() => {
            leaveInteractive();
            setMenu(null);
          }}
        >
          <div
            className="ctx-item"
            onClick={() => {
              void open();
              setMenu(null);
            }}
          >
            打开
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              void api.showItemInFolder(item.path);
              setMenu(null);
            }}
          >
            打开所在文件夹
          </div>
        </div>
      )}
    </>
  );
}
