import type { CategoryRule, CategoryKey, TargetMapping } from './types';

/** Fallback category key; always present and never removable. */
export const OTHER_KEY = 'other';

/**
 * Built-in classification rules.
 *
 * Design notes:
 *  - 分类刻意保持精简：系统 / 应用程序 / 文件夹 / 文件 / 其他。
 *    图片、视频、音乐、压缩包、代码、安装包全部并入「文件」，
 *    避免标签栏被一堆只有一两个文件的分类占满。
 *  - 应用程序 covers launchable things (shortcut, exe, url, script).
 *  - 用户仍可在设置里自行添加更细的分类规则。
 */
export const DEFAULT_CATEGORIES: CategoryRule[] = [
  {
    key: 'document',
    label: '文件',
    exts: [
      // 常规文档
      'doc', 'docx', 'wps', 'xls', 'xlsx', 'et', 'ppt', 'pptx', 'dps',
      'pdf', 'txt', 'md', 'csv', 'rtf', 'odt', 'ods', 'odp',
      'xmind', 'epub', 'xps', 'one', 'log',
      // 图片
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif', 'heic', 'ico', 'psd', 'raw',
      // 视频
      'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'rmvb', 'ts',
      // 音乐
      'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'ape',
      // 压缩包
      'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab',
      // 安装包
      'msi', 'msix', 'appx', 'iso', 'img', 'apk', 'dmg', 'deb', 'rpm', 'pkg',
      // 代码
      'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs',
      'php', 'rb', 'sh', 'sql', 'json', 'xml', 'yml', 'yaml', 'html', 'htm', 'css'
    ],
    builtin: true,
    enabled: true
  },
  {
    key: 'app',
    label: '应用程序',
    exts: ['lnk', 'exe', 'url', 'appref-ms', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'jar', 'msc'],
    builtin: true,
    enabled: true
  },
  {
    key: 'folder',
    label: '文件夹',
    exts: [],
    matchDir: true,
    builtin: true,
    enabled: true
  },
  {
    // Virtual entries (此电脑 / 回收站). No real file ever classifies here —
    // scanDesktop injects them so the shell icons stay reachable even when the
    // native desktop icons are hidden or covered by a fence.
    key: 'system',
    label: '系统',
    exts: [],
    builtin: true,
    enabled: true
  },
  {
    key: OTHER_KEY,
    label: '其他',
    exts: [],
    builtin: true,
    enabled: true
  }
];

/**
 * v5 category merge: these legacy built-ins were folded into 「文件」.
 * normalizeCategories re-homes their extensions on load, so existing users
 * keep everything classified without seeing six near-empty tabs.
 */
const LEGACY_FILE_KEYS = ['image', 'video', 'audio', 'archive', 'installer', 'code'];

export function cloneDefaultCategories(): CategoryRule[] {
  return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}

/**
 * Fixed display order of the收纳 tab strip: system locations first, then app
 * shortcuts, then folders, and finally the file bucket. Keys that are not
 * listed (user-defined categories) keep their relative order right after the
 * built-ins, and "其他" is always pinned last.
 */
const TAB_ORDER = ['system', 'app', 'folder', 'document'];

export function tabRank(key: string): number {
  if (key === OTHER_KEY) return 1000;
  const i = TAB_ORDER.indexOf(key);
  return i === -1 ? 100 : i;
}

const cleanExt = (e: string) => e.trim().toLowerCase().replace(/^\*?\./, '');

/**
 * Repair / complete a rule list coming from disk or from the UI:
 * drops malformed entries, normalises extensions and guarantees that the
 * "其他" fallback exists exactly once and stays last.
 */
