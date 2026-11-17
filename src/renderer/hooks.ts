import type React from 'react';
import { useRef } from 'react';
import { setDragging } from './interaction';

/** Live geometry while the user is dragging a resize grip. */
export interface ResizePreview {
  w: number;
  h: number;
  /**
   * CSS `left`, i.e. screen coordinates, NOT the stored value. Right-anchored
   * panels keep their position as a negative number in config, and feeding that
   * straight into `style.left` threw the panel off the left edge of the screen
   * mid-drag (it looked like the app had closed). Always resolve it here.
   */
  left?: number;
}

/**
 * Keep a dragged box fully on screen.
 *
 * Dragging used to write the raw pointer delta into the stored position and let
 * the render-time "pull back inside" effect deal with the overflow. That left a
 * hidden overshoot: after hitting the screen edge the stored x kept growing, so
 * the panel looked frozen until the pointer had walked back the overshoot.
 * Clamp here instead, in screen space, so the stored position is always real.
 */
export function clampBox(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - Math.min(w, window.innerWidth) - 6);
  /* Keep at least the header row reachable when the panel is taller than the screen. */
  const maxY = Math.max(0, window.innerHeight - Math.min(h, 56) - 6);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY)
  };
}

/** Which way a grip is allowed to stretch the panel. */
export type ResizeAxis = 'x' | 'y' | 'xy';

/**
 * Drag helper for the resize grips (right edge / bottom edge / corner).
 *
 * The panel only re-renders with a preview during the drag; the final size is
 * committed once on mouseup so the config file is not hammered per frame.
 *
 * Growth follows the pointer: the grip you drag is the edge that moves. A
 * panel stored with a negative x (right-anchored) used to grow leftwards with
 * its right edge pinned, which read as "拖右下角却往左变宽". Now the width
 * tracks the pointer from the current left edge, and only when the right edge
 * would leave the screen does the panel pin that edge and extend leftwards.
 */
export function useResizeDrag({
  getBase,
  minW = 200,
  minH = 160,
  maxW,
  maxH,
  onPreview,
  onCommit
}: {
  getBase: () => { w: number; h: number; x: number };
  minW?: number;
  minH?: number;
  /** Optional upper bound so a panel can never grow past the screen edge. */
  maxW?: number;
  maxH?: number;
  onPreview: (p: ResizePreview | null) => void;
  /** Receives the final geometry with `x` back in stored space (negative = right-anchored). */
  onCommit: (p: { w: number; h: number; x: number }) => void;
}) {
  const pending = useRef<ResizePreview | null>(null);

  return (axis: ResizeAxis) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const base = getBase();
    const ox = e.clientX;
    const oy = e.clientY;
    const rightAnchored = base.x < 0;
    /* Resolve the stored x (negative = distance from the right edge) to a real
     * screen coordinate once, so every preview below is in CSS space. */
    const baseLeft = rightAnchored ? window.innerWidth + base.x : base.x;
    const screenRight = window.innerWidth - 8;
    /* Widest the panel can get while its left edge stays put. */
    const roomAtBase = Math.max(minW, screenRight - baseLeft);
    setDragging(true);

    const move = (ev: MouseEvent) => {
      const next: ResizePreview = { w: base.w, h: base.h, left: baseLeft };
      if (axis !== 'y') {
        const capW = Math.max(minW, Math.min(maxW ?? screenRight, screenRight));
        const desired = Math.round(base.w + (ev.clientX - ox));
        const nw = Math.max(minW, Math.min(capW, desired));
        next.w = nw;
        /* Left edge first; once the right edge hits the screen, keep growing
           leftwards so the grip never feels stuck. */
        next.left = nw > roomAtBase ? Math.max(0, screenRight - nw) : baseLeft;
      }
      if (axis !== 'x') {
        const capH = Math.max(minH, Math.min(maxH ?? window.innerHeight - 8, window.innerHeight - 8));
        next.h = Math.max(minH, Math.min(capH, Math.round(base.h + ev.clientY - oy)));
      }
      pending.current = next;
      onPreview(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDragging(false);
      const done = pending.current;
      pending.current = null;
      onPreview(null);
      if (!done) return;
      /* Convert the screen-space left back to the stored convention. */
      const left = done.left ?? baseLeft;
      onCommit({
        w: done.w,
        h: done.h,
        x: rightAnchored ? left - window.innerWidth : left
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
}

/**
 * Drag helper for desktop elements (fences / widgets).
 *
 * While dragging, the pass-through controller is pinned to "capture" so the
 * pointer never escapes to the desktop below mid-drag. Elements that must not
 * start a drag (buttons, inputs, file items) carry the .no-drag class.
 */
export function useDrag(
  getPos: () => { x: number; y: number },
  onMove: (x: number, y: number) => void,
  onEnd?: () => void
) {
  const start = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    e.preventDefault();
    setDragging(true);
    const p = getPos();
    start.current = { mx: e.clientX, my: e.clientY, ox: p.x, oy: p.y };

    const move = (ev: MouseEvent) => {
      if (!start.current) return;
      onMove(
        start.current.ox + (ev.clientX - start.current.mx),
        start.current.oy + (ev.clientY - start.current.my)
      );
    };
    const up = () => {
      start.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onEnd?.();
      // Hand control back to the hit test instead of hard-coding a state.
      setDragging(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return onMouseDown;
}
