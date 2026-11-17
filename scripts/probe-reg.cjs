const koffi = require('koffi');
const advapi32 = koffi.load('advapi32.dll');
const RegOpenKeyExW = advapi32.func('int32_t __stdcall RegOpenKeyExW(intptr_t hKey, str16 lpSubKey, uint32_t ulOptions, uint32_t samDesired, void* phkResult)');
const RegQueryValueExW = advapi32.func('int32_t __stdcall RegQueryValueExW(intptr_t hKey, str16 lpValueName, void* lpReserved, void* lpType, void* lpData, void* lpcbData)');
const RegCloseKey = advapi32.func('int32_t __stdcall RegCloseKey(intptr_t hKey)');

const hkBuf = Buffer.alloc(8);
const sub = 'CLSID\\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\\DefaultIcon';
const r1 = RegOpenKeyExW(0x80000000n, sub, 0, 0x20019, hkBuf);
console.log('open rc=', r1, 'hk=', hkBuf.readBigUInt64LE(0).toString());
if (r1 === 0) {
  const typeBuf = Buffer.alloc(4);
  const data = Buffer.alloc(2048);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(data.length);
  const r2 = RegQueryValueExW(hkBuf.readBigUInt64LE(0), null, null, typeBuf, data, sizeBuf);
  console.log('query rc=', r2, 'type=', typeBuf.readUInt32LE(0), 'size=', sizeBuf.readUInt32LE(0));
  console.log('value=', JSON.stringify(data.toString('utf16le', 0, Math.min(sizeBuf.readUInt32LE(0), data.length))));
  RegCloseKey(hkBuf.readBigUInt64LE(0));
}
