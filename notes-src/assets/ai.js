/* ═══════════════════════════════════════════════════
   AI 能力：模型配置 / 图片识别 / 周月总结
   兼容 OpenAI Chat Completions 协议
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const LS_KEY = 'guimo.ai.v1';
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const CN_MONTH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

  const PRESETS = {
    deepseek: {
      label: 'DeepSeek 深度求索',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      visionModel: '',
      hint: 'DeepSeek 只能写总结、看不了图；要连图片识别一起用，选「硅基流动」一把 Key 通吃',
      models: [
        { id: 'deepseek-chat', label: 'deepseek-chat · 通用对话（V3）' },
        { id: 'deepseek-reasoner', label: 'deepseek-reasoner · 深度思考（R1）' }
      ]
    },
    siliconflow: {
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      visionModel: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      hint: '一把 Key 同时管「图片识别 + 语音转写」，国内直连',
      models: [
        { id: 'Qwen/Qwen3-VL-30B-A3B-Instruct', label: 'Qwen3-VL-30B-A3B · 能聊能看图（推荐）' },
        { id: 'Qwen/Qwen3-VL-32B-Instruct', label: 'Qwen3-VL-32B · 识别更准' },
        { id: 'Qwen/Qwen3-VL-8B-Instruct', label: 'Qwen3-VL-8B · 更快更省' },
        { id: 'zai-org/GLM-4.5V', label: 'GLM-4.5V · 通用视觉' },
        { id: 'PaddlePaddle/PaddleOCR-VL-1.5', label: 'PaddleOCR-VL · 纯文字识别' }
      ]
    },
    qwen: {
      label: '通义千问（阿里云）',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      visionModel: 'qwen-vl-max',
      hint: '阿里云百炼平台，兼容 OpenAI 协议',
      models: [
        { id: 'qwen-plus', label: 'qwen-plus · 均衡（推荐）' },
        { id: 'qwen-max', label: 'qwen-max · 效果最好' },
        { id: 'qwen-turbo', label: 'qwen-turbo · 速度最快' },
        { id: 'qwen-long', label: 'qwen-long · 超长文本' },
        { id: 'qwen-vl-max', label: 'qwen-vl-max · 视觉理解' }
      ]
    },
    zhipu: {
      label: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-plus',
      visionModel: 'glm-4v-plus',
      hint: 'bigmodel.cn 申请 API Key',
      models: [
        { id: 'glm-4-plus', label: 'glm-4-plus · 旗舰' },
        { id: 'glm-4-air', label: 'glm-4-air · 轻量' },
        { id: 'glm-4-flash', label: 'glm-4-flash · 免费额度' },
        { id: 'glm-4v-plus', label: 'glm-4v-plus · 视觉理解' }
      ]
    },
    moonshot: {
      label: 'Kimi 月之暗面',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      visionModel: 'moonshot-v1-8k-vision-preview',
      hint: '长文本总结性价比高',
      models: [
        { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k · 8K 上下文' },
        { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k · 32K 上下文' },
        { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k · 128K 长文' },
        { id: 'moonshot-v1-8k-vision-preview', label: 'moonshot-v1-8k-vision · 视觉' }
      ]
    },
    doubao: {
      label: '豆包（火山方舟）',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: '',
      visionModel: '',
      hint: '豆包按「推理接入点」调用：模型处填 ep- 开头的接入点 ID',
      models: []
    },
    hunyuan: {
      label: '腾讯混元',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      model: 'hunyuan-turbos-latest',
      visionModel: 'hunyuan-vision',
      hint: '腾讯云控制台开通后获取 Key，兼容 OpenAI 协议',
      models: [
        { id: 'hunyuan-turbos-latest', label: 'hunyuan-turbos · 快速' },
        { id: 'hunyuan-pro', label: 'hunyuan-pro · 高精度' },
        { id: 'hunyuan-standard', label: 'hunyuan-standard · 通用' },
        { id: 'hunyuan-vision', label: 'hunyuan-vision · 视觉理解' }
      ]
    },
    spark: {
      label: '讯飞星火',
      baseUrl: 'https://spark-api-open.xf-yun.com/v1',
      model: 'generalv3.5',
      visionModel: '',
      hint: '讯飞开放平台领取免费额度，兼容 OpenAI 协议',
      models: [
        { id: 'generalv3.5', label: 'generalv3.5 · Spark Max' },
        { id: '4.0Ultra', label: '4.0Ultra · 旗舰' },
        { id: 'generalv3', label: 'generalv3 · Spark Pro' },
        { id: 'lite', label: 'lite · 免费轻量' }
      ]
    },
    minimax: {
      label: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v1',
      model: 'MiniMax-Text-01',
      visionModel: '',
      hint: 'MiniMax 开放平台，兼容 OpenAI 协议',
      models: [
        { id: 'MiniMax-Text-01', label: 'MiniMax-Text-01 · 长文本' },
        { id: 'abab6.5s-chat', label: 'abab6.5s-chat · 通用' }
      ]
    },
    openai: {
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      hint: '需要能访问 api.openai.com',
      models: [
        { id: 'gpt-4o-mini', label: 'gpt-4o-mini · 轻量' },
        { id: 'gpt-4o', label: 'gpt-4o · 旗舰' }
      ]
    },
    ollama: {
      label: '本地 Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      visionModel: 'llava:7b',
      hint: '本机运行，无需 API Key，需先 ollama serve',
      models: [
        { id: 'qwen2.5:7b', label: 'qwen2.5:7b · 通义本地版' },
        { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b · 本地 DeepSeek' },
        { id: 'llava:7b', label: 'llava:7b · 本地视觉' }
      ]
    },
    custom: {
      label: '自定义（OpenAI 兼容）',
      baseUrl: '',
      model: '',
      visionModel: '',
      hint: '填写任意兼容 /chat/completions 的地址',
      models: []
    }
  };

  /** 语音识别（OpenAI 兼容的 /audio/transcriptions） */
  const ASR_PRESETS = {
    siliconflow: {
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'FunAudioLLM/SenseVoiceSmall',
      hint: '国内直连，注册送额度；模型支持中英混说'
    },
    openai: {
      label: 'OpenAI Whisper',
      baseUrl: 'https://api.openai.com/v1',
      model: 'whisper-1',
      hint: '需要能访问 api.openai.com'
    },
    groq: {
      label: 'Groq Whisper',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3-turbo',
      hint: '免费额度大、转写很快'
    },
    custom: {
      label: '自定义（OpenAI 兼容）',
      baseUrl: '',
      model: '',
      hint: '任意支持 POST /audio/transcriptions 的服务'
    }
  };

  const DEFAULT_CFG = {
    provider: 'deepseek',
    baseUrl: PRESETS.deepseek.baseUrl,
    apiKey: '',
    model: PRESETS.deepseek.model,
    visionModel: PRESETS.deepseek.visionModel,
    temperature: 0.4,
    asrProvider: 'siliconflow',
    asrBaseUrl: ASR_PRESETS.siliconflow.baseUrl,
    asrApiKey: '',
    asrModel: ASR_PRESETS.siliconflow.model,
    enabled: false
  };

  let cfgCache = null;

  async function getConfig() {
    if (cfgCache) return { ...cfgCache };
    let cfg = null;
    if (global.NoteBridge && global.NoteBridge.inShell) {
      cfg = await global.NoteBridge.getAIConfig();
    }
    if (!cfg) {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) cfg = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }
    cfgCache = Object.assign({}, DEFAULT_CFG, cfg || {});
    /* 老版本默认是 OpenAI 且从没填过 Key：跟随新默认切到 DeepSeek
       （壳模式下密钥脱敏为 hasApiKey，不能用空的 apiKey 判断"没填过"） */
    if (cfgCache.provider === 'openai' && !cfgCache.hasApiKey && !cfgCache.apiKey &&
      (!cfgCache.model || cfgCache.model === PRESETS.openai.model)) {
      cfgCache.provider = 'deepseek';
      cfgCache.baseUrl = PRESETS.deepseek.baseUrl;
      cfgCache.model = PRESETS.deepseek.model;
      cfgCache.visionModel = PRESETS.deepseek.visionModel;
    }
    return { ...cfgCache };
  }

  async function setConfig(patch) {
    const next = Object.assign({}, await getConfig(), patch);
    cfgCache = next;
    if (global.NoteBridge && global.NoteBridge.inShell) {
      /* 壳模式：密钥交给主进程加密存储（空值 = 保留旧 Key），
         渲染层不再往 localStorage 双写明文。 */
      const payload = { ...next };
      delete payload.hasApiKey;
      delete payload.hasAsrKey;
      if (!payload.apiKey) delete payload.apiKey;       // 未填新 Key：主进程保留旧值
      if (!payload.asrApiKey) delete payload.asrApiKey;
      const ok = await global.NoteBridge.setAIConfig(payload);
      if (!ok) throw new Error('写入配置失败');
      return next;
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  }

  function isReady(cfg) {
    const c = cfg || cfgCache;
    if (!c) return false;
    const local = /127\.0\.0\.1|localhost/.test(c.baseUrl || '');
    /* 壳模式下密钥加密保存在主进程，渲染层只拿得到 hasApiKey 布尔量 */
    return !!(c.baseUrl && (c.hasApiKey || c.apiKey || local));
  }

  async function chat(messages, opts) {
    const cfg = await getConfig();
    const o = opts || {};
    if (!isReady(cfg)) throw new Error('尚未配置 AI 模型，请在「设置与数据 → AI 模型」中填写');

    if (global.NoteBridge && global.NoteBridge.inShell) {
      const r = await global.NoteBridge.chat(messages, {
        model: o.model || cfg.model,
        temperature: o.temperature ?? cfg.temperature,
        maxTokens: o.maxTokens || 2600,
        timeoutMs: o.timeoutMs
      });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'AI 调用失败');
      return String(r.content || '').trim();
    }

    const url = String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const ctrl = new AbortController();
    const timeoutMs = o.timeoutMs || 120000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {})
        },
        body: JSON.stringify({
          model: o.model || cfg.model,
          temperature: o.temperature ?? cfg.temperature,
          max_tokens: o.maxTokens || 2600,
          messages
        }),
        signal: ctrl.signal
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
      const data = JSON.parse(text);
      return String(data.choices?.[0]?.message?.content || '').trim();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ───────── 图片 ───────── */

  /** 压缩成最长边 1280 的 JPEG，避免把巨型截图塞进模型与笔记 */
  function fileToDataURL(file, maxSide) {
    return new Promise((resolve, reject) => {
      const limit = maxSide || 1280;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, limit / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        };
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = String(reader.result);
      };
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
  }

  async function describeImage(dataUrl, hint) {
    const cfg = await getConfig();
    const model = cfg.visionModel || cfg.model;
    return chat([
      {
        role: 'system',
        content: '你是严谨的图文识别助手。只输出 Markdown，不要寒暄，不要编造图中没有的信息。'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              hint ? '补充要求：' + hint : '',
              '请识别这张图片：',
              '1. 先用一句话说明图片是什么（截图/照片/图表）；',
              '2. 完整提取其中的文字，保持原有层级；表格请还原为 Markdown 表格；',
              '3. 如果是报错信息或数据图表，最后用 3 条以内要点说明含义与建议。'
            ].filter(Boolean).join('\n')
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ], { model, temperature: 0.2, maxTokens: 1800 });
  }

  /* ───────── 语音转写（ASR） ───────── */

  function asrReady(cfg) {
    const c = cfg || cfgCache || {};
    const local = /127\.0\.0\.1|localhost/.test(c.asrBaseUrl || '');
    /* 壳模式下密钥在主进程（只有 hasAsrKey 布尔量）；浏览器模式才有明文 */
    return !!(c.asrBaseUrl && c.asrModel &&
      (c.hasAsrKey || c.hasApiKey || c.asrApiKey || c.apiKey || local));
  }

  /**
   * 把录音 dataURL 转成文字。
   * Electron 里走主进程（无 CORS、能带 multipart），浏览器模式直接请求。
   */
  async function transcribe(dataUrl, mime) {
    if (!dataUrl) throw new Error('没有录音数据');
    if (global.NoteBridge && global.NoteBridge.inShell) {
      const r = await global.NoteBridge.transcribe(dataUrl, mime);
      if (!r || r.ok === false) throw new Error((r && r.error) || '语音识别失败');
      return String(r.text || '').trim();
    }
    const cfg = await getConfig();
    const base = String(cfg.asrBaseUrl || '').replace(/\/+$/, '');
    if (!base || !cfg.asrModel) throw new Error('尚未配置语音识别模型');
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append('file', blob, 'voice.' + ((mime || blob.type || 'audio/webm').split('/')[1] || 'webm').split(';')[0]);
    form.append('model', cfg.asrModel);
    const key = cfg.asrApiKey || cfg.apiKey;
    const res = await fetch(base + '/audio/transcriptions', {
      method: 'POST',
      headers: key ? { Authorization: 'Bearer ' + key } : {},
      body: form
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
    try {
      return String(JSON.parse(text).text || '').trim();
    } catch (e) {
      return text.trim();
    }
  }

  /* ───────── 周 / 月总结 ───────── */

  function rangeOf(kind, now) {
    const d = now ? new Date(now) : new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const monday = new Date(y, m, d.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

    switch (kind) {
      case 'lastWeek': {
        const s = new Date(monday); s.setDate(s.getDate() - 7);
        const e = new Date(monday); e.setDate(e.getDate() - 1);
        e.setHours(23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime(), label: `第 ${isoWeek(s)} 周（${fmt(s)} ~ ${fmt(e)}）`, kind: 'week' };
      }
      case 'thisMonth': {
        const s = new Date(y, m, 1);
        const e = new Date(y, m + 1, 0, 23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime(), label: `${y} 年 ${m + 1} 月`, kind: 'month' };
      }
      case 'lastMonth': {
        const s = new Date(y, m - 1, 1);
        const e = new Date(y, m, 0, 23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime(), label: `${s.getFullYear()} 年 ${s.getMonth() + 1} 月`, kind: 'month' };
      }
      case 'last7': {
        const e = new Date(); e.setHours(23, 59, 59, 999);
        const s = new Date(Date.now() - 6 * DAY);
        return { start: startOfDay(s), end: e.getTime(), label: `${fmt(s)} ~ ${fmt(e)}`, kind: 'week' };
      }
      case 'thisYear':
        return { start: new Date(y, 0, 1).getTime(), end: new Date(y, 11, 31, 23, 59, 59, 999).getTime(), label: `${y} 年`, kind: 'year', year: y };
      case 'lastYear':
        return { start: new Date(y - 1, 0, 1).getTime(), end: new Date(y - 1, 11, 31, 23, 59, 59, 999).getTime(), label: `${y - 1} 年`, kind: 'year', year: y - 1 };
      case 'thisQuarter': {
        const q = Math.floor(m / 3);
        const s = new Date(y, q * 3, 1);
        const e = new Date(y, q * 3 + 3, 0, 23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime(), label: `${y} 年第 ${q + 1} 季度（${fmt(s)} ~ ${fmt(e)}）`, kind: 'quarter' };
      }
      case 'lastQuarter': {
        const q = Math.floor(m / 3);
        const s = new Date(y, q * 3 - 3, 1);
        const e = new Date(y, q * 3, 0, 23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime(), label: `${s.getFullYear()} 年第 ${Math.floor(s.getMonth() / 3) + 1} 季度（${fmt(s)} ~ ${fmt(e)}）`, kind: 'quarter' };
      }
      case 'thisWeek':
      default: {
        const s = new Date(monday);
        const e = new Date(monday); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime(), label: `第 ${isoWeek(s)} 周（${fmt(s)} ~ ${fmt(e)}）`, kind: 'week' };
      }
    }
  }

  function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function isoWeek(d) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    const week1 = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  /** 用具体起止日期构造区间（每日工作页里「选取时间段」用） */
  function rangeFromDates(startStr, endStr, kind) {
    const k = kind || 'week';
    const s = new Date(String(startStr).replace(/-/g, '/') + ' 00:00:00');
    const e = new Date(String(endStr).replace(/-/g, '/') + ' 23:59:59');
    if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new Error('日期格式不正确');
    if (e.getTime() < s.getTime()) throw new Error('结束日期不能早于开始日期');
    let label;
    if (k === 'year') {
      label = s.getFullYear() === e.getFullYear() ? `${s.getFullYear()} 年` : `${fmt(s)} ~ ${fmt(e)}`;
    } else if (k === 'quarter') {
      label = s.getFullYear() === e.getFullYear() && Math.floor(s.getMonth() / 3) === Math.floor(e.getMonth() / 3)
        ? `${s.getFullYear()} 年第 ${Math.floor(s.getMonth() / 3) + 1} 季度（${fmt(s)} ~ ${fmt(e)}）`
        : `${fmt(s)} ~ ${fmt(e)}`;
    } else if (k === 'month') {
      label = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()
        ? `${s.getFullYear()} 年 ${s.getMonth() + 1} 月`
        : `${fmt(s)} ~ ${fmt(e)}`;
    } else {
      label = `${fmt(s)} ~ ${fmt(e)}（第 ${isoWeek(s)} 周）`;
    }
    return {
      start: s.getTime(),
      end: e.getTime(),
      label,
      kind: k,
      year: s.getFullYear(),
      dateStart: fmt(s),
      dateEnd: fmt(e)
    };
  }

  /** 工作总结笔记本组（周/月/季/年），AI 生成结果统一放这里 */
  const SUMMARY_NB = {
    week: { id: 'nb-sum-weekly', name: '每周总结', color: '#2f74d0' },
    month: { id: 'nb-sum-monthly', name: '每月总结', color: '#7c5cd6' },
    quarter: { id: 'nb-sum-quarterly', name: '季度总结', color: '#0f9d9d' },
    year: { id: 'nb-sum-yearly', name: '年度总结', color: '#b8791f' }
  };

  function summaryNotebook(kind) {
    const def = SUMMARY_NB[kind] || SUMMARY_NB.month;
    let nb = Store.notebookOf(def.id) || (Store.state.notebooks || []).find((b) => b.name === def.name);
    if (!nb) {
      nb = Store.addNotebook(def.name, def.color, { id: def.id, parentId: 'nb-summary' });
    }
    return nb;
  }

  /** 工作总结组内的笔记本 id（生成素材时排除，避免自己总结自己） */
  function summaryScopeIds() {
    const ids = ['nb-summary'];
    const kids = Store.notebookKids ? Store.notebookKids('nb-summary') : [];
    kids.forEach((b) => ids.push(b.id));
    return ids;
  }

  /** 把总结模板正文转成 AI 输出骨架：保留章节与表格，首行 H1 换成实际标题 */
  function templateSkeleton(tpl, title) {
    const body = String((tpl && tpl.content) || '')
      .replace(/<!--.*?-->/g, '')
      .replace(/^\s*#\s+.*(?:\n+|$)/, '')
      .trim();
    return `# ${title}\n\n${body}`;
  }

  /** 有模板时返回骨架，没有返回 null */
  function pickTemplate(o) {
    const t = o && o.template;
    return t && String(t.content || '').trim() ? t : null;
  }

  function collectNotes(range, notebookIds, opts) {
    const o = opts || {};
    const skip = o.includeSummary ? [] : summaryScopeIds();
    const notes = (Store.state.notes || []).filter((n) => !n.deletedAt);
    const picked = notes.filter((n) => {
      if (skip.includes(n.notebookId)) return false;
      if (notebookIds && notebookIds.length && !notebookIds.includes(n.notebookId)) return false;
      // 记录日期优先用创建时间，其次更新时间，只要落在区间内就算
      const inCreated = n.createdAt >= range.start && n.createdAt <= range.end;
      const inUpdated = n.updatedAt >= range.start && n.updatedAt <= range.end;
      return inCreated || inUpdated;
    });
    return picked.sort((a, b) => a.createdAt - b.createdAt);
  }

  function buildCorpus(notes, limit) {
    const max = limit || 46000;
    let total = 0;
    const parts = [];
    for (const n of notes) {
      const nb = Store.notebookOf(n.notebookId);
      const head = `\n\n---\n### 笔记：${n.title || '无标题'}（${nb ? nb.name : '未分类'}｜${fmt(new Date(n.createdAt))}）\n`;
      let body = String(n.content || '').replace(/<!--.*?-->/g, '').trim();
      if (body.length > 3200) body = body.slice(0, 3200) + '\n…（后文省略）';
      if (total + body.length > max) {
        parts.push(head + '（内容较多，后续笔记已省略）');
        break;
      }
      total += body.length;
      parts.push(head + body);
    }
    return parts.join('');
  }

  /**
   * 找出某一年度的月报，用于生成年报。
   * 取「工作总结 · 每月总结」里的笔记；该笔记本缺失时退回按标题识别。
   * 返回 [{ month, note }] 升序，month 取标题中的月份，识别不到时用创建时间。
   */
  function monthlyNotes(year) {
    const all = (Store.state.notes || []).filter((n) => !n.deletedAt);
    /* 素材来源：工作总结下的「每月总结」 */
    const nbs = (Store.state.notebooks || []).filter((b) => b.id === 'nb-sum-monthly' || b.name === '每月总结');
    const ids = nbs.map((b) => b.id);
    const pool = ids.length
      ? all.filter((n) => ids.includes(n.notebookId))
      : all.filter((n) => /月(度)?(工作)?(总结|小结)|月报/.test(n.title || ''));

    return pool
      .filter((n) => {
        const titleYear = (String(n.title || '').match(/(20\d{2})\s*年/) || [])[1];
        if (titleYear) return Number(titleYear) === year;
        return new Date(n.createdAt).getFullYear() === year;
      })
      .map((n) => {
        const t = String(n.title || '');
        const cn = t.match(/(十[一二]|[一二三四五六七八九十])\s*月/);
        const ar = t.match(/(\d{1,2})\s*月/);
        let month = 0;
        if (ar) month = Number(ar[1]);
        else if (cn) month = CN_MONTH[cn[1]] || 0;
        if (!month) month = new Date(n.createdAt).getMonth() + 1;
        return { month: Math.min(12, Math.max(1, month)), note: n };
      })
      .sort((a, b) => a.month - b.month);
  }

  /** 年度总结：以 12 份月报为唯一素材，缺少的月份显式标注 */
  function buildYearPrompt(range, o) {
    const year = range.year;
    const months = monthlyNotes(year);
    if (!months.length) {
      throw new Error(`${year} 年在「工作总结 · 每月总结」里还没有月报，先生成月报再来汇总年度总结`);
    }

    const used = new Set();
    const blocks = [];
    for (let m = 1; m <= 12; m++) {
      const hit = months.filter((x) => x.month === m).pop(); // 同月多份取最新
      if (!hit) {
        blocks.push(`\n\n### 【${m} 月】\n（本月暂无月报，请勿编造，年度总结中标注「缺失」）`);
        continue;
      }
      used.add(hit.note.id);
      let body = String(hit.note.content || '').replace(/<!--.*?-->/g, '').trim();
      if (body.length > 2600) body = body.slice(0, 2600) + '\n…（后文省略）';
      blocks.push(`\n\n### 【${m} 月】${hit.note.title || ''}\n${body}`);
    }

    const missing = [];
    for (let m = 1; m <= 12; m++) if (!months.some((x) => x.month === m)) missing.push(m + ' 月');

    // 月报里的待办完成情况，作为「执行情况」的辅助信号
    const tasks = [];
    months.forEach((x) => {
      MD.extractTasks(x.note.content).forEach((t) => {
        tasks.push(`- [${t.state === 'done' ? 'x' : ' '}] ${t.text}（${x.month} 月）`);
      });
    });

    const sys = `你是金融行业 IT 部门的总监助理，擅长把月度工作总结提炼成有数据、有结论的年度总结。
要求：
- 只输出 Markdown 正文，不要开场白与结束语；
- 所有事实来自给定的 12 份月报，不得编造数据；月报未提到的指标写「待补充」；
- 缺失月份要在对应位置明确写「本月月报缺失，数据未纳入」；
- 结论先行、量化优先（数量、比率、同比），避免「高度重视」「有效提升」这类空话；
- 把重复出现的同类工作合并归纳，不要逐月罗列流水账；
- 重点项目挑 3~5 个，讲清背景、我的角色、关键动作、结果数据。`;

    const tplY = pickTemplate(o);
    const titleY = tplY ? `${year} 年 ${tplY.name}（AI）` : `${year} 年度工作总结（AI）`;

    const user = `年度：${year} 年（1 月 1 日 ~ 12 月 31 日）
可用月报：${Math.min(months.length, 12)} 份${missing.length ? `；缺失：${missing.join('、')}` : '，全年齐全'}

【各月工作总结】
${blocks.join('')}

【月报中的待办与执行情况】
${tasks.slice(0, 220).join('\n') || '（无）'}

${o.extra ? '【额外要求】\n' + o.extra + '\n' : ''}
${tplY ? `请严格按下面的「${tplY.name}」模板骨架输出：保留章节标题、章节顺序、表格的列与行结构；删掉示例占位文字与空行，用事实把表格填满；缺失月份的表格行要标注「月报缺失」；实在没有数据的单元格写「待补充」。\n` : '请按以下结构输出：\n'}${tplY ? templateSkeleton(tplY, titleY.replace(/（AI）$/, '')) : `# ${year} 年度工作总结

## 一、年度概览
- 3~5 条，覆盖交付、稳定性、合规三条主线，带关键数字

## 二、年度关键指标
| 指标 | 年度目标 | 全年实际 | 同比 | 说明 |
（从月报中提取：需求交付数量与及时率、变更次数与成功率、生产事件数与等级分布、MTTR、系统可用率、漏洞整改率、监管报送准时率；没有的填「待补充」）

## 三、全年重点工作
### 项目一
- **业务背景** / **我的角色** / **关键动作** / **结果与数据**
（3~5 个重点项目）

## 四、按季度回顾
| 季度 | 重点事项 | 结果 / 数据 |

## 五、生产运行与稳定性
- 事件趋势、重大故障与改进、监控与预案建设

## 六、安全合规与监管
- 等保、漏洞治理、监管报送、审计配合

## 七、效率提升与成本优化
- 自动化工具、资源与预算、外包管理

## 八、不足与改进
- 每条：不足 → 根因 → 改进动作

## 九、${year + 1} 年规划
- 4~6 条，可执行、可验收

## 附：月度要点索引
| 月份 | 关键事项 | 关键指标 |
（12 行，缺失月份标注「月报缺失」）`}`;

    return {
      sys,
      user,
      title: titleY,
      kind: 'year',
      range,
      count: used.size,
      months: used.size,
      missing,
      template: tplY ? tplY.name : null,
      tag: '年度',
      temperature: 0.3,
      maxTokens: 3600
    };
  }

  /** 把生成好的正文落成一篇总结笔记（直连生成与办公网生成共用） */
  function saveSummary(p, content) {
    const nb = summaryNotebook(p.kind);
    const tags = ['AI总结'].concat(p.tag ? [p.tag] : [], p.template ? [p.template] : []);
    const note = Store.createNote({
      notebookId: nb.id,
      title: p.title,
      content,
      tags
    });
    return {
      note,
      range: p.range,
      count: p.count,
      kind: p.kind,
      template: p.template || null,
      missing: p.missing || null
    };
  }

  async function summarizeYear(range, o) {
    const p = buildYearPrompt(range, o);
    const content = await chat([
      { role: 'system', content: p.sys },
      { role: 'user', content: p.user }
    ], { temperature: p.temperature, maxTokens: p.maxTokens, timeoutMs: 240000 });
    return saveSummary(p, content);
  }

  const KIND_META = {
    week: { name: '周报', plan: '下周计划', tag: '周报' },
    month: { name: '月报', plan: '下月规划', tag: '月报' },
    quarter: { name: '季度总结', plan: '下季度规划', tag: '季度总结' },
    year: { name: '年度总结', plan: '明年规划', tag: '年度总结' }
  };

  /**
   * 周 / 月 / 季 / 年通用总结的提示词（不联网）。
   * 直连模型与「办公网生成」共用同一份素材与结构，保证两条路的结果口径一致。
   */
  function buildSummaryPrompt(opts) {
    const o = opts || {};
    const range = o.range || rangeOf(o.kind || 'thisWeek');
    const kind = range.kind || 'week';

    /* 年度且有月报：沿用「以 12 份月报为素材」的老口径 */
    if (kind === 'year') {
      const months = monthlyNotes(range.year);
      if (months.length) return buildYearPrompt(range, o);
    }

    const notes = collectNotes(range, o.notebookIds);
    if (!notes.length) throw new Error('所选时间段内没有笔记，换一个时间段再试');

    const meta = KIND_META[kind] || KIND_META.week;
    const tasks = [];
    notes.forEach((n) => {
      MD.extractTasks(n.content).forEach((t) => {
        tasks.push(`- [${t.state === 'done' ? 'x' : ' '}] ${t.text}（来自《${n.title}》）`);
      });
    });

    const corpus = buildCorpus(notes);
    const sys = `你是金融行业 IT 部门的资深助理，擅长把零散工作记录整理成可直接汇报的中文${meta.name}。
要求：
- 只输出 Markdown 正文，不要开场白与结束语；
- 事实必须来自给定记录，不得编造数据，信息不足写「待补充」；
- 结论先行、量化优先，避免「高度重视」「显著提升」这类空话；
- 同类工作合并归纳，不要逐条罗列流水账；
- 待办要标注完成情况。`;

    const tpl = pickTemplate(o);
    const title = tpl ? `${range.label}${tpl.name}（AI）` : `${range.label}${meta.name}（AI）`;

    const isYear = kind === 'year';
    const struct = tpl
      ? templateSkeleton(tpl, title.replace(/（AI）$/, ''))
      : isYear
      ? `# ${range.label}${meta.name}

## 一、年度概览
- 3~5 条，覆盖交付、稳定性、合规三条主线，带关键数字

## 二、关键指标
| 指标 | 目标 | 实际 | 说明 |

## 三、全年重点工作
- 3~5 个项目：背景 / 我的角色 / 关键动作 / 结果数据

## 四、问题与不足
- 每条：现象 → 根因 → 改进动作

## 五、${meta.plan}
- 4~6 条，可执行、可验收`
      : `# ${range.label}${meta.name}

## 一、整体概览
- 3~5 条要点，讲清这段时间最重要的事与结果

## 二、工作明细
| 事项 | 进展 | 结果 / 数据 | 状态 |
（合并同类项，6~10 行；状态用 已完成 / 进行中 / 待跟进）

## 三、问题与风险
- 每条：现象 → 影响 → 处理建议

## 四、${meta.plan}
- 3~6 条，可执行、可验收

## 五、需要支持
- 没有就写「暂无」`;

    const user = `时间范围：${range.label}（${fmt(new Date(range.start))} ~ ${fmt(new Date(range.end))}）
共 ${notes.length} 篇工作记录。

【工作记录原文】
${corpus}

【待办汇总】
${tasks.join('\n') || '（无）'}

${o.extra ? '【额外要求】\n' + o.extra + '\n' : ''}
${tpl ? `请严格按下面的「${tpl.name}」模板骨架输出：保留章节标题、章节顺序、表格的列与行结构；删掉示例占位文字与空行，用事实把表格填满；实在没有数据的单元格写「待补充」，不要留空白。\n` : '请按以下结构输出：\n'}${struct}`;

    return {
      sys,
      user,
      title,
      kind,
      range,
      count: notes.length,
      template: tpl ? tpl.name : null,
      tag: meta.tag,
      temperature: 0.35,
      maxTokens: isYear ? 3600 : 2600
    };
  }

  /** 直连模型生成总结（外部模型可用时走这条） */
  async function summarize(opts) {
    const p = buildSummaryPrompt(opts);
    const content = await chat([
      { role: 'system', content: p.sys },
      { role: 'user', content: p.user }
    ], {
      temperature: p.temperature,
      maxTokens: p.maxTokens,
      /* 季报/年报素材长，给更长的等待时间 */
      timeoutMs: p.maxTokens > 2600 ? 240000 : 180000
    });
    return saveSummary(p, content);
  }

  /**
   * 办公网生成第一步：只组装提示词，不联网。
   * 内网 AI 工作台没有 API，只能把这段文字交给用户在网页里粘贴。
   */
  function prepareSummary(opts) {
    const p = buildSummaryPrompt(opts);
    const prompt = [
      '请完成下面这份中文工作总结。要求：只输出最终 Markdown 正文，不要解释你的思路，不要用代码块包裹。',
      '',
      '【角色与写作要求】',
      p.sys,
      '',
      '【统计口径、素材与输出结构】',
      p.user
    ].join('\n');
    return {
      prompt,
      title: p.title,
      kind: p.kind,
      range: p.range,
      count: p.count,
      template: p.template,
      missing: p.missing || null,
      chars: prompt.length
    };
  }

  /**
   * 办公网生成第三步：把用户从工作台复制回来的正文整理成笔记。
   * 容错：整段 ```markdown 围栏、开头的「好的，以下是…」寒暄都清掉。
   */
  function cleanSummaryText(raw) {
    let t = String(raw || '').replace(/\r\n/g, '\n').trim();
    if (!t) return '';
    const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/.exec(t);
    if (fence) t = fence[1].trim();
    /* 只在开头有寒暄且后面确实跟着标题时才裁，避免误删正文 */
    const firstHead = t.search(/^#{1,3}\s/m);
    if (firstHead > 0 && firstHead < 400) {
      const head = t.slice(0, firstHead);
      if (/以下是|下面是|好的|已(经)?为您|根据您|为您整理/.test(head)) t = t.slice(firstHead).trim();
    }
    return t;
  }

  function applySummaryResult(opts, raw) {
    const text = cleanSummaryText(raw);
    if (!text) throw new Error('粘回来的内容是空的，请重新复制工作台的生成结果');
    const p = buildSummaryPrompt(opts);
    return saveSummary(p, text);
  }

  async function testConnection() {
    const cfg = await getConfig();
    const model = cfg.model;
    const out = await chat([
      { role: 'system', content: '你是连通性测试助手。' },
      { role: 'user', content: '只回复两个字：可用' }
    ], { model, maxTokens: 16, temperature: 0 });
    return out || '（空响应）';
  }

  global.AI = {
    PRESETS,
    ASR_PRESETS,
    DEFAULT_CFG,
    getConfig,
    setConfig,
    isReady,
    chat,
    fileToDataURL,
    describeImage,
    asrReady,
    transcribe,
    rangeOf,
    summarize,
    summarizeYear,
    buildSummaryPrompt,
    prepareSummary,
    applySummaryResult,
    cleanSummaryText,
    monthlyNotes,
    rangeFromDates,
    summaryNotebook,
    KIND_META,
    testConnection,
    collectNotes
  };
})(window);
