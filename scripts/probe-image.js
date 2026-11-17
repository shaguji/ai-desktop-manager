await new Promise(r => setTimeout(r, 1400));
const out = {};
try {
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 120;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2f74d0'; ctx.fillRect(0, 0, 240, 120);
  ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.fillText('IMG TEST', 20, 66);
  const dataUrl = cv.toDataURL('image/png');
  out.inShell = !!(window.NoteBridge && NoteBridge.inShell);
  const saved = await NoteBridge.saveImage(dataUrl);
  out.saved = saved && saved.url;
  const notes = Store.activeNotes();
  const note = notes[0];
  out.note = note && note.title;
  if (note) {
    const md = `\n\n![图片](${saved.url})\n`;
    Store.updateNote(note.id, { content: (note.content || '') + md });
    window.__guimo.renderAll();
    window.__guimo.openNote(note.id);
    Store.setUI({ view: 'all' });
    await new Promise(r => setTimeout(r, 300));
    // 切到分栏预览
    const btn = document.querySelector('.seg button[data-mode="split"]') || document.querySelector('.seg button[data-mode="preview"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 600));
    const img = document.querySelector('.md-preview img');
    out.imgFound = !!img;
    if (img) {
      out.src = img.getAttribute('src');
      out.complete = img.complete;
      out.naturalWidth = img.naturalWidth;
    }
  }
} catch (e) { out.err = String(e && e.message || e); }
return out;
