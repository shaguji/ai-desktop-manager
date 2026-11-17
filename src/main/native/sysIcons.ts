// Hide/show the "此电脑" and "回收站" desktop icons through the documented
// Explorer policy keys. The icons are shell namespace objects — they cannot be
// moved into a folder, so the app presents them as virtual items in the 系统
// category and hides the on-desktop copies here.
import koffi from 'koffi';
import { isWindows } from './ffi';

const SUBKEY =
  'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel';

const CLSID_THIS_PC = '{20D04FE0-3AEA-1069-A2D8-08002B30309D}';
const CLSID_RECYCLE_BIN = '{645FF040-5081-101B-9F08-00AA002F954E}';

const HKCU = 0x80000001n;
const KEY_READ = 0x20019;
const KEY_WRITE = 0x20006;
const REG_DWORD = 4;
const SHCNE_UPDATEDIR = 0x00001000;
const SHCNF_PATHW = 0x0005;
const SHCNF_FLUSHNOWAIT = 0x3000;

interface SysIconFns {
  regCreate: (...args: unknown[]) => number;
  regOpen: (...args: unknown[]) => number;
  regSet: (...args: unknown[]) => number;
  regQuery: (...args: unknown[]) => number;
  regClose: (...args: unknown[]) => number;
  notifyDir: (...args: unknown[]) => void;
}

let fns: SysIconFns | null = null;

function load(): SysIconFns | null {
  if (!isWindows) return null;
  if (fns) return fns;
  try {
    const advapi32 = koffi.load('advapi32.dll');
    const shell32 = koffi.load('shell32.dll');
    fns = {
      regCreate: advapi32.func(
        'int32_t __stdcall RegCreateKeyExW(intptr_t hKey, str16 lpSubKey, uint32_t Reserved, str16 lpClass, uint32_t dwOptions, uint32_t samDesired, void* lpSecurityAttributes, void* phkResult, void* lpdwDisposition)'
      ),
      regOpen: advapi32.func(
        'int32_t __stdcall RegOpenKeyExW(intptr_t hKey, str16 lpSubKey, uint32_t ulOptions, uint32_t samDesired, void* phkResult)'
      ),
      regSet: advapi32.func(
        'int32_t __stdcall RegSetValueExW(intptr_t hKey, str16 lpValueName, uint32_t Reserved, uint32_t dwType, void* lpData, uint32_t cbData)'
      ),
      regQuery: advapi32.func(
        'int32_t __stdcall RegQueryValueExW(intptr_t hKey, str16 lpValueName, void* lpReserved, void* lpType, void* lpData, void* lpcbData)'
      ),
      regClose: advapi32.func('int32_t __stdcall RegCloseKey(intptr_t hKey)'),
      notifyDir: shell32.func(
        'void __stdcall SHChangeNotify(int32_t wEventId, uint32_t uFlags, str16 dwItem1, str16 dwItem2)'
      )
    };
    return fns;
  } catch (e) {
    console.error('[sysIcons] koffi init failed', e);
    return null;
  }
}

function openKey(f: SysIconFns, writable: boolean): bigint | null {
  const hkBuf = Buffer.alloc(8);
  const rc = writable
    ? f.regCreate(HKCU, SUBKEY, 0, null, 0, KEY_WRITE, null, hkBuf, null)
    : f.regOpen(HKCU, SUBKEY, 0, KEY_READ, hkBuf);
  if (rc !== 0) return null;
  return hkBuf.readBigUInt64LE(0);
}

/** Read one DWORD value; null when missing. */
function readDword(f: SysIconFns, name: string): number | null {
  const hk = openKey(f, false);
  if (hk === null) return null;
  try {
    const typeBuf = Buffer.alloc(4);
    const data = Buffer.alloc(4);
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(4);
    const rc = f.regQuery(hk, name, null, typeBuf, data, sizeBuf);
    if (rc !== 0) return null;
    return data.readUInt32LE(0);
  } finally {
    f.regClose(hk);
  }
}

function writeDword(f: SysIconFns, name: string, value: number): boolean {
  const hk = openKey(f, true);
  if (hk === null) {
    console.error('[sysIcons] cannot open/create registry key');
    return false;
  }
  try {
    const data = Buffer.alloc(4);
    data.writeUInt32LE(value >>> 0);
    const rc = f.regSet(hk, name, 0, REG_DWORD, data, 4);
    if (rc !== 0) {
      console.error('[sysIcons] RegSetValueExW failed rc=', rc, name);
      return false;
    }
    return true;
  } finally {
    f.regClose(hk);
  }
}

/** Best-effort desktop refresh so the change shows up without a reboot. */
export function refreshDesktop(desktopPath: string): void {
  try {
    // Without this the shell functions are never loaded when the refresh comes
    // from the organizer (only the registry path used to call load()).
    const f = load();
    f?.notifyDir(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, desktopPath, null);
  } catch {
    /* cosmetic only */
  }
  // UPDATEDIR alone does not re-evaluate attributes/policies on the desktop;
  // a real F5 to the SysListView32 is what makes the icons disappear at once.
  try {
    // Imported lazily to avoid a load-order cycle (win32 ← ffi is fine, but
    // keeping the dependency one-way here is simpler).
    const { refreshDesktopView } = require('./win32') as typeof import('./win32');
    refreshDesktopView();
  } catch {
    /* cosmetic only */
  }
}

/** Hide (true) or show (false) 此电脑 + 回收站 on the desktop. */
export function setSystemIconsHidden(hidden: boolean, desktopPath: string): boolean {
  const f = load();
  if (!f) return false;
  const value = hidden ? 1 : 0;
  const ok1 = writeDword(f, CLSID_THIS_PC, value);
  const ok2 = writeDword(f, CLSID_RECYCLE_BIN, value);
  if (ok1 || ok2) refreshDesktop(desktopPath);
  return ok1 && ok2;
}

/** True when the 此电脑 icon is currently hidden. */
export function isSystemIconsHidden(): boolean {
  const f = load();
  if (!f) return false;
  return readDword(f, CLSID_THIS_PC) === 1;
}
