import { useEffect, useState } from 'react';
import { WidgetShell } from './WidgetShell';

export function CalendarWidget() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const week = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <WidgetShell wkey="calendar" title={`${year}年${month + 1}月`}>
      <div className="cal-grid">
        {week.map((w) => (
          <span key={w} className="cal-h">
            {w}
          </span>
        ))}
        {cells.map((c, i) => (
          <span key={i} className={'cal-d' + (c === now.getDate() ? ' cal-today' : '')}>
            {c ?? ''}
          </span>
        ))}
      </div>
    </WidgetShell>
  );
}
