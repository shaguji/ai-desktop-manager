await new Promise(r => setTimeout(r, 1500));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const api = window.electronAPI;
const out = {};

const readWidgets = async () => {
  const st = await api.getWidgets();
  return st.note.items || [];
};
const writeItems = async (items) => {
  const st = await api.getWidgets();
  await api.setWidgets({ note: Object.assign({}, st.note, { items }) });
};

await StickySync.reconcile({});

/* 1) 冲突：便签说「进行中」，笔记说「未开始」→ 应以便签为准 */
const items0 = await readWidgets();
const a = items0.find(i => i.status === 'todo');
const aTrack = a && Store.trackBySticky(a.id);
out.conflictBefore = aTrack && aTrack.status;
if (a) {
  await writeItems(items0.map(i => i.id === a.id ? Object.assign({}, i, { status: 'doing' }) : i));
  await wait(1500);
  out.conflictAfter = Store.trackBySticky(a.id).status;   // 期望 doing
  out.conflictText = a.text;
}

/* 2) 便签删除 → 笔记待办也删（跨会话也生效） */
const tmp = Store.addTrackItem({ title: 'E2E删除测试' });
await StickySync.pushAll(true);
await wait(600);
const items1 = await readWidgets();
out.tmpPushed = items1.some(i => i.text === 'E2E删除测试');
await writeItems(items1.filter(i => i.text !== 'E2E删除测试'));
await wait(1500);
out.tmpDeleted = !Store.trackItem(tmp.id);

/* 3) 一致性收尾 */
await StickySync.reconcile({});
const items2 = await readWidgets();
out.final = {
  sticky: items2.length,
  tracks: Store.trackItems().length,
  mismatch: items2.filter(i => {
    const t = Store.trackBySticky(i.id);
    return !t || t.status !== i.status || t.title !== i.text;
  }).map(i => i.text)
};
return out;
