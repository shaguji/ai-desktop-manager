import {
  readdirSync,
  statSync,
  renameSync,
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { join, basename, resolve, sep } from 'node:path';
import type { CategoryGroup, CategoryKey, CategoryRule, FileItemInfo, ScanResult } from '../shared/types';
import { classifyFile, effectiveMappings, matchTargetMapping, normalizeCategories, OTHER_KEY } from '../shared/categories';
import { loadConfig, patchConfig } from './config';
import { setHiddenAttr } from './native/fileAttrs';
import { refreshDesktop } from './native/sysIcons';

/** The 整理 tree is infrastructure — keep it off the visible desktop. */
export function hideOrgFolder(desktopPath: string): void {
  const base = join(desktopPath, ORG_DIR);
  if (existsSync(base)) {
    if (setHiddenAttr(base, true, true)) refreshDesktop(desktopPath);
  }
}

const ORG_DIR = '整理';
const MANIFEST = '.organize-manifest.json';
const TARGET_MANIFEST = '.target-manifest.json';
const manifestPath = (desktopPath: string) => join(desktopPath, ORG_DIR, MANIFEST);
const targetManifestPath = (desktopPath: string) => join(desktopPath, ORG_DIR, TARGET_MANIFEST);

/** Whether any restorable move data exists (legacy organize or target-dir moves). */
export function hasRestoreData(desktopPath: string): boolean {
  return hasManifest(desktopPath) || existsSync(targetManifestPath(desktopPath));
}

/**
 * Shell namespace entries surfaced inside the收纳 window. They are not files —
 * the desktop's real 此电脑 / 回收站 icons can be hidden (hiddenIcons) or sit
 * underneath a fence, so keeping them here guarantees access.
 */
const SYSTEM_ITEMS: Array<[name: string, target: string]> = [
  ['此电脑', '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}'],
  ['回收站', '::{645FF040-5081-101B-9F08-00AA002F954E}']
];

/**
 * Windows shows ONE desktop composed of TWO folders:
 *   %USERPROFILE%\Desktop   (per-user, writable)
 *   %PUBLIC%\Desktop        (shared, usually created by installers)
 * Scanning only the per-user folder is why shortcuts such as Chrome / QQ /
 * WeChat appeared "still on the desktop": they live in the shared folder and
 * were never seen by the organiser at all.
 */
export function desktopRoots(userDesktop: string): string[] {
  const roots = [userDesktop];
  const candidates = [
    process.env.PUBLIC ? join(process.env.PUBLIC, 'Desktop') : '',
    process.env.PUBLIC_ROOT ? join(process.env.PUBLIC_ROOT, 'Desktop') : '',
    // %USERPROFILE%\Desktop -> C:\Users\Public\Desktop
    join(userDesktop, '..', '..', 'Public', 'Desktop')
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (!existsSync(c)) continue;
      const abs = resolve(c);
      if (roots.some((r) => resolve(r).toLowerCase() === abs.toLowerCase())) continue;
      // Must be a readable directory.
      statSync(abs);
      roots.push(abs);
      break;
    } catch {
      /* try next candidate */
    }
  }
  return roots;
}

/** Shell bookkeeping files that must never be listed or moved. */
function isSystemJunk(name: string): boolean {
  const n = name.toLowerCase();
  if (n === 'desktop.ini' || n === 'thumbs.db' || n === '.ds_store') return true;
  // Office temp locks (~$foo.docx) and Word recovery temp files (~WRL1234.tmp).
  if (n.startsWith('~$') || n.startsWith('~wr')) return true;
  return false;
}

/** Active (enabled) rules from the user config, always normalised. */
export function activeRules(): CategoryRule[] {
  return normalizeCategories(loadConfig().categories).filter((r) => r.enabled);
}

export function hasManifest(desktopPath: string): boolean {
  return existsSync(manifestPath(desktopPath));
}

/**
 * 桌面是否处于「分组显示」状态。
 *
 * 新版整理不再移动文件：organized 只是配置里的一个开关，表示桌面层
 * 按分类把图标分组展示、并把系统桌面图标藏起来。旧版本把文件真正搬进了
 * 桌面\整理\<分类>\（存在 manifest），这里同样视为已分组，用户随时可以
 * 「撤销整理」把文件还原到原位置。
 */
