import { useStore } from '../store';

/**
 * Lightweight feedback layer. Actions like "一键整理" used to give no visible
 * result, which made working buttons feel broken. Toasts are intentionally
 * NOT interactive (no data-interactive), so they never capture the mouse.
 */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={'toast' + (t.kind === 'error' ? ' toast-error' : '')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
