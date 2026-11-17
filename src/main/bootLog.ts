// Must be the FIRST import in main/index.ts: installs file logging and global
// crash handlers before any heavy module (koffi, ffi) is loaded, so a packaged
// build that fails during module load still leaves a trace on disk.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

export function installBootLog(): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'main.log');
    try {
      const st = fs.statSync(logPath);
      if (st.size > 1024 * 1024) fs.renameSync(logPath, path.join(dir, 'main.old.log'));
    } catch {
      /* first run — no old log */
    }
    const stream = fs.createWriteStream(logPath, { flags: 'a' });
    const stamp = () => new Date().toISOString();
    const write = (line: string) => {
      try {
        stream.write(`[${stamp()}] ${line}\n`);
      } catch {
        /* ignore */
      }
    };
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      const original = (console as any)[method].bind(console);
      (console as any)[method] = (...args: unknown[]) => {
        write(
          `[${method}] ${args
            .map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a)))
            .join(' ')}`
        );
        original(...args);
      };
    }
    process.on('uncaughtException', (e) => write(`[uncaughtException] ${e?.stack || String(e)}`));
    process.on('unhandledRejection', (e) =>
      write(`[unhandledRejection] ${e instanceof Error ? e.stack : String(e)}`)
    );
    write('[boot] file logging installed -> ' + logPath);
  } catch (e) {
    console.error('[boot] file logging failed', e);
  }
}

installBootLog();