export function isOrganized(desktopPath: string): boolean {
  if (hasManifest(desktopPath)) return true;
  try {
    return !!loadConfig().organized;
  } catch {
    return false;
  }
}

function statItem(full: string): FileItemInfo | null {
  try {
    const st = statSync(full);
    const name = basename(full);
    const isDir = st.isDirectory();
    const dot = name.lastIndexOf('.');
    return {
      name,
      path: full,
      isDir,
      ext: isDir || dot <= 0 ? '' : name.slice(dot),
      size: st.size,
      mtime: st.mtimeMs
    };
  } catch {
    return null;
  }
}

/**
 * Scan every desktop root and group entries by the user's classification rules.
 *
 * When the per-user desktop is already organised we read the files back out of
 * 整理/<子目录> and re-classify them, so renaming a category label (or editing
 * its extensions) still shows the files in the right fence. The shared desktop
 * is always scanned at its top level because it is never organised in place.
 */
export function scanDesktop(desktopPath: string, rules: CategoryRule[] = activeRules()): ScanResult {
  const groups: CategoryGroup[] = rules.map((r) => ({ key: r.key, label: r.label, items: [] }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const fallback = byKey.get(OTHER_KEY) ?? groups[groups.length - 1];
  const organized = isOrganized(desktopPath);
  const roots = desktopRoots(desktopPath);
  let total = 0;

  const push = (full: string) => {
    const item = statItem(full);
    if (!item) return;
    if (isSystemJunk(item.name)) return;
    const key: CategoryKey = classifyFile(item.name, item.isDir, rules);
    (byKey.get(key) ?? fallback)?.items.push(item);
    total++;
  };

  const scanTopLevel = (root: string, skipOrgDir: boolean) => {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch (e) {
      console.error('[organizer] cannot read desktop root', root, e);
      return;
    }
    for (const name of names) {
      if (skipOrgDir && name === ORG_DIR) continue;
      if (name.startsWith('.')) continue;
      push(join(root, name));
    }
  };

  // 1) 每个桌面根目录的顶层项目（原位分组：文件本来就待在这里，不做任何移动）。
  for (const root of roots) scanTopLevel(root, true);

  // 2) 兼容旧版「搬进文件夹」的数据：已经移进 桌面\整理\<分类>\ 的文件
  //    也要显示出来，否则升级后老用户会看到桌面空空如也。
  const legacyBase = join(desktopPath, ORG_DIR);
  if (hasManifest(desktopPath) && existsSync(legacyBase)) {
    try {
      for (const sub of readdirSync(legacyBase)) {
        if (sub === MANIFEST || sub.startsWith('.')) continue;
        const subPath = join(legacyBase, sub);
        let isDir = false;
        try {
          isDir = statSync(subPath).isDirectory();
        } catch {
          continue;
        }
        if (!isDir) {
          push(subPath);
          continue;
        }
        for (const name of readdirSync(subPath)) push(join(subPath, name));
      }
    } catch (e) {
      console.error('[organizer] scan 整理 failed', e);
    }
  }

  // 3) Shell namespace entries — virtual, never touch the filesystem.
  const sysGroup = byKey.get('system');
  if (sysGroup) {
    for (const [name, target] of SYSTEM_ITEMS) {
      sysGroup.items.push({ name, path: target, isDir: false, ext: '', size: 0, mtime: 0 });
      total++;
    }
  }

  return { desktopPath, roots, categories: groups, total, organized, legacy: hasRestoreData(desktopPath) };
}

/** Read a JSON object map (manifest files); any parse failure yields {}. */
function readRecord(p: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Append one orig→dest entry to the target-dir manifest (merge, not overwrite). */
function recordTargetMove(p: string, orig: string, dest: string): void {
  try {
    // 原位分组模式下桌面通常没有「整理」目录，首次记录时先建出来。
    mkdirSync(join(p, '..'), { recursive: true });
    const m = readRecord(p);
    m[orig] = dest;
    writeFileSync(p, JSON.stringify(m, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[organizer] cannot write target manifest', p, e);
  }
}

/** First free name inside `dir` for `name`, deduped as "name (2)", "name (3)"… */
function uniqueDest(dir: string, name: string): string {
  let dest = join(dir, name);
  if (!existsSync(dest)) return dest;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (existsSync(dest) && n < 1000) dest = join(dir, `${stem} (${n++})${suffix}`);
  if (existsSync(dest)) throw new Error('目标目录已存在同名文件且重名次数超限');
  return dest;
}

/**
 * Recursive directory copy without fs.cpSync.
 *
 * cpSync segfaults (0xC0000005) on Node v22.22.2/Windows when the source
 * directory name contains non-ASCII characters (e.g. 中文文件夹) — reproduced
 * with a minimal script, so it must never be used in the organize flow.
 * Plain readdirSync/copyFileSync/mkdirSync is slower but stable.
 */
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else if (e.isFile()) copyFileSync(s, d);
    /* 符号链接/挂载点一律跳过，避免递归环与越权复制 */
  }
}

/**
 * Move that also works across drives: renameSync fails with EXDEV when src and
 * dest live on different volumes, so fall back to copy+delete. If the delete
 * half fails the copy is rolled back — silently keeping both copies would be
 * worse than reporting the move as blocked.
 */
function moveAny(src: string, dest: string): void {
  try {
    renameWithRetry(src, dest);
    return;
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
  }
  const st = statSync(src);
  if (st.isDirectory()) {
    copyDirSync(src, dest);
    try {
      rmSync(src, { recursive: true, force: true });
    } catch (e) {
      try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
      throw e;
    }
  } else {
    copyFileSync(src, dest);
    try {
      unlinkSync(src);
    } catch (e) {
      try { unlinkSync(dest); } catch { /* ignore */ }
      throw e;
    }
  }
}

/**
 * 归属目录移动：一键整理时，把桌面顶层文件名命中映射关键字的文件/文件夹
 * 真正移动到映射的 targetDir（目录不存在则自动创建，跨盘符也能移动）。
 *
 * 每条规则可配置多组「关键字 → 归属目录」映射（mappings），旧版单映射
 * （keywords + targetDir）作为兜底；规则顺序即优先级，规则内按映射顺序取
 * 第一条命中。每次成功移动都记录进 整理/.target-manifest.json（orig→dest），
 * 「撤销整理 / 还原文件」时按记录原路移回。
 */
export function applyTargetMoves(desktopPath: string): { moved: number; blocked: number } {
  let moved = 0;
  let blocked = 0;
  let rules: CategoryRule[] = [];
  try {
    rules = activeRules();
  } catch {
    return { moved, blocked };
  }
  const targets = rules.filter((r) => effectiveMappings(r).length > 0);
  if (!targets.length) return { moved, blocked };

  for (const root of desktopRoots(desktopPath)) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === ORG_DIR || name.startsWith('.')) continue;
      const full = join(root, name);
      const item = statItem(full);
      if (!item || isSystemJunk(item.name)) continue;
      const hit = matchTargetMapping(item.name.toLowerCase(), targets);
      if (!hit) continue;
      const targetDir = hit.mapping.targetDir;
      const fullRes = resolve(full).toLowerCase();
      const dirRes = resolve(targetDir).toLowerCase();
      // 已经在归属目录里（或目录本身就在桌面上被扫描到）：不要自己搬自己。
      if (fullRes === dirRes || fullRes.startsWith(dirRes + sep.toLowerCase())) continue;
      try {
        mkdirSync(targetDir, { recursive: true });
        const dest = uniqueDest(targetDir, item.name);
        moveAny(full, dest);
        recordTargetMove(targetManifestPath(desktopPath), full, dest);
        moved++;
      } catch (err: any) {
        blocked++;
        console.warn('[organizer] target move failed', full, '->', targetDir, err?.code ?? err?.message);
      }
    }
  }
  if (moved > 0) refreshDesktop(desktopPath);
  return { moved, blocked };
}

