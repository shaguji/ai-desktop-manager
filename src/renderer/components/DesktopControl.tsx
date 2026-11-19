import { type CSSProperties, useRef, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { enterInteractive, leaveInteractive, setDragging } from '../interaction';
import { WallpaperPicker } from './WallpaperPicker';

export function DesktopControl() {
  const scan = useStore((s) => s.scan);
  const applyOrganize = useStore((s) => s.applyOrganize);
  const undoOrganize = useStore((s) => s.undoOrganize);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const collapsed = settings.toolbarCollapsed;
  const [wpOpen, setWpOpen] = useState(false);

  /**
   * Drag position of the whole toolbar. `null` = the built-in top-right corner.
   * The pill and the empty part of the button row both act as drag handles:
   * press and move (>4px) to drag, a plain click on the pill still toggles.
   */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(settings.toolbarPos ?? null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Set when the last mousedown turned into a drag, so the click that follows is ignored. */
  const draggedRef = useRef(false);

  /** Near the left half of the screen the button row grows right; near the
   *  right half it grows left, so it never spills off-screen. */
  const anchorLeft = !!pos && pos.x + 120 < window.innerWidth / 2;

  const beginDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const start = { mx: e.clientX, my: e.clientY, ox: rect.left, oy: rect.top };
    let moved = false;
    let latest = { x: rect.left, y: rect.top };
    /* Capture the mouse right away: the pointer will leave the handle on the
       first few pixels and the desktop layer would otherwise hand it back. */
    setDragging(true);

    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - start.mx;
      const dy = ev.clientY - start.my;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      /* Reserve room below for the expanded button row, otherwise dragging the
         toolbar near the bottom would push it off-screen on expand. */
      const maxX = Math.max(0, window.innerWidth - el.offsetWidth - 6);
      const maxY = Math.max(0, window.innerHeight - 112);
      latest = {
        x: Math.min(Math.max(0, start.ox + dx), maxX),
        y: Math.min(Math.max(0, start.oy + dy), maxY)
      };
      setPos(latest);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDragging(false);
      if (!moved) return;
      draggedRef.current = true;
      void updateSettings({ toolbarPos: latest });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const style: CSSProperties = pos ? { left: pos.x, top: pos.y, right: 'auto' } : {};

  return (
    <div
      ref={rootRef}
      className={`desktop-control${collapsed ? ' collapsed' : ''}${anchorLeft ? ' anchor-left' : ''}`}
      data-interactive
      style={style}
      onMouseEnter={enterInteractive}
      onMouseLeave={leaveInteractive}
    >
      <div
        className="dc-actions"
        onMouseDown={(e) => {
          /* Empty padding between buttons is a drag handle; a press on an
             actual button must stay a click. */
          if ((e.target as HTMLElement).closest('button')) return;
          beginDrag(e);
        }}
      >
        <button onClick={() => void api.openSettings()}>设置</button>
        {scan?.organized ? (
          <>
            <button
              onClick={() => void applyOrganize(true)}
              title="扫描桌面新增的文件/文件夹/应用，按规则增量整理：命中移动映射的移到归属目录，其余进分组显示；已移走的文件不受影响"
            >
              整理新文件
            </button>
            <button onClick={() => void undoOrganize()} title={scan.legacy ? '把之前整理移动过的文件（旧版整理或归属目录规则）放回原来的位置' : '退出分组显示，文件本来就在原位置'}>
              {scan.legacy ? '还原文件' : '撤销整理'}
            </button>
          </>
        ) : (
          <button onClick={() => void applyOrganize()}>一键整理</button>
        )}
        <button onClick={() => setWpOpen(true)}>换壁纸</button>
        <button
          onClick={() => void (api.notesOpenHome ? api.notesOpenHome() : api.notesOpen())}
          title="随手记：待办 / 项目工作 / 会议纪要 / 每日感想，支持手写与语音（自动同步便签事项）"
        >
          随手记
        </button>
      </div>
      <button
        className="dc-toggle"
        title={
          collapsed
            ? '按住拖动工具栏 · 单击展开 · 右键打开设置'
            : '按住药丸或按钮行空白处拖动 · 单击收起 · 右键打开设置'
        }
        onMouseDown={beginDrag}
        onClick={() => {
          /* A drag ends with a click event; swallow that one. */
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          void updateSettings({ toolbarCollapsed: !collapsed });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          void api.openSettings();
        }}
      >
        {collapsed ? '▾ 工具' : '▴ 收起'}
      </button>
      {wpOpen && <WallpaperPicker onClose={() => setWpOpen(false)} />}
    </div>
  );
}
