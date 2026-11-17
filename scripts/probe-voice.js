await new Promise(r => setTimeout(r, 1300));
const out = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  /* 1) IPC 链路：录音 dataURL → 主进程 multipart → 本地 mock 服务 */
  const orig = await window.electronAPI.notesAIGetConfig();
  out.hasASRApi = typeof window.electronAPI.notesASR === 'function';
  const cfg2 = Object.assign({}, orig || {}, {
    asrProvider: 'custom',
    asrBaseUrl: 'http://127.0.0.1:8799/v1',
    asrModel: 'mock-asr',
    asrApiKey: 'test-key'
  });
  await window.electronAPI.notesAISetConfig(cfg2);
  const fake = 'data:audio/webm;base64,' + btoa('0123456789abcdef');
  out.ipc = await window.electronAPI.notesASR(fake, 'audio/webm');
  await window.electronAPI.notesAISetConfig(orig);

  /* 2) UI 链路：假麦克风（振荡器）录音 → 桩转写 → 插入正文 */
  AI.getConfig = async () => ({ asrBaseUrl: 'http://x/v1', asrModel: 'm', asrApiKey: 'k' });
  AI.asrReady = () => true;
  AI.transcribe = async () => '模拟语音：帮我记一下明天的评审会';

  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const dest = ctx.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const fakeStream = dest.stream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => fakeStream }
  });

  Store.setUI({ view: 'all', search: '' });
  window.__guimo.renderAll();
  const note = Store.filteredNotes()[0];
  window.__guimo.openNote(note.id);
  await sleep(200);
  const before = document.getElementById('noteContent').value;

  HomeUI.insertVoice();
  await sleep(1600);
  out.hintWhileRec = document.getElementById('vcHint') && document.getElementById('vcHint').textContent;
  document.getElementById('vcDone').click();
  await sleep(1800);
  const after = document.getElementById('noteContent').value;
  out.inserted = after.slice(before.length).trim();
  out.overlayClosed = !document.getElementById('voiceOverlay');
  out.noteId = note.id;
  try { osc.stop(); ctx.close(); } catch (e) {}
} catch (e) { out.err = String(e && e.stack || e); }
return out;
