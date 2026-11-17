// Verify HKCU HideDesktopIcons registry write + desktop refresh behavior.
const koffi = require('koffi');

const advapi32 = koffi.load('advapi32.dll');
const shell32 = koffi.load('shell32.dll');
const regCreate = advapi32.func(
  'int32_t __stdcall RegCreateKeyExW(intptr_t hKey, str16 lpSubKey, uint32_t Reserved, str16 lpClass, uint32_t dwOptions, uint32_t samDesired, void* lpsa, void* phkResult, void* lpdwDisposition)'
);
const regOpen = advapi32.func(
  'int32_t __stdcall RegOpenKeyExW(intptr_t hKey, str16 lpSubKey, uint32_t ulOptions, uint32_t samDesired, void* phkResult)'
);
const regSet = advapi32.func(
  'int32_t __stdcall RegSetValueExW(intptr_t hKey, str16 lpValueName, uint32_t Reserved, uint32_t dwType, void* lpData, uint32_t cbData)'
);
const regQuery = advapi32.func(
  'int32_t __stdcall RegQueryValueExW(intptr_t hKey, str16 lpValueName, void* lpReserved, void* lpType, void* lpData, void* lpcbData)'
);
const regClose = advapi32.func('int32_t __stdcall RegCloseKey(intptr_t hKey)');
const notifyDir = shell32.func(
  'void __stdcall SHChangeNotify(int32_t wEventId, uint32_t uFlags, str16 dwItem1, str16 dwItem2)'
);

const SUBKEY =
  'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel';
const GUIDS = [
  '{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
  '{645FF040-5081-101B-9F08-00AA002F954E}'
];
const HKCU = 0x80000001n;
const KEY_WRITE = 0x20006;
const KEY_READ = 0x20019;
const REG_DWORD = 4;

const mode = process.argv[2] || 'hide'; // hide | show | read

function open(writable) {
  const buf = Buffer.alloc(8);
  const rc = writable
    ? regCreate(HKCU, SUBKEY, 0, null, 0, KEY_WRITE, null, buf, null)
    : regOpen(HKCU, SUBKEY, 0, KEY_READ, buf);
  if (rc !== 0) { console.error('open failed rc=', rc); process.exit(1); }
  return buf.readBigUInt64LE(0);
}

function read(name) {
  const hk = open(false);
  try {
    const type = Buffer.alloc(4), data = Buffer.alloc(4), size = Buffer.alloc(4);
    size.writeUInt32LE(4);
    const rc = regQuery(hk, name, null, type, data, size);
    return rc === 0 ? data.readUInt32LE(0) : null;
  } finally { regClose(hk); }
}

if (mode === 'read') {
  for (const g of GUIDS) console.log(g, '=', read(g));
  process.exit(0);
}

const value = mode === 'hide' ? 1 : 0;
const hk = open(true);
try {
  for (const g of GUIDS) {
    const data = Buffer.alloc(4);
    data.writeUInt32LE(value);
    const rc = regSet(hk, g, 0, REG_DWORD, data, 4);
    console.log('set', g, '=', value, 'rc =', rc);
  }
} finally { regClose(hk); }
notifyDir(0x1000, 0x3005, 'C:\\Users\\surface\\Desktop', null);
console.log('notify sent; now values =', GUIDS.map((g) => read(g)).join(','));
