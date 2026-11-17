await new Promise(r => setTimeout(r, 1400));
const out = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  Store.setUI({ view: 'all', search: '' });
  window.__guimo.renderAll();
  const note = Store.filteredNotes()[0];
  window.__guimo.openNote(note.id);
  await sleep(300);

  out.rowExists = !!document.getElementById('noteTagRow');
  out.addBtn = !!document.getElementById('btnNoteTagAdd');
  out.existingTags = (Store.state.tags || []).map((t) => t.name);
  out.noteTagsBefore = (Store.getNote(note.id).tags || []).slice();

  // 打开浮层
  document.getElementById('btnNoteTagAdd').click();
  await sleep(250);
  const pop = document.querySelector('.tag-pop');
  out.popShown = !!pop;
  out.popItems = [...document.querySelectorAll('.tag-pop .tp-item')].map((b) => b.textContent);

  // 输入新标签并回车
  const input = document.getElementById('tpInput');
  input.value = '测试标签A';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(350);
  out.popAfterEnter = !!document.querySelector('.tag-pop');
  out.noteTagsAfter = (Store.getNote(note.id).tags || []).slice();
  out.chips = [...document.querySelectorAll('#noteTagRow .nt-chip')].map((c) => c.textContent);
  out.inStoreTags = (Store.state.tags || []).map((t) => t.name);
  const cloud = [...document.querySelectorAll('#tagCloud .tag-chip')].map((c) => c.textContent);
  out.cloudHas = cloud.some((x) => x.indexOf('测试标签A') >= 0);

  // 已有标签点选添加（如果存在别的标签）
  if (out.popItems.length) {
    document.getElementById('btnNoteTagAdd').click();
    await sleep(200);
    const first = document.querySelector('.tag-pop .tp-item');
    if (first) {
      first.click();
      await sleep(300);
      out.afterPickExisting = (Store.getNote(note.id).tags || []).slice();
    }
  }

  // 移除刚加的标签
  const x = [...document.querySelectorAll('#noteTagRow .nt-x')].find((e) => e.dataset.untag === '测试标签A');
  if (x) { x.click(); await sleep(300); }
  out.noteTagsFinal = (Store.getNote(note.id).tags || []).slice();
  out.noteId = note.id;
} catch (e) { out.err = String(e && e.stack || e); }
return out;
