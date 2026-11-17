import { api } from './api';
import { useStore } from './store';

/**
 * Mouse pass-through controller for the transparent desktop layer.
 *
 * The window covers the whole screen, so it must forward clicks to the real
 * desktop everywhere except on top of our own UI (fences / widgets / toolbar).
 *
 * Previous implementation relied on per-element onMouseEnter/onMouseLeave to
 * flip `setIgnoreMouseEvents`. That was unreliable: the flip travels through an
 * async IPC call, so a click landing right after the pointer arrived was still
 * swallowed by the desktop below ("buttons do nothing").
 *
 * This version hit-tests every interactive element on each mouse move and
 * inflates their rectangles by HIT_MARGIN, so the window is already capturing
 * the mouse *before* the pointer actually reaches a button.
 */

/** Capture the mouse this many px before the pointer reaches our UI. */
const HIT_MARGIN = 24;

let ignoring: boolean | null = null;
let dragging = false;
/**
 * Short-lived "capture now" hint set by onMouseEnter handlers. It is a
 * timestamp rather than a counter on purpose: if a component unmounts while
 * the pointer is inside it, the hint simply expires instead of leaving the
 * layer permanently capturing (which would block the real desktop).
 */
let forcedUntil = 0;
let lastX = -1;
let lastY = -1;
let started = false;

function applyIgnore(next: boolean): void {
  if (ignoring === next) return;
  ignoring = next;
  // forward:true keeps mouse-move messages coming while we are transparent,
  // which is what makes the hit test above possible.
  void api.setIgnoreMouseEvents(next, { forward: true });
}

function interactiveRects(): DOMRect[] {
  const out: DOMRect[] = [];
  document.querySelectorAll<HTMLElement>('[data-interactive]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(r);
  });
  return out;
}

function hitTest(x: number, y: number): boolean {
  return interactiveRects().some(
    (r) =>
      x >= r.left - HIT_MARGIN &&
      x <= r.right + HIT_MARGIN &&
      y >= r.top - HIT_MARGIN &&
      y <= r.bottom + HIT_MARGIN
  );
}

/** Recompute whether the desktop layer should swallow or forward the mouse. */
export function refreshPassthrough(): void {
  const st = useStore.getState();

  // Full-capture situations: dragging, an element demanded capture, the user
  // enabled the "always interactive" escape hatch, or we took over the desktop
  // (system icons hidden -> there is nothing underneath worth clicking).
  if (dragging || Date.now() < forcedUntil || st.settings.alwaysInteractive || st.iconsHidden) {
    applyIgnore(false);
    return;
  }
  if (lastX < 0) {
    applyIgnore(true);
    return;
  }
  applyIgnore(!hitTest(lastX, lastY));
}

/** Install the global listeners. Safe to call more than once. */
export function initPassthrough(): void {
  if (started) return;
  started = true;

  const onMove = (e: MouseEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;
    refreshPassthrough();
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseover', onMove, true);
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) {
      lastX = -1;
      lastY = -1;
      forcedUntil = 0;
      refreshPassthrough();
    }
  });
  // A click always means the pointer is over our UI; make sure the state
  // matches so the *next* click is never lost either.
  window.addEventListener('mousedown', onMove, true);

  applyIgnore(true);
  // Safety net: layout changes (fence moved/collapsed, widget toggled) change
  // the hit rectangles without any mouse movement.
  window.setInterval(refreshPassthrough, 500);
  startCursorPolling();
}

/**
 * A click-through layered window does not reliably deliver forwarded
 * mouse-move messages on Windows. While the layer is transparent we therefore
 * ask the OS where the cursor is and run the hit test ourselves — otherwise the
 * layer can stay transparent (or worse, stay capturing) no matter where the
 * pointer goes, which is what made desktop icons such as 此电脑 / 回收站
 * unclickable.
 *
 * Polling stops as soon as the layer captures the mouse: from then on real
 * mouse events arrive and drive the state.
 */
function startCursorPolling(): void {
  let busy = false;
  let lastLogged = '';
  window.setInterval(async () => {
    if (busy || !ignoring || dragging) return;
    busy = true;
    try {
      const pos = await api.getCursorPos();
      if (!pos) return;
      // Windows reports physical pixels; DOM rects are CSS pixels.
      const dpr = window.devicePixelRatio || 1;
      lastX = pos.x / dpr;
      lastY = pos.y / dpr;
      const hit = hitTest(lastX, lastY);
      // Only log transitions, otherwise this floods the console 16x/second.
      const sig = `${hit}`;
      if (sig !== lastLogged) {
        lastLogged = sig;
        console.log(`[passthrough] hit=${hit} cursor=${pos.x},${pos.y} dpr=${dpr}`);
      }
      if (!hit) return; // still outside: stay transparent
      refreshPassthrough();
    } catch {
      /* ignore */
    } finally {
      busy = false;
    }
  }, 60);
}

/** Called while dragging a fence/widget so the layer never lets go. */
export function setDragging(v: boolean): void {
  dragging = v;
  if (v) {
    refreshPassthrough();
    return;
  }
  // CRITICAL: switching the layer back to click-through on the same frame the
  // mouse button is released hard-crashes Electron on Windows (renderer gone,
  // no JS stack, app exits). Reproduced with a real mouse drag on the note
  // resize grip: mouseup -> hit test says "over the desktop" ->
  // setIgnoreMouseEvents(true) -> whole app dies. Wait until the OS drag
  // interaction has fully wound down before recomputing.
  setTimeout(refreshPassthrough, 300);
}

/** Pointer entered an interactive element: capture immediately. */
export function enterInteractive(): void {
  forcedUntil = Date.now() + 600;
  refreshPassthrough();
}

/** Pointer left an interactive element: hand control back to the hit test. */
export function leaveInteractive(): void {
  forcedUntil = 0;
  refreshPassthrough();
}
