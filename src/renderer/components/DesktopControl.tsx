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
   * ANY part of the toolbar is now a drag handle — the pill, the button row's
   * padding, and the buttons themselves. A press + move (>4px) drags; a plain
   * click still fires the button (or toggles the pill).
   */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(settings.toolbarPos ?? null);
  /** True only while an actual drag is in progress (past the movement threshold). */
  const [isMoving, setIsMoving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Set when the last mousedown turned into a drag, so the click that follows is ignored. */
  const draggedRef = useRef(false);

  /** Near the left half of the screen the button row grows right; near the
   *  right half it grows left, so it never spills off-screen. */
  const anchorLeft = !!pos && pos.x + 120 < window.innerWidth / 2;

  const beginDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    /* Clear any stale flag from a previous drag that ended without a click. */
    draggedRef.current = false;
    /* The wallpaper picker lives inside this root: its clicks are not drags. */
    if ((e.target as HTMLElement).closest('.wp-overlay')) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const start = { mx: e.clientX, my: e.clientY, ox: rect.left, oy: rect.top };
    let moved = false;
    let latest = { x: rect.left, y: rect.top };

    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - start.mx;
      const dy = ev.clientY - start.my;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        /* Only once it is a real drag do we capture the mouse: the pointer
           will leave the toolbar and the desktop layer would hand it back. */
        setDragging(true);
        setIsMoving(true);
      }
      ev.preventDefault();
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
      setIsMoving(false);
      if (!moved) return;
      draggedRef.current = true;
      void updateSettings({ toolbarPos: latest });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Swallow the click that follows a drag so buttons don't fire on release. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const style: CSSProperties = pos ? { left: pos.x, top: pos.y, right: 'auto' } : {};

  return (
    <div
      ref={rootRef}
      className={`desktop-control${collapsed ? ' collapsed' : ''}${anchorLeft ? ' anchor-left' : ''}`}
      data-dragging={isMoving ? '1' : undefined}
      data-interactive
      style={style}
      onMouseDown={beginDrag}
      onClickCapture={onClickCapture}
      onMouseEnter={enterInteractive}
      onMouseLeave={leaveInteractive}
    >
      <div className="dc-actions">
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
            ? '按住工具栏任意位置拖动 · 单击展开 · 右键打开设置'
            : '按住工具栏任意位置（含按钮）拖动 · 单击药丸收起 · 右键打开设置'
        }
        onClick={() => void updateSettings({ toolbarCollapsed: !collapsed })}
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
