import { useMemo, useRef, useState } from 'react';
import type { FenceLayout } from '../../shared/types';
import { useStore } from '../store';
import { clampBox, useDrag, type ResizePreview, useResizeDrag } from '../hooks';
import { enterInteractive, leaveInteractive } from '../interaction';
import { FileItem } from './FileItem';

/**
 * A收纳 window: ONE panel whose body switches between categories via tabs,
 * instead of spawning a separate window per category.
 */
export function Fence({ fence }: { fence: FenceLayout }) {
  const scan = useStore((s) => s.scan);
  const categories = useStore((s) => s.categories);
  const updateFence = useStore((s) => s.updateFence);
  const removeFence = useStore((s) => s.removeFence);
  const applyOrganize = useStore((s) => s.applyOrganize);

  /** Live size while dragging a grip; null when not resizing. */
  const [size, setSize] = useState<ResizePreview | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /**
   * The fence mirrors the 整理 tree, so it only has contents while the desktop
   * is organised. After 撤销整理 everything is back on the native desktop and
   * the window must be empty — otherwise the same icons appear twice.
   */
  const organized = !!scan?.organized;

  const tabs = useMemo(() => {
    const labelOf = new Map(categories.map((c) => [c.key, c.label]));
    return fence.categories.map((key) => {
      const group = organized ? scan?.categories.find((c) => c.key === key) : undefined;
      return {
        key,
        label: labelOf.get(key) ?? group?.label ?? key,
        count: group?.items.length ?? 0
      };
    });
  }, [fence.categories, categories, scan, organized]);

  const activeKey =
    fence.active && fence.categories.includes(fence.active) ? fence.active : fence.categories[0];
  const items = organized ? (scan?.categories.find((c) => c.key === activeKey)?.items ?? []) : [];
  const total = tabs.reduce((n, t) => n + t.count, 0);

  const pos = {
    x: fence.x < 0 ? window.innerWidth + fence.x : fence.x,
    y: fence.y
  };

  const onMouseDown = useDrag(
    () => ({ x: pos.x, y: pos.y }),
    (x, y) => {
      const p = clampBox(x, y, boxRef.current?.offsetWidth ?? fence.width, boxRef.current?.offsetHeight ?? 300);
      updateFence(fence.id, { x: p.x, y: p.y });
    }
  );

  const onGripDown = useResizeDrag({
    getBase: () => ({
      w: size?.w ?? fence.width,
      h: size?.h ?? (fence.height || boxRef.current?.offsetHeight || 340),
      x: fence.x
    }),
    minW: 280,
    minH: 180,
    maxH: Math.max(180, window.innerHeight - fence.y - 10),
    onPreview: setSize,
    onCommit: (p) => updateFence(fence.id, { width: p.w, height: p.h, x: p.x })
  });

  const w = size?.w ?? fence.width;
  const h = size?.h ?? fence.height;
  const left = size?.left ?? pos.x;

  return (
    <div
      ref={boxRef}
      className="fence"
      data-interactive
      style={{
        left,
        top: pos.y,
        width: w,
        height: fence.collapsed ? 'auto' : h
      }}
      onMouseEnter={enterInteractive}
      onMouseLeave={leaveInteractive}
    >
      <div className="fence-header" onMouseDown={onMouseDown}>
        <span className="fence-title">
          {fence.title}
          <span className="fence-count">{total}</span>
        </span>
        <span className="fence-actions no-drag">
          <button
            className="fence-btn"
            title={fence.collapsed ? '展开' : '折叠'}
            onClick={() => updateFence(fence.id, { collapsed: !fence.collapsed })}
          >
            {fence.collapsed ? '▢' : '—'}
          </button>
          <button className="fence-btn" title="移除这个窗口" onClick={() => removeFence(fence.id)}>
            ✕
          </button>
        </span>
      </div>

      {!fence.collapsed && (
        <>
          {organized && tabs.length > 0 && (
            <div className="fence-tabs no-drag">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  className={
                    'fence-tab' +
                    (t.key === activeKey ? ' active' : '') +
                    (t.count === 0 ? ' empty' : '')
                  }
                  onClick={() => updateFence(fence.id, { active: t.key })}
                  title={`${t.label}（${t.count} 个）`}
                >
                  {t.label}
                  <span className="fence-tab-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="fence-body">
            {!organized ? (
              <div className="fence-idle no-drag">
                <p className="fence-idle-text">
                  桌面图标未分组
                  <span>点一下，按分类把图标收进来；文件留在原位置，不会移动</span>
                </p>
                <button className="fence-idle-btn" onClick={() => void applyOrganize()}>
                  一键整理
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="fence-empty">暂无文件</div>
            ) : (
              items.map((it) => <FileItem key={it.path} item={it} />)
            )}
          </div>
        </>
      )}

      {!fence.collapsed && (
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
            title="拖动调整窗口大小"
            onMouseDown={onGripDown('xy')}
          />
        </>
      )}
    </div>
  );
}