/**
 * renameSync with retries. A file that was *just* created (download finished,
 * save dialog closed) is briefly locked by the search indexer / antivirus, and
 * an immediate rename fails with EBUSY/EPERM — which is exactly when users hit
 * 一键整理, so "file never lands in the fence" reports. A few short retries
 * cover that window.
 */
function renameWithRetry(src: string, dest: string, attempts = 4): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(src, dest);
      return;
    } catch (err: any) {
      const code = String(err?.code ?? '');
      const transient = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      if (!transient || i >= attempts - 1) throw err;
      // Synchronous sleep without worker threads (main process must not async-wait here).
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (i + 1));
    }
  }
}

/**
 * 「一键整理」= 原位分组，不移动任何文件。
 *
 * 通行做法（Fences、腾讯桌面整理、360 桌面助手）都是这样：文件留在原地，
 * 只把桌面层的图标按分类重新排布，并隐藏系统桌面图标，由收纳窗口接管显示。
 * 资源管理器里的路径、文件夹结构、快捷方式依赖全部保持原样，也就不存在
 * 「撤销还原失败 / 公共桌面需要管理员权限」这些问题。
 *
 * legacy 为 true 表示旧版把文件搬进了「整理」文件夹，渲染层会先询问用户
 * 是否把它们还原到原位置，再切换到原位分组。
 */
