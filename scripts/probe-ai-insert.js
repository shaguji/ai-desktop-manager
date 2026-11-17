await new Promise(r => setTimeout(r, 1400));
const out = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  Store.setUI({ view: 'all', search: '' });
  window.__guimo.renderAll();
  const note = Store.filteredNotes()[0];
  window.__guimo.openNote(note.id);
  await sleep(250);
  const ta = document.getElementById('noteContent');

  // 打桩：不真的发网络请求，只验证「识别结果插到图片后面」
  AI.getConfig = async () => ({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test', model: 'deepseek-chat', visionModel: 'deepseek-chat', temperature: 0.2 });
  let calls = 0;
  AI.describeImage = async () => { calls++; return '这是一张蓝色截图\n| 列 | 值 |\n| --- | --- |\n| A | 1 |'; };

  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 150;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1c1c1e'; ctx.fillRect(0, 0, 300, 150);
  ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif'; ctx.fillText('OCR 测试', 20, 85);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'ocr.png', { type: 'image/png' }));
  ta.focus();
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(900);
  out.askBefore = !!document.querySelector('.img-ask');
  out.callsBeforeClick = calls;

  const yes = document.querySelector('.img-ask [data-act="ai"]');
  if (yes) yes.click();
  await sleep(1200);

  out.calls = calls;
  out.askAfter = !!document.querySelector('.img-ask');
  out.hasAIMark = ta.value.indexOf('> **AI 识别**') >= 0;
  const imgLine = ta.value.split('\n').findIndex((l) => l.indexOf('![图片](file://') >= 0);
  const aiLine = ta.value.split('\n').findIndex((l) => l.indexOf('**AI 识别**') >= 0);
  out.imgLine = imgLine;
  out.aiLine = aiLine;
  out.ordered = imgLine >= 0 && aiLine === imgLine + 1;
  out.tail = ta.value.slice(ta.value.indexOf('![图片](file://') < 0 ? -200 : ta.value.indexOf('![图片](file://')).slice(0, 320);
} catch (e) { out.err = String(e && e.stack || e); }
return out;
