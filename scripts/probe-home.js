await new Promise((r) => setTimeout(r, 1200));
const out = {};
/* 模拟「上次停在别的视图」 */
Store.setUI({ view: 'notebook', notebookId: (Store.state.notebooks[0] || {}).id, search: '' });
window.__guimo.renderAll();
await new Promise((r) => setTimeout(r, 150));
out.before = { view: Store.state.ui.view, title: document.getElementById('listTitle').textContent };
/* 真实触发桌面「随手记」的 IPC 链路：notes:openHome → notes:home */
await window.electronAPI.notesOpenHome();
await new Promise((r) => setTimeout(r, 700));
out.after = {
  view: Store.state.ui.view,
  title: document.getElementById('listTitle').textContent,
  currentId: window.__guimo.currentId,
  cards: document.querySelectorAll('.note-card').length,
  hasHomeWrap: !!document.querySelector('.home-wrap')
};
out.viewsDirty = Store.state.ui.view === 'home';
return out;