export function applyOrganize(
  desktopPath: string
): { ok: boolean; moved: number; blocked: number; legacy: boolean; error?: string } {
  try {
    /* 旧数据里可能还有隐藏的「整理」目录，继续保持不可见（仅兼容） */
    hideOrgFolder(desktopPath);
    // 归属目录规则：命中关键字的项目在这一步真正移动到归属目录。
    const moves = applyTargetMoves(desktopPath);
    patchConfig({ organized: true });
    return {
      ok: true,
      moved: moves.moved,
      blocked: moves.blocked,
      legacy: hasRestoreData(desktopPath)
    };
  } catch (e: any) {
    return { ok: false, moved: 0, blocked: 0, legacy: false, error: String(e?.message || e) };
  }
}

/**
 * Move `src` onto the user's desktop, deduplicating the name when needed.
 * Returns false when the file is locked or the name could not be freed.
 */
function moveToDesktop(src: string, desktopPath: string): boolean {
  const name = basename(src);
  let dest = join(desktopPath, name);
  if (existsSync(dest)) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const suffix = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (existsSync(dest) && n < 1000) dest = join(desktopPath, `${stem} (${n++})${suffix}`);
    if (existsSync(dest)) return false;
  }
  try {
    moveAny(src, dest);
    return true;
  } catch (err: any) {
    console.warn('[organizer] move to desktop failed', src, err?.code ?? err);
    return false;
  }
}

/**
 * Put one entry back where it came from.
 *
 * Shortcuts that were collected from C:\Users\Public\Desktop cannot be written
 * back without administrator rights (rename fails with EPERM). Rather than
 * leaving them stranded inside 整理 — which made "撤销整理" look like it did
 * nothing — fall back to the per-user desktop, where the icon is still visible.
 */
function restoreEntry(
  dest: string,
  orig: string,
  desktopPath: string
): 'restored' | 'blocked' {
  if (!existsSync(orig)) {
    try {
      // 归属目录可能在另一个盘符上，rename 会抛 EXDEV，必须走 moveAny。
      moveAny(dest, orig);
      return 'restored';
    } catch (err: any) {
      console.warn('[organizer] restore blocked', dest, '->', orig, err?.code ?? err);
    }
  }
  // Fallback: same file name on the user's own desktop.
  const fallback = join(desktopPath, basename(orig));
  if (resolve(fallback) !== resolve(orig) && !existsSync(fallback)) {
    if (moveToDesktop(dest, desktopPath)) {
      console.log('[organizer] restored to user desktop instead:', fallback);
      return 'restored';
    }
  }
  return 'blocked';
}

