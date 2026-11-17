import { useEffect } from 'react';
import { useStore } from './store';
import { api } from './api';
import { initPassthrough, refreshPassthrough } from './interaction';
import { Fence } from './components/Fence';
import { DesktopControl } from './components/DesktopControl';
import { Toasts } from './components/Toasts';
import { AlarmOverlay } from './components/AlarmOverlay';
import { ClockWidget } from './components/widgets/ClockWidget';
import { CalendarWidget } from './components/widgets/CalendarWidget';
import { NoteWidget } from './components/widgets/NoteWidget';
import { Settings } from './components/Settings';
import { useAlarmEngine } from './alarms';
import { applyTheme } from './theme';

function Widgets() {
  const widgets = useStore((s) => s.widgets);
  return (
    <>
      {widgets.clock.enabled && <ClockWidget />}
      {widgets.calendar.enabled && <CalendarWidget />}
      {widgets.note.enabled && <NoteWidget />}
    </>
  );
}

export default function App() {
  const mode = useStore((s) => s.mode);
  const init = useStore((s) => s.init);
  const fences = useStore((s) => s.fences);
  const widgets = useStore((s) => s.widgets);
  const iconsHidden = useStore((s) => s.iconsHidden);
  const alwaysInteractive = useStore((s) => s.settings.alwaysInteractive);
  const toolbarCollapsed = useStore((s) => s.settings.toolbarCollapsed);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    void init();
  }, [init]);

  // Alarms belong to the desktop layer only (the settings window has no UI for
  // ringing); mounting the scheduler once keeps them ticking even when the
  // clock panel is closed.
  useAlarmEngine(mode !== 'settings');

  // Mouse pass-through only applies to the desktop layer window; the settings
  // window is a normal window and must never be made click-through.
  useEffect(() => {
    if (mode === 'settings') return;
    initPassthrough();
  }, [mode]);

  // Any change that moves/adds/removes interactive elements invalidates the
  // hit-test rectangles, so recompute the pass-through state.
  useEffect(() => {
    if (mode === 'settings') return;
    refreshPassthrough();
  }, [mode, fences, widgets, iconsHidden, alwaysInteractive, toolbarCollapsed]);

  // Stay in sync when the tray menu or the settings window changes things.
  useEffect(() => {
    const offConfig = api.on('config:changed', (cfg: any) => {
      useStore.getState().applyConfig(cfg);
    });
    const offOrganize = api.on('organizer:changed', () => {
      void useStore.getState().refreshScan();
    });
    const offWidgets = api.on('widgets:changed', (w: any) => {
      useStore.setState({ widgets: w });
    });
    const offIcons = api.on('icons:changed', (hidden: boolean) => {
      useStore.setState({ iconsHidden: hidden });
    });
    return () => {
      offConfig();
      offOrganize();
      offWidgets();
      offIcons();
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  if (mode === 'settings') return <Settings />;

  return (
    <div className="desktop-root">
      {fences.map((f) => (
        <Fence key={f.id} fence={f} />
      ))}
      <Widgets />
      <DesktopControl />
      <AlarmOverlay />
      <Toasts />
    </div>
  );
}
