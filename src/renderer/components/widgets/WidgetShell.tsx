import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { WidgetState } from '../../../shared/types';
import { useStore } from '../../store';
import { type ResizePreview, clampBox, useDrag, useResizeDrag } from '../../hooks';
import { enterInteractive, leaveInteractive } from '../../interaction';

type WidgetKey = keyof WidgetState;

export function WidgetShell({
  wkey,
  title,
  children,
  actions,
  className,
  resizable = false,
  minW = 200,
  minH = 160
}: {
  wkey: WidgetKey;
  title: string;
  children: ReactNode;
  /** Extra controls rendered in the header, left of the close button. */
  actions?: ReactNode;
  /** Extra class on the panel (used for the alarm flashing state). */
  className?: string;
  /** Show the drag grips that let the user resize this panel. */
  resizable?: boolean;
  minW?: number;
  minH?: number;
}) {
  const widgets = useStore((s) => s.widgets);
  const updateWidgets = useStore((s) => s.updateWidgets);
  const pos = (widgets as any)[wkey];
  const x = pos.x < 0 ? window.innerWidth + pos.x : pos.x;

  const boxRef = useRef<HTMLDivElement | null>(null);
  /** Live size while dragging (see useResizeDrag); null when not resizing. */
  const [size, setSize] = useState<ResizePreview | null>(null);

  /**
   * Keep the panel on screen without touching the stored position. Content
   * that only appears on demand (the clock's alarm list) can make the panel
   * wider than the space right of it — rather than letting the chips/input
   * clip at the screen edge, slide the whole panel left just enough.
   */
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const left = size?.left ?? x;
    const top = pos.y;
    const ox = Math.max(0, left + el.offsetWidth + 6 - window.innerWidth);
    const oy = Math.max(0, top + el.offsetHeight + 6 - window.innerHeight);
    setShift((cur) => (cur.x === ox && cur.y === oy ? cur : { x: ox, y: oy }));
  });

  const onMouseDown = useDrag(
    /* Work in screen space: a right-anchored panel stores x as a negative
       offset from the right edge, which must never be fed to a clamp. */
    () => ({ x: pos.x < 0 ? window.innerWidth + pos.x : pos.x, y: pos.y }),
    (nx, ny) => {
      const el = boxRef.current;
      const p = clampBox(nx, ny, el?.offsetWidth ?? 240, el?.offsetHeight ?? 160);
      updateWidgets({ [wkey]: { ...pos, x: p.x, y: p.y } } as any);
    }
  );

  /* 0 / undefined both mean "auto": fall back to the measured box. */
  const onGripDown = useResizeDrag({
    getBase: () => ({
      w: pos.w || boxRef.current?.offsetWidth || 240,
      h: pos.h || boxRef.current?.offsetHeight || 240,
      x: pos.x
    }),
    minW,
    minH,
    maxH: Math.max(minH, window.innerHeight - pos.y - 10),
    onPreview: setSize,
    onCommit: (p) => updateWidgets({ [wkey]: { ...pos, x: p.x, w: p.w, h: p.h } } as any)
  });

  /**
   * 双击右下角把手 → 回到「按内容自适应」的原始大小。
   * 配置层是深合并的，删键删不掉旧值，所以用 0 表示「自动」。
   */
  const resetSize = () => {
    setSize(null);
    updateWidgets({ [wkey]: { ...pos, w: 0, h: 0 } } as any);
  };

  const w = size?.w ?? pos.w;
  const h = size?.h ?? pos.h;
  /* 最小化 = 只留标题条：隐藏 body 与缩放把手，高度交给内容自适应。
     位置 / 尺寸 / 待办内容原样留在配置里，还原后完全恢复。 */
  const collapsed = !!pos.collapsed;
  const style: CSSProperties = {
    left: Math.max(0, (size?.left ?? x) - shift.x),
    top: Math.max(0, pos.y - shift.y)
  };
  if (resizable) {
    if (w) style.width = w;
    if (collapsed) style.height = undefined; /* 标题条：跟随 header 内容 */
    else if (h) style.height = h;
  }

  return (
    <div
      ref={boxRef}
      className={'widget' + (className ? ' ' + className : '')}
      data-interactive
      data-wkey={wkey}
      /* Explicit height → let the body/list take up the extra room. */
      data-sized={!collapsed && h ? '1' : undefined}
      data-collapsed={collapsed ? '1' : undefined}
      style={style}
      onMouseEnter={enterInteractive}
      onMouseLeave={leaveInteractive}
    >
      {/* NOTE: the header must NOT carry .no-drag – useDrag bails out on it. */}
      <div className="widget-header" onMouseDown={onMouseDown}>
        <span>{title}</span>
        <div className="widget-actions">
          {actions}
          <button
            className="widget-min no-drag"
            title={collapsed ? '还原' : '最小化（收成标题条）'}
            onClick={() => updateWidgets({ [wkey]: { ...pos, collapsed: !collapsed } } as any)}
          >
            {collapsed ? '▢' : '—'}
          </button>
          <button
            className="widget-close no-drag"
            title="关闭组件"
            onClick={() => updateWidgets({ [wkey]: { ...pos, enabled: false } } as any)}
          >
            ✕
          </button>
        </div>
      </div>
      {!collapsed && <div className="widget-body">{children}</div>}

      {resizable && !collapsed && (
        <>
          <div
            className="widget-grip e no-drag"
            title="左右拖动调整宽度"
            onMouseDown={onGripDown('x')}
          />
          <div
            className="widget-grip s no-drag"
            title="上下拖动调整高度"
            onMouseDown={onGripDown('y')}
          />
          <div
            className="widget-grip se no-drag"
            title="拖动调整大小（双击恢复默认）"
            onMouseDown={onGripDown('xy')}
            onDoubleClick={resetSize}
          />
        </>
      )}
    </div>
  );
}