/**
 * 退出分组显示。
 *
 * - 旧版数据（存在 manifest）：文件确实被搬进了「整理」，按记录还原到原路径；
 * - 新版原位分组：文件从未移动过，只要关闭开关，渲染层恢复系统桌面图标即可。
 *
 * 两条路径都会把 organized 置回 false，避免桌面一直空着。
 */
export function undoOrganize(
  desktopPath: string
): { ok: boolean; restored: number; blocked: number } {
  const legacy = hasManifest(desktopPath);
  let restored = 0;
  let blocked = 0;

  try {
    if (legacy) {
      const mp = manifestPath(desktopPath);
      const manifest = readRecord(mp);
      const leftover: Record<string, string> = {};

      for (const [orig, dest] of Object.entries(manifest)) {
        // Nothing left to undo for entries the user already removed by hand.
        if (!existsSync(dest)) continue;
        if (restoreEntry(dest, orig, desktopPath) === 'restored') restored++;
        else {
          blocked++;
          leftover[orig] = dest;
        }
      }

      const base = join(desktopPath, ORG_DIR);

      // Sweep orphans: files sitting inside 整理 without a manifest entry (left
      // behind by an interrupted undo). 撤销整理 must always empty the tree.
      try {
        for (const sub of readdirSync(base)) {
          if (sub === MANIFEST || sub === TARGET_MANIFEST || sub.startsWith('.')) continue;
          const subPath = join(base, sub);
          let isDir = false;
          try {
            isDir = statSync(subPath).isDirectory();
          } catch {
            continue;
          }
          const entries = isDir ? readdirSync(subPath).map((n) => join(subPath, n)) : [subPath];
          for (const src of entries) {
            if (moveToDesktop(src, desktopPath)) restored++;
            else blocked++;
          }
        }
      } catch (e) {
        console.warn('[organizer] orphan sweep failed', e);
      }

      // Keep undo information only for the entries that could not be moved.
      try {
        if (Object.keys(leftover).length) {
          writeFileSync(mp, JSON.stringify(leftover, null, 2), 'utf-8');
        } else {
          unlinkSync(mp);
        }
      } catch {
        /* ignore */
      }
    }

    // 归属目录移动的还原：按 .target-manifest.json 把文件移回原来的位置。
    const tmp = targetManifestPath(desktopPath);
    if (existsSync(tmp)) {
      const manifest = readRecord(tmp);
      const tLeftover: Record<string, string> = {};
      for (const [orig, dest] of Object.entries(manifest)) {
        if (!existsSync(dest)) continue;
        if (restoreEntry(dest, orig, desktopPath) === 'restored') restored++;
        else {
          blocked++;
          tLeftover[orig] = dest;
        }
      }
      try {
        if (Object.keys(tLeftover).length) {
          writeFileSync(tmp, JSON.stringify(tLeftover, null, 2), 'utf-8');
        } else {
          unlinkSync(tmp);
        }
      } catch {
        /* ignore */
      }
    }

    // Remove the 整理 tree only when neither manifest has leftovers. Hidden
    // leftovers (manifest backups, .DS_Store…) must not keep the folder alive.
    const base = join(desktopPath, ORG_DIR);
    if (!existsSync(manifestPath(desktopPath)) && !existsSync(tmp) && existsSync(base)) {
      try {
        const remains = readdirSync(base).filter((n) => !n.startsWith('.'));
        const empty = remains.every((sub) => {
          try {
            const p = join(base, sub);
            return statSync(p).isDirectory() && readdirSync(p).length === 0;
          } catch {
            return false;
          }
        });
        if (empty) rmSync(base, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    // Whatever survived the undo stays out of sight as well. Files came back
    // while the icon list was hidden — rebuild the list view here.
    if (legacy || restored > 0) {
      hideOrgFolder(desktopPath);
      refreshDesktop(desktopPath);
    }
    patchConfig({ organized: false });
    return { ok: true, restored, blocked };
  } catch {
    /* 还原中途出错也要关掉分组开关，否则桌面会一直处于「空桌面」状态 */
    try { patchConfig({ organized: false }); } catch { /* ignore */ }
    return { ok: false, restored, blocked };
  }
}