export function normalizeCategories(input: unknown): CategoryRule[] {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: CategoryRule[] = [];
  /** Extensions collected from the legacy 图片/视频/… built-ins (v5 merge). */
  let legacyFileExts: string[] = [];

  for (const r of raw as CategoryRule[]) {
    if (!r || typeof r !== 'object') continue;
    const key = String((r as any).key ?? '').trim();
    let label = String((r as any).label ?? '').trim();
    if (!key || !label || seen.has(key)) continue;
    // v4: the document bucket was renamed 文档 -> 文件 (it holds pdf/xls/md/…,
    // which users call "文件"). Only rewrite the pristine default label so a
    // hand-written custom name is preserved.
    if (key === 'document' && label === '文档') label = '文件';
    // v5: 图片/视频/音乐/压缩包/安装包/代码 merged into 文件 — their
    // extensions move over so nothing falls into 其他 after the upgrade.
    if (LEGACY_FILE_KEYS.includes(key) && r.builtin === true) {
      legacyFileExts.push(...(Array.isArray(r.exts) ? r.exts : []));
      continue;
    }
    seen.add(key);
    const targetDirRaw = String((r as any).targetDir ?? '').trim();
    // 移动映射表：丢弃缺关键字或缺目录的残行，关键字统一小写去重。
    const mappingsRaw = Array.isArray((r as any).mappings) ? ((r as any).mappings as TargetMapping[]) : [];
    const mappings: TargetMapping[] = mappingsRaw
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({
        keywords: Array.isArray(m.keywords)
          ? Array.from(new Set(m.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)))
          : [],
        targetDir: String(m.targetDir ?? '').trim()
      }))
      .filter((m) => m.targetDir && m.keywords.length > 0);
    out.push({
      key,
      label,
      exts: Array.isArray(r.exts) ? Array.from(new Set(r.exts.map(cleanExt).filter(Boolean))) : [],
      keywords: Array.isArray(r.keywords)
        ? Array.from(new Set(r.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)))
        : [],
      targetDir: targetDirRaw || undefined,
      mappings: mappings.length ? mappings : undefined,
      matchDir: r.matchDir === true,
      builtin: r.builtin === true,
      enabled: r.enabled !== false
    });
  }

  // Make sure every built-in rule still exists (e.g. after an app upgrade).
  for (const def of DEFAULT_CATEGORIES) {
    if (!seen.has(def.key)) {
      seen.add(def.key);
      out.push(JSON.parse(JSON.stringify(def)));
    }
  }

  // Fold the legacy extensions into the 文件 rule.
  if (legacyFileExts.length) {
    const doc = out.find((r) => r.key === 'document');
    if (doc) doc.exts = Array.from(new Set([...doc.exts, ...legacyFileExts.map(cleanExt).filter(Boolean)]));
  }

  // "其他" must exist, stay enabled and sit last.
  const otherIdx = out.findIndex((r) => r.key === OTHER_KEY);
  const other =
    otherIdx >= 0
      ? out.splice(otherIdx, 1)[0]
      : { key: OTHER_KEY, label: '其他', exts: [], builtin: true, enabled: true };
  other.enabled = true;
  other.builtin = true;
  out.push(other);

  // Canonical tab order (stable, so user-defined categories keep their order).
  out.sort((a, b) => tabRank(a.key) - tabRank(b.key));

  return out;
}

/**
 * Classify one desktop entry.
 * User-defined rules win over built-in ones, so a custom "工作资料 = docx,pdf"
 * rule can steal files from the built-in 文档 category.
 */
function extOf(nameLower: string): string {
  const i = nameLower.lastIndexOf('.');
  // i <= 0 covers "README" (no dot) and ".gitignore" (leading dot only).
  return i <= 0 ? '' : nameLower.slice(i + 1);
}

export function classifyFile(name: string, isDir: boolean, rules: CategoryRule[]): CategoryKey {
  const lower = name.toLowerCase();
  const ext = isDir ? '' : extOf(lower);
  const active = rules.filter((r) => r.enabled && r.key !== OTHER_KEY);
  const ordered = [...active.filter((r) => !r.builtin), ...active.filter((r) => r.builtin)];

  // 1) file-name keywords (strongest signal, works for folders too)
  for (const r of ordered) {
    if (r.keywords && r.keywords.some((k) => k && lower.includes(k))) return r.key;
  }
  // 2) directories
  if (isDir) {
    const dirRule = ordered.find((r) => r.matchDir);
    return dirRule ? dirRule.key : OTHER_KEY;
  }
  // 3) extensions
  if (ext) {
    for (const r of ordered) {
      if (!r.matchDir && r.exts.includes(ext)) return r.key;
    }
  }
  return OTHER_KEY;
}

/**
 * 规则的生效移动映射列表：显式 mappings 在前，旧版单映射（keywords+targetDir）
 * 作为兜底映射追加在后。两类都为空时返回 []，该规则不参与移动。
 */
export function effectiveMappings(r: CategoryRule): TargetMapping[] {
  const out: TargetMapping[] = [...(r.mappings ?? [])];
  if (r.targetDir && (r.keywords?.length ?? 0) > 0) {
    out.push({ keywords: r.keywords!, targetDir: r.targetDir });
  }
  return out;
}

export interface MatchedTarget {
  rule: CategoryRule;
  mapping: TargetMapping;
}

/**
 * 归属目录匹配：按规则列表顺序、规则内映射顺序，返回第一条
 * 「启用了移动映射且文件名命中关键字」的映射。没有配置映射的规则不参与。
 */
export function matchTargetMapping(
  nameLower: string,
  rules: CategoryRule[]
): MatchedTarget | null {
  for (const r of rules) {
    if (!r.enabled) continue;
    for (const m of effectiveMappings(r)) {
      if (m.keywords.some((k) => k && nameLower.includes(k))) return { rule: r, mapping: m };
    }
  }
  return null;
}

/** Filesystem-safe folder name derived from a category label. */
export function safeFolderName(label: string): string {
  const cleaned = label.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || '未命名';
}

export function nextCustomKey(rules: CategoryRule[]): string {
  let i = 1;
  const keys = new Set(rules.map((r) => r.key));
  while (keys.has('custom-' + i)) i++;
  return 'custom-' + i;
}
