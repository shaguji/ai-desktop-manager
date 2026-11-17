await new Promise(r => setTimeout(r, 1500));
const out = {};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* 1) 完整对齐：便签应该等于所有未完成待办 */
await StickySync.reconcile({});
const live = Store.trackItems().filter(t => t.status !== 'done');
out.step1 = {
  liveCount: live.length,
  stickyCount: (StickySync.getItems() || []).length,
  allHaveStickyId: live.every(t => !!t.stickyId),
  titles: (StickySync.getItems() || []).map(i => i.text)
};

/* 2) 模拟桌面便签上把某条改成「进行中」→ 笔记应跟着变，并写入当日日志 */
const target = (StickySync.getItems() || []).find(i => i.status === 'todo');
out.target = target && target.text;
if (target) {
  await NoteBridge.setStickyStatus(target.id, 'doing');
  await wait(1200);
  const it = Store.trackBySticky(target.id);
  out.step2 = { status: it && it.status, statusLog: it && it.statusLog };
}

/* 3) 在笔记里写一条进展 → 当天的「每日工作」日志应出现这句话 */
const it3 = Store.trackItems().filter(t => t.status !== 'done')[0];
if (it3) {
  Store.addTrackProgress(it3.id, '自动同步校验：进展写入当日日志');
  Track.syncItem(Store.trackItem(it3.id));
  const key = Track.dayKey(Date.now());
  const note = Store.getNote('note-track-' + key);
  out.step3 = {
    item: it3.title,
    status: Store.trackItem(it3.id).status,
    hasProgress: !!(note && note.content.includes('自动同步校验：进展写入当日日志')),
    hasStatusRow: !!(note && /状态：未开始 → 进行中/.test(note.content)),
    rows: note ? note.content.split('\n').filter(l => l.startsWith('| ')).map(l => l.slice(0, 60)) : []
  };
}

/* 4) 再对齐一次，确认幂等（不产生重复条目） */
await StickySync.reconcile({});
out.step4 = {
  stickyCount: (StickySync.getItems() || []).length,
  gone: Store.state.stickyGone
};
return out;
