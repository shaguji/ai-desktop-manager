import { useStore } from '../store';
import { enterInteractive, leaveInteractive } from '../interaction';

/**
 * Full-screen alarm reminder.
 *
 * Two channels at once, because a desktop layer is easy to overlook:
 *  - a flashing vignette around the whole screen (pure CSS, goes away by itself),
 *  - a card with 停止 / 稍后提醒 that is the only interactive part.
 *
 * 待办提醒（alarm.todoId）多一个「标记完成」：响铃时人就在跟前，
 * 顺手把事情勾掉比回头再找便签更符合直觉。
 *
 * The layer itself stays click-through (pointer-events: none) so the desktop
 * below keeps working while the alarm is up.
 */
export function AlarmOverlay() {
  const ringing = useStore((s) => s.ringing);
  const stopRinging = useStore((s) => s.stopRinging);
  const snoozeRinging = useStore((s) => s.snoozeRinging);
  const completeTodo = useStore((s) => s.completeTodo);
  if (!ringing) return null;

  const todoId = ringing.alarm.todoId;

  return (
    <div className="alarm-layer">
      <div className="alarm-vignette" />
      <div
        className="alarm-card"
        data-interactive
        onMouseEnter={enterInteractive}
        onMouseLeave={leaveInteractive}
      >
        <div className="alarm-card-ring">{todoId ? '📌' : '🔔'}</div>
        <div className="alarm-card-time">{ringing.alarm.time}</div>
        <div className="alarm-card-label">
          {ringing.alarm.label || (todoId ? '这条待办到点了' : '闹铃时间到')}
        </div>
        {todoId && <div className="alarm-card-tag">待办提醒</div>}
        <div className="alarm-card-actions">
          <button className="no-drag" onClick={() => snoozeRinging(5)}>
            稍后 5 分钟
          </button>
          {todoId ? (
            <>
              <button className="no-drag alarm-done" onClick={() => completeTodo(todoId)}>
                已完成
              </button>
              <button className="no-drag alarm-stop" onClick={stopRinging}>
                停止
              </button>
            </>
          ) : (
            <button className="no-drag alarm-stop" onClick={stopRinging}>
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
