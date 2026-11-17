// File-attribute helpers backed by kernel32 (fs cannot touch the Windows
// HIDDEN bit, which Explorer uses to keep infrastructure folders off-screen).
import koffi from 'koffi';
import { isWindows } from './ffi';

const FILE_ATTRIBUTE_HIDDEN = 0x2;
const FILE_ATTRIBUTE_SYSTEM = 0x4;

let setAttrs: ((p: string, attrs: number) => number) | null = null;
let getAttrs: ((p: string) => number) | null = null;

function load(): boolean {
  if (!isWindows) return false;
  if (setAttrs && getAttrs) return true;
  try {
    const kernel32 = koffi.load('kernel32.dll');
    getAttrs = kernel32.func('uint32_t __stdcall GetFileAttributesW(str16 lpFileName)');
    setAttrs = kernel32.func(
      'int32_t __stdcall SetFileAttributesW(str16 lpFileName, uint32_t dwFileAttributes)'
    );
    return true;
  } catch (e) {
    console.error('[fileAttrs] koffi init failed', e);
    return false;
  }
}

/**
 * Set or clear the HIDDEN (and optionally SYSTEM) bit while preserving every
 * other attribute. SYSTEM matters because many users keep "显示隐藏文件" on —
 * hidden+system still stays invisible while "隐藏受保护的操作系统文件"
 * (default ON) is enabled.
 */
export function setHiddenAttr(p: string, hidden: boolean, system = false): boolean {
  if (!load()) return false;
  try {
    const cur = getAttrs!(p);
    if (cur === 0xffffffff) return false; // INVALID_FILE_ATTRIBUTES
    let next = hidden ? cur | FILE_ATTRIBUTE_HIDDEN : cur & ~FILE_ATTRIBUTE_HIDDEN;
    next = system ? next | FILE_ATTRIBUTE_SYSTEM : next & ~FILE_ATTRIBUTE_SYSTEM;
    if (next === cur) return true;
    return setAttrs!(p, next >>> 0) !== 0;
  } catch (e) {
    console.warn('[fileAttrs] setHiddenAttr failed for', p, e);
    return false;
  }
}
