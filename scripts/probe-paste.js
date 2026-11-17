await new Promise(r => setTimeout(r, 1400));
const out = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  Store.setUI({ view: 'all', search: '' });
  window.__guimo.renderAll();
  const list = Store.filteredNotes();
  const note = list[0];
  window.__guimo.openNote(note.id);
  await sleep(300);
  const ta = document.getElementById('noteContent');
  const before = ta.value.length;

  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 160;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a84ff'; ctx.fillRect(0, 0, 320, 160);
  ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('PASTE TEST 截图', 24, 90);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = new File([blob], 'paste-1.png', { type: 'image/png' });

  const dt = new DataTransfer();
  dt.items.add(file);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ta.focus();
  ta.dispatchEvent(ev);
  await sleep(1200);

  out.hasImgMd = /!\[图片\]\(file:\/\//.test(ta.value);
  out.grew = ta.value.length - before;
  out.autoAI = ta.value.indexOf('AI 识别') >= 0;
  const ask = document.querySelector('.img-ask');
  out.askShown = !!ask;
  out.askText = ask ? ask.innerText.replace(/\n+/g, ' | ') : null;
  out.askButtons = [...document.querySelectorAll('.img-ask .ia-btn')].map((b) => b.textContent);

  // 点「不用」应收起提示条且不改正文
  const skip = ask && ask.querySelector('[data-act="skip"]');
  const lenBefore = ta.value.length;
  if (skip) skip.click();
  await sleep(300);
  out.askAfterSkip = !!document.querySelector('.img-ask');
  out.contentUnchanged = ta.value.length === lenBefore;
  out.noteId = note.id;
} catch (e) { out.err = String(e && e.stack || e); }
return out;
