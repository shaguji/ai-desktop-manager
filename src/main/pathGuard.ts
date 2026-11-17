import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * 判断 target 是否真的位于 dir 内（含任意深度子目录）。
 *
 * 前缀 `startsWith` 会被 `C:\media\..\secret.txt` 这类路径绕过，统一走这里：
 * 先 resolve 成绝对路径折叠掉 `..` / `/`，再用 relative 判断方向；
 * 已经存在的文件/目录会再做一次 realpath，防止符号链接跳出目录。
 * （realpath 失败说明路径还不存在——比如要新建的 sidecar 文件——用 resolve 结果即可。）
 */
export function isPathInside(dir: string, target: string): boolean {
  let d = resolve(dir);
  let t = resolve(target);
  try { d = realpathSync(d); } catch { /* 目录尚不存在 */ }
  try { t = realpathSync(t); } catch { /* 目标尚不存在 */ }
  if (d === t) return false;
  const rel = relative(d, t);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
