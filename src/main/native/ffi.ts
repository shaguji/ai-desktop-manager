import koffi from 'koffi';

export const isWindows = process.platform === 'win32';

// Constants used by the high-level wrappers
export const SW_HIDE = 0;
export const SW_SHOW = 5;
export const GWL_STYLE = -16;
export const WS_VISIBLE = 0x10000000;

let api: any = null;

export interface Win32Api {
  FindWindowW: (cls: string | null, title: string | null) => any;
  FindWindowExW: (
    parent: any,
    after: any,
    cls: string | null,
    title: string | null
  ) => any;
  SendMessageTimeoutW: (
    hwnd: any,
    msg: number,
    w: number,
    l: number,
    f: number,
    t: number,
    res: any
  ) => number;
  PostMessageW: (hwnd: any, msg: number, w: number, l: number) => number;
  ShowWindow: (hwnd: any, cmd: number) => boolean;
  GetWindowLongW: (hwnd: any, idx: number) => number;
  SetWindowLongW: (hwnd: any, idx: number, val: number) => number;
  SystemParametersInfoW: (
    action: number,
    param: number,
    pv: any,
    ini: number
  ) => boolean;
  GetCursorPos: (pt: object) => number;
}

/**
 * Lazily load the Win32 API surface through koffi.
 *
 * Critical fix: Win32 functions that document "BOOL" actually return int32_t
 * (4 bytes, 0 = false / nonzero = true), NOT C99 bool (1 byte).
 * Using koffi 'bool' truncates the return value and can make successful calls
 * appear to fail. All BOOL-returning functions now use int32_t.
 */
export function getWin32(): Win32Api | null {
  if (!isWindows) {
    console.error('[ffi] not windows platform:', process.platform);
    return null;
  }
  if (api) return api;
  try {
    const user32 = koffi.load('user32.dll');
    console.log('[ffi] user32.dll loaded successfully');
    koffi.struct('FfiPoint', { x: 'int32', y: 'int32' });
    api = {
      // HWND __stdcall FindWindowW(LPCWSTR lpClassName, LPCWSTR lpWindowName)
      FindWindowW: user32.func(
        'void* FindWindowW(str16 lpClassName, str16 lpWindowName)'
      ),
      // HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, LPCWSTR lpszClass, LPCWSTR lpszWindow)
      FindWindowExW: user32.func(
        'void* FindWindowExW(void* hWndParent, void* hWndChildAfter, str16 lpszClass, str16 lpszWindow)'
      ),
      // LRESULT __stdcall SendMessageTimeoutW(HWND, UINT, WPARAM, LPARAM, UINT, UINT, PDWORD_PTR)
      SendMessageTimeoutW: user32.func(
        'intptr_t SendMessageTimeoutW(void* hWnd, uint32_t Msg, intptr_t wParam, intptr_t lParam, uint32_t fuFlags, uint32_t uTimeout, void* lpdwResult)'
      ),
      PostMessageW: user32.func(
        'int32_t PostMessageW(void* hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)'
      ),
      // BOOL __stdcall ShowWindow(HWND, int) — BOOL is int32_t, NOT C99 bool!
      ShowWindow: user32.func('int32_t ShowWindow(void* hWnd, int32_t nCmdShow)'),
      // LONG __stdcall GetWindowLongW(HWND, int)
      GetWindowLongW: user32.func('int32_t GetWindowLongW(void* hWnd, int32_t nIndex)'),
      // LONG __stdcall SetWindowLongW(HWND, int, LONG)
      SetWindowLongW: user32.func(
        'int32_t SetWindowLongW(void* hWnd, int32_t nIndex, int32_t dwNewLong)'
      ),
      // BOOL __stdcall SystemParametersInfoW(UINT, UINT, PVOID, UINT)
      SystemParametersInfoW: user32.func(
        'int32_t SystemParametersInfoW(uint32_t uiAction, uint32_t uiParam, void* pvParam, uint32_t fWinIni)'
      ),
      // BOOL __stdcall GetCursorPos(LPPOINT) — screen coordinates, physical px
      GetCursorPos: user32.func('int32_t GetCursorPos(_Out_ FfiPoint *pt)')
    } as Win32Api;

    // Quick smoke-test: can we find Progman?
    try {
      const testHwnd = api.FindWindowW('Progman', null);
      console.log('[ffi] smoke test FindWindowW(Progman) =', testHwnd);
    } catch (e) {
      console.error('[ffi] smoke test failed', e);
    }
  } catch (e) {
    console.error('[ffi] failed to load win32 api', e);
    api = null;
  }
  return api;
}
