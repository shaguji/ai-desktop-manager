await new Promise(r => setTimeout(r, 1500));
const out = {};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* 在「标签」视图下新建笔记，应自动带上该标签名（而不是 tag-xxx） */
const tag = Store.state.tags.find(t => t.name === '埋点');
Store.setUI({ view: 'tag', tagId: tag.id, notebookId: null, search: '' });
__guimo.refreshSidebar();
__guimo.refreshList();
const before = Store.state.notes.length;
__guimo.newNote();
await wait(400);
const created = Store.state.notes[0];
out.created = created.title;
out.tags = created.tags;
out.ok = Array.isArray(created.tags) && created.tags.includes('埋点');
out.sidebarCount = (document.querySelector('.tag-chip[data-tag="' + tag.id + '"]') || {}).textContent;

/* 清理测试笔记 */
Store.trashNote(created.id);
Store.purgeNote(created.id);
out.cleaned = Store.state.notes.length === before;
return out;
