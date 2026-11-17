/* ═══════════════════════════════════════════════════
   密码箱：网址 / 账号 / 密码的本地加密存储
   · 主密码经 PBKDF2(SHA-256, 21 万次) 派生出 AES-GCM 256 密钥
   · 落盘的只有 salt / iv / 密文；明文只存在于解锁后的内存里
   · 换一台机器、换一个浏览器都解不开；忘记主密码无法找回
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const ITER = 210000;
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const VERSION = 1;

  let key = null;        // CryptoKey（解锁后才有）
  let items = null;      // 明文条目数组（只在内存）
  let saltB64 = '';      // 当前 salt（base64），重新加密时沿用
  let lastActive = 0;    // 最近一次交互时间
  let lockTimer = null;
  let saveTimer = null;
  const subs = new Set();

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ── base64 ⇄ ArrayBuffer ── */
  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromB64(str) {
    const bin = atob(String(str || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function supported() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.subtle.importKey);
  }

  function assertSupported() {
    if (!supported()) {
      throw new Error('当前环境不支持加密（需要安全上下文），请通过桌面管家打开');
    }
  }

  async function deriveKey(password, saltBytes) {
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(String(password || '')), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptItems() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = enc.encode(JSON.stringify({ items: items || [] }));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return { iv: toB64(iv), ct: toB64(ct) };
  }

  async function persist() {
    if (!key) return false;
    const box = await encryptItems();
    Store.setVault({
      v: VERSION,
      iter: ITER,
      salt: saltB64,
      iv: box.iv,
      ct: box.ct,
      updatedAt: Date.now()
    });
    return true;
  }

  function notify() {
    subs.forEach((fn) => { try { fn(isUnlocked()); } catch (e) { /* ignore */ } });
  }

  function startAutoLock() {
    stopAutoLock();
    lastActive = Date.now();
    lockTimer = setInterval(() => {
      if (!key) { stopAutoLock(); return; }
      if (Date.now() - lastActive > AUTO_LOCK_MS) lock(true);
    }, 20000);
  }

  function stopAutoLock() {
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = null;
  }

  /* ── 对外接口 ── */
  function has() { return !!Store.getVault(); }
  function isUnlocked() { return !!key; }
  function isSupported() { return supported(); }

  /** 首次创建密码箱 */
  async function create(password) {
    assertSupported();
    const pwd = String(password || '');
    if (pwd.length < 6) throw new Error('主密码至少 6 位');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltB64 = toB64(salt);
    key = await deriveKey(pwd, salt);
    items = [];
    const box = await encryptItems();
    Store.setVault({
      v: VERSION,
      iter: ITER,
      salt: saltB64,
      iv: box.iv,
      ct: box.ct,
      updatedAt: Date.now()
    });
    startAutoLock();
    notify();
    return true;
  }

  /** 解锁；密码错误时抛错 */
  async function unlock(password) {
    assertSupported();
    const blob = Store.getVault();
    if (!blob) throw new Error('还没有创建密码箱');
    const salt = fromB64(blob.salt);
    const k = await deriveKey(password, salt);
    let plain;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(blob.iv) }, k, fromB64(blob.ct)
      );
    } catch (e) {
      throw new Error('主密码不正确');
    }
    const data = JSON.parse(dec.decode(plain));
    key = k;
    saltB64 = blob.salt;
    items = Array.isArray(data.items) ? data.items : [];
    startAutoLock();
    notify();
    return true;
  }

  function lock() {
    key = null;
    items = null;
    saltB64 = '';
    stopAutoLock();
    notify();
  }

  /** 有交互就顺延自动锁定 */
  function touch() {
    if (key) lastActive = Date.now();
  }

  function entries() {
    return items ? items.slice() : [];
  }

  function find(id) {
    return (items || []).find((x) => x.id === id) || null;
  }

  async function add(data) {
    if (!key) throw new Error('密码箱未解锁');
    const now = Date.now();
    const entry = {
      id: Store.uid('sec'),
      site: String((data && data.site) || '').trim() || '未命名',
      url: String((data && data.url) || '').trim(),
      username: String((data && data.username) || '').trim(),
      password: String((data && data.password) || ''),
      note: String((data && data.note) || '').trim(),
      createdAt: now,
      updatedAt: now
    };
    items.unshift(entry);
    await persist();
    notify();
    return entry;
  }

  async function update(id, patch) {
    const it = find(id);
    if (!it) return null;
    Object.assign(it, patch, { updatedAt: Date.now() });
    await persist();
    return it;
  }

  async function remove(id) {
    if (!items) return false;
    const before = items.length;
    items = items.filter((x) => x.id !== id);
    if (items.length === before) return false;
    await persist();
    notify();
    return true;
  }

  /** 撤销整个密码箱（密文一起清掉，不可恢复） */
  function destroy() {
    items = null;
    key = null;
    stopAutoLock();
    Store.setVault(null);
    notify();
  }

  /** 改主密码：用已解锁的密钥重新随机 salt 再加密 */
  async function changePassword(next) {
    if (!key) throw new Error('请先解锁');
    const pwd = String(next || '');
    if (pwd.length < 6) throw new Error('主密码至少 6 位');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltB64 = toB64(salt);
    key = await deriveKey(pwd, salt);
    const box = await encryptItems();
    Store.setVault({
      v: VERSION,
      iter: ITER,
      salt: saltB64,
      iv: box.iv,
      ct: box.ct,
      updatedAt: Date.now()
    });
    startAutoLock();
    notify();
    return true;
  }

  function onChange(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  function meta() {
    const blob = Store.getVault();
    return {
      exists: !!blob,
      unlocked: !!key,
      updatedAt: blob ? blob.updatedAt : null,
      count: items ? items.length : null
    };
  }

  global.Vault = {
    has, isUnlocked, isSupported, create, unlock, lock, touch,
    entries, find, add, update, remove, destroy, changePassword,
    onChange, meta,
    AUTO_LOCK_MS
  };
})(window);
