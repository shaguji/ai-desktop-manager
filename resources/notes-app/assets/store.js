/* ═══════════════════════════════════════════════════
   数据层：状态 / 持久化 / 查询
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const KEY = 'guimo.notes.v1';
  const uid = (p) => `${p || 'n'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const pad = (n) => String(n).padStart(2, '0');
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dayMs = 86400000;

  const NOTEBOOKS = [
    { id: 'nb-daily', name: '每日工作', color: '#00a82d' },
    { id: 'nb-meeting', name: '会议纪要', color: '#d99a00' },
    { id: 'nb-ops', name: '运维与变更', color: '#c0392b' },
    { id: 'nb-project', name: '项目与复盘', color: '#0f9d9d' },
    /* 工作总结：默认收拢，点加号展开四类总结 */
    { id: 'nb-summary', name: '工作总结', color: '#2f74d0', group: true },
    { id: 'nb-sum-weekly', name: '每周总结', color: '#2f74d0', parentId: 'nb-summary' },
    { id: 'nb-sum-monthly', name: '每月总结', color: '#7c5cd6', parentId: 'nb-summary' },
    { id: 'nb-sum-quarterly', name: '季度总结', color: '#0f9d9d', parentId: 'nb-summary' },
    { id: 'nb-sum-yearly', name: '年度总结', color: '#b8791f', parentId: 'nb-summary' }
  ];

  const TAGS = ['需求', '变更', '投产', '生产事件', '监管报送', '等保', '复盘', 'AI总结'];

  /**
   * 每类笔记本的默认模板：新建笔记时如果用户没有主动选模板，
   * 就按这里的映射生成内容（笔记本上可用 defaultTemplateId 覆盖，'' 表示空白）。
   */
  const DEFAULT_TEMPLATES = {
    'nb-daily': 'tpl-daily',
    'nb-meeting': 'tpl-meeting',
    'nb-ops': 'tpl-change',
    'nb-project': 'tpl-retro',
    'nb-sum-weekly': 'tpl-weekly',
    'nb-sum-monthly': 'tpl-monthly',
    'nb-sum-quarterly': 'tpl-quarterly',
    'nb-sum-yearly': 'tpl-yearly',
    /* 没有固定 id 的笔记本（历史数据按名字创建），用名称兜底 */
    业务经营: 'tpl-client-visit'
  };

  /**
   * 随手记的「笔记类型」——首页只保留「随手记 / 随手查」两个入口，
   * 具体记什么由这里的类型决定。每种类型绑定一个默认模板与落库笔记本，
   * 都写在 state.kinds 里，用户可以在设置中新增 / 修改 / 隐藏。
   */
  const KINDS = [
    {
      id: 'kind-todo', name: '待办', icon: '✅', color: '#00a82d', mode: 'track',
      desc: '记下要做的事，跟踪到办结', notebookId: '', templateId: ''
    },
    {
      id: 'kind-project', name: '项目工作', icon: '🧩', color: '#2f74d0',
      desc: '按 IT 项目阶段推进与留痕', notebookId: 'nb-project', templateId: 'tpl-project',
      subs: [
        { id: 'sub-req', name: '需求分析', templateId: 'tpl-it-req', notebookId: 'nb-project' },
        { id: 'sub-design', name: '方案设计', templateId: 'tpl-it-design', notebookId: 'nb-project' },
        { id: 'sub-dev', name: '开发实施', templateId: 'tpl-it-dev', notebookId: 'nb-project' },
        { id: 'sub-test', name: '测试验收', templateId: 'tpl-it-test', notebookId: 'nb-project' },
        { id: 'sub-release', name: '上线投产', templateId: 'tpl-it-release', notebookId: 'nb-ops' },
        { id: 'sub-ops', name: '运维保障', templateId: 'tpl-it-ops', notebookId: 'nb-ops' },
        { id: 'sub-incident', name: '故障复盘', templateId: 'tpl-incident', notebookId: 'nb-ops' },
        { id: 'sub-security', name: '安全合规', templateId: 'tpl-compliance', notebookId: 'nb-ops' },
        { id: 'sub-data', name: '数据治理', templateId: 'tpl-it-data', notebookId: 'nb-project' },
        { id: 'sub-retro', name: '项目复盘', templateId: 'tpl-retro', notebookId: 'nb-project' }
      ]
    },
    {
      id: 'kind-meeting', name: '会议纪要', icon: '🗣️', color: '#d99a00',
      desc: '结论、待办与责任人一次记清', notebookId: 'nb-meeting', templateId: 'tpl-meeting',
      subs: [
        { id: 'sub-meeting', name: '通用会议', templateId: 'tpl-meeting', notebookId: 'nb-meeting' },
        { id: 'sub-review', name: '需求评审', templateId: 'tpl-reqreview', notebookId: 'nb-meeting' },
        { id: 'sub-1on1', name: '一对一面谈', templateId: 'tpl-1on1', notebookId: 'nb-meeting' }
      ]
    },
    {
      id: 'kind-mood', name: '每日感想', icon: '🌤️', color: '#7c5cd6',
      desc: '一点情绪、一点想法，随手写下', notebookId: 'nb-daily', templateId: 'tpl-mood'
    },
    {
      id: 'kind-daily', name: '每日工作', icon: '📅', color: '#0f9d9d',
      desc: '一天一篇，自动汇总事项进展', notebookId: 'nb-daily', templateId: 'tpl-daily'
    },
    {
      id: 'kind-summary', name: '工作总结', icon: '🗓️', color: '#b8791f',
      desc: '周 / 月 / 季 / 年，按周期沉淀', notebookId: 'nb-sum-weekly', templateId: 'tpl-weekly',
      subs: [
        { id: 'sub-week', name: '周总结', templateId: 'tpl-weekly', notebookId: 'nb-sum-weekly' },
        { id: 'sub-month', name: '月总结', templateId: 'tpl-monthly', notebookId: 'nb-sum-monthly' },
        { id: 'sub-quarter', name: '季度总结', templateId: 'tpl-quarterly', notebookId: 'nb-sum-quarterly' },
        { id: 'sub-year', name: '年度总结', templateId: 'tpl-yearly', notebookId: 'nb-sum-yearly' }
      ]
    },
    {
      id: 'kind-note', name: '自由笔记', icon: '📝', color: '#8d968f',
      desc: '不做预设，想写什么写什么', notebookId: 'nb-daily', templateId: 'tpl-blank'
    }
  ];

  // 数据结构版本：升级时补齐新增的内置笔记本，不动用户已有的
  // v3：新增事项跟踪 trackItems
  // v4：新增「工作总结」笔记本组（周/月/季/年总结），并迁移已有的 AI 总结笔记
  // v5：删除「每周工作 / 每月工作 / 年度工作」三个旧笔记本，内容并入工作总结分类
  // v6：新增加密密码箱 vault；笔记本可指定默认模板；事项跟踪记录关联桌面便签 id
  // v7：新增随手记类型 kinds（可自定义），笔记记住所属类型
  // v8：去掉「收集箱」笔记本（待办事项改为侧栏独立入口），箱内笔记并入「每日工作」
  const SCHEMA = 8;

  /** 深拷贝一份内置类型，避免默认值被用户编辑污染 */
  function defaultKinds() {
    return KINDS.map((k) => Object.assign({}, k, {
      builtin: true,
      hidden: false,
      subs: (k.subs || []).map((x) => Object.assign({}, x))
    }));
  }

  /** 补齐字段，老数据 / 自定义类型都能安全使用 */
  function normalizeKind(k, def) {
    const d = def || {};
    k.id = k.id || uid('kind');
    k.name = String(k.name || d.name || '未命名类型');
    k.icon = k.icon || d.icon || '📝';
    k.color = k.color || d.color || '#00a82d';
    k.desc = String(k.desc == null ? (d.desc || '') : k.desc);
    /* mode: track = 待办事项（带生命周期跟踪，不走模板建笔记） */
    k.mode = k.mode || d.mode || '';
    k.notebookId = k.notebookId || d.notebookId || 'nb-daily';
    k.templateId = k.templateId == null ? (d.templateId || 'tpl-blank') : k.templateId;
    /* 内置「待办」统一升级为事项跟踪类型，老数据也一并纠正 */
    if (k.id === 'kind-todo') {
      k.mode = 'track';
      k.templateId = '';
      if (k.desc === '今天要做的事，逐条勾掉') k.desc = d.desc || k.desc;
    }
    k.builtin = k.builtin == null ? !!d.builtin : !!k.builtin;
    k.hidden = !!k.hidden;
    k.subs = Array.isArray(k.subs) ? k.subs.map((x) => ({
      id: x.id || uid('sub'),
      name: String(x.name || ''),
      templateId: x.templateId || '',
      notebookId: x.notebookId || k.notebookId
    })) : (d.subs ? d.subs.map((x) => Object.assign({}, x)) : []);
    return k;
  }

  /* ───────── 示例数据 ───────── */
  function seedNotes(now) {
    const t = new Date(now);
    const at = (dayOffset, h, m) => {
      const d = new Date(t);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

    const dailyAt = at(0, 9, 12);
    const weekAt = at(-1, 18, 40);
    const meetingAt = at(-1, 15, 5);
    const planAt = at(-3, 10, 20);
    const trackAt = at(-5, 14, 30);
    const inboxAt = at(-6, 11, 5);

    return [
      {
        id: 'seed-daily',
        notebookId: 'nb-daily',
        title: `${ymd(dailyAt)} 工作日志`,
        tags: ['埋点'],
        templateId: 'tpl-daily',
        createdAt: dailyAt,
        updatedAt: at(0, 11, 26),
        content: `# ${ymd(dailyAt)} 工作日志

> 星期二 · 第 45 周 · 09:12

## 今日重点
- [x] 梳理埋点方案里的「事件命名规范」与「页面曝光口径」
- [ ] 和运营确认新手引导的 4 个关键节点
- [ ] 输出桌面管家 0.9 的验收清单

## 进展与产出
**事项一：埋点方案**
- 做了什么：把「页面曝光」拆成 enter / stay / leave 三个事件，避免用单一 click 判断
- 当前进展：字段规范已定稿，等待评审
- 结论 / 产出：\`docs/tracking-spec.md\` 初版完成

**事项二：智能体引导**
- 用埋点回流数据判断用户卡在哪一步，再让智能体给出下一步操作
- 目前只覆盖了「新建订单」这一条链路

## 问题与风险

| 问题 | 影响面 | 处理方式 | 状态 |
| --- | --- | --- | --- |
| 老系统按钮没有唯一 ID，无法稳定定位 | 引导命中率 | 用「菜单路径 + 按钮文案」做复合键 | 进行中 |
| 运营不熟悉事件字段 | 数据可用性 | 出一页速查表 | 待跟进 |

## 明日计划
- [ ] 埋点方案评审，收集研发侧意见
- [ ] 补全引导流程的兜底文案

## 随手记
- 几百个菜单、几千个按钮的系统，靠人工培训成本太高，埋点 + 引导是唯一可扩展的路`
      },
      {
        id: 'seed-weekly',
        notebookId: 'nb-sum-weekly',
        title: '第 45 周工作周报',
        tags: ['周报', '复盘'],
        templateId: 'tpl-weekly',
        createdAt: weekAt,
        updatedAt: weekAt,
        content: `# 第 45 周工作周报

> 统计周期：${ymd(at(-7, 0, 0))} ~ ${ymd(at(-1, 0, 0))} · 汇报人：我

## 一、本周概览
- **目标完成度**：4 / 5，桌面管家验收清单顺延
- **关键进展**：埋点字段规范定稿；新手引导跑通首条链路
- **主要阻塞**：老系统缺少稳定元素标识

## 二、工作明细

| 事项 | 目标 | 进展 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 埋点方案 | 输出字段规范 | 已定稿 | 待评审 | 覆盖 12 类事件 |
| 智能体引导 | 跑通 1 条链路 | 已完成 | 新建订单链路可用 | 需补兜底 |
| 桌面管家 | 0.9 验收 | 70% | 图标隐藏仍有偶发失败 | 继续排查 |
| 运营培训 | 出速查表 | 未开始 | — | 下周 |

## 三、数据与反馈
- 引导覆盖率约 62%，未覆盖的集中在三级菜单
- 运营反馈：事件名太长，记忆成本高

## 四、下周计划
1. 完成埋点评审并冻结字段
2. 覆盖「退款」「改单」两条引导链路
3. 修复桌面管家隐藏图标的原生层异常

## 五、需要支持
- 需要研发提供菜单树的稳定 ID 方案`
      },
      {
        id: 'seed-meeting',
        notebookId: 'nb-meeting',
        title: '桌面管家 0.9 评审会纪要',
        tags: ['会议', '桌面管家'],
        templateId: 'tpl-meeting',
        createdAt: meetingAt,
        updatedAt: meetingAt,
        content: `# 11月2日 会议纪要 · 桌面管家 0.9 评审

| 项目 | 内容 |
| --- | --- |
| 会议时间 | ${ymd(meetingAt)} 15:00 |
| 会议地点 | 3F 小会议室 |
| 主持人 | 产品负责人 |
| 参会人 | 产品、前端、测试、运营代表 |
| 记录人 | 我 |

## 一、会议背景
0.9 版本要在本周内出可验收包，重点验证「图标收纳 + 便签待办」两条主线。

## 二、议题与讨论

### 议题 1：图标隐藏后系统图标如何处理
- **现状**：此电脑、回收站无法真正移出桌面，只能隐藏
- **讨论要点**：
  1. 通过注册表隐藏桌面副本，软件内保留入口
  2. 隐藏后要能一键恢复，避免用户找不到
- **结论**：采用注册表方案，工具栏保留统一开关

### 议题 2：便签待办的状态
- **结论**：未开始 / 进行中 / 已完成 三态，圆点可快速切换

## 三、决议事项

| 序号 | 决议内容 | 负责人 | 截止时间 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 图标开关合并为一个 | 前端 | 11-03 | 已完成 |
| 2 | 撤销整理后清空围栏 | 前端 | 11-03 | 已完成 |
| 3 | 补一版真机验收清单 | 测试 | 11-05 | 待开始 |

## 四、行动项
- [ ] 输出验收清单，覆盖 5 个核心场景
- [x] 修复撤销整理后的残留文件
- [ ] 确认壁纸资源的版权来源

## 五、待确认的问题
- 多显示器下覆盖层是否需要各自独立`
      },
      {
        id: 'seed-tracking',
        notebookId: 'nb-project',
        title: '埋点驱动的操作引导设计思路',
        tags: ['埋点', '智能体'],
        createdAt: trackAt,
        updatedAt: at(-2, 16, 10),
        content: `# 埋点驱动的操作引导设计思路

## 要解决的问题
内部系统有几百个菜单、几千个按钮，新人上手只能靠老员工带。培训成本高、口径不统一、出错后无法追溯。

## 整体思路
1. **采集**：页面级曝光 + 按钮级点击 + 关键表单字段变更
2. **建模**：把操作序列抽象成「流程」，识别用户在流程中的位置
3. **引导**：智能体根据当前位置给下一步建议，而不是给一整本手册

## 事件设计

| 事件 | 触发时机 | 关键字段 |
| --- | --- | --- |
| page_enter | 进入页面 | menu_path, role |
| action_click | 点击按钮 | btn_key, page_id |
| form_change | 表单变更 | field, filled |
| task_finish | 流程完成 | flow_id, duration |

> 命名原则：名词_动词，全小写，不超过 32 字符。

## 待验证
- [ ] 复合键（菜单路径 + 按钮文案）的稳定性
- [ ] 不同角色看到同一页面时的流程差异
- [ ] 引导打扰度：是否需要静默模式

## 下一步
先在一个高频流程（新建订单）上跑通，再横向复制。`
      },
      {
        id: 'seed-monthly',
        notebookId: 'nb-sum-monthly',
        title: '11 月工作计划',
        tags: ['需求'],
        createdAt: planAt,
        updatedAt: planAt,
        content: `# 2026 年 11 月工作计划

> 统计周期：2026-11-01 ~ 2026-11-30

## 一、月度目标

| 目标 | 权重 | 完成情况 | 自评 |
| --- | --- | --- | --- |
| 埋点方案落地首条链路 | 40% | 进行中 | ⭐⭐⭐ |
| 桌面管家 0.9 上线 | 30% | 70% | ⭐⭐ |
| 运营速查表交付 | 20% | 未开始 | — |
| 个人：完成技术方案沉淀 | 10% | 进行中 | ⭐⭐ |

## 二、重点成果

### 1. 埋点 + 智能体引导
- **背景**：新员工培训周期长
- **关键动作**：字段规范、流程建模、引导兜底
- **结果 / 数据**：首条链路覆盖率 62%

## 三、问题与复盘
- **问题**：需求变更频繁，方案反复
- **根因**：没有冻结字段口径
- **改进**：每次评审后出「冻结版」文档

## 四、下月规划
- [ ] 引导覆盖 3 条核心流程
- [ ] 桌面管家进入内测
- [ ] 输出一份可复用的埋点模板

## 五、个人成长
- 学习 superpowers 的 skill 组织方式，迁移到内部工具建设`
      },
      {
        id: 'seed-inbox',
        notebookId: 'nb-daily',
        title: '桌面管家 · 需求池',
        tags: ['需求', '桌面管家'],
        createdAt: inboxAt,
        updatedAt: at(-4, 9, 30),
        content: `# 桌面管家 · 需求池

## 待评估
- [ ] 分类自定义规则支持正则
- [ ] 便签支持提醒时间
- [ ] 多显示器下的独立布局

## 已确认
- [x] 文档与应用分开归类
- [x] 同一窗口内标签页切换
- [x] 不做倒计时小组件

## 明确不做
- 云同步（隐私顾虑）
- 桌面宠物`
      }
    ].map((n) => Object.assign({
      tags: [], pinned: false, starred: false, deletedAt: null, templateId: null
    }, n));
  }

  function seedState() {
    const now = Date.now();
    return {
      version: 1,
      schemaVersion: SCHEMA,
      notebooks: NOTEBOOKS.map((n) => ({ ...n })),
      tags: TAGS.map((name) => ({ id: 'tag-' + name, name })),
      notes: seedNotes(now),
      trackItems: [],
      templates: [],
      kinds: defaultKinds(),
      /* 密码箱：只保存密文（salt / iv / ct），明文永远不落盘 */
      vault: null,
      ui: {
        view: 'all',
        notebookId: null,
        tagId: null,
        search: '',
        activeNoteId: 'seed-daily',
        sort: 'updated',
        theme: 'light',
        editorMode: 'edit',
        collapsed: false
      }
    };
  }

  /* ───────── 状态 ───────── */
  let state = null;
  let saveTimer = null;
  let useBridge = false;
  const listeners = new Set();

  function normalize(s) {
    if (!s || typeof s !== 'object') return seedState();
    s.notebooks = Array.isArray(s.notebooks) && s.notebooks.length ? s.notebooks : NOTEBOOKS.map((n) => ({ ...n }));
    s.tags = Array.isArray(s.tags) ? s.tags : [];
    s.notes = Array.isArray(s.notes) ? s.notes : [];
    s.templates = Array.isArray(s.templates) ? s.templates : [];
    s.trackItems = Array.isArray(s.trackItems) ? s.trackItems : [];
    s.trackItems.forEach(normalizeTrack);
    /* 已从待办删掉、需要从桌面便签一并摘掉的便签 id（下次同步时清空） */
    s.stickyGone = Array.isArray(s.stickyGone) ? s.stickyGone : [];
    /* 随手记类型：内置类型缺失时补回来（新增功能后老数据自动获得入口） */
    s.kinds = Array.isArray(s.kinds) ? s.kinds : [];
    const defaults = defaultKinds();
    defaults.forEach((d) => {
      if (!s.kinds.some((k) => k && k.id === d.id)) s.kinds.push(d);
    });
    s.kinds = s.kinds.filter((k) => k && typeof k === 'object');
    s.kinds.forEach((k) => normalizeKind(k, defaults.find((d) => d.id === k.id)));
    s.vault = s.vault && typeof s.vault === 'object' && s.vault.ct ? s.vault : null;
    s.ui = Object.assign({
      view: 'all', notebookId: null, tagId: null, search: '',
      activeNoteId: null,
      sort: 'updated', theme: 'light', editorMode: 'edit', collapsed: false,
      kindId: null, nbExpanded: {}
    }, s.ui || {});
    if (!s.ui.nbExpanded || typeof s.ui.nbExpanded !== 'object') s.ui.nbExpanded = {};

    /* 旧视图迁移：待办事项 → 事项跟踪；近 7 天 / 收藏 → 全部笔记 */
    if (s.ui.view === 'todo' || s.ui.view === 'week' || s.ui.view === 'starred') {
      s.ui.view = s.ui.view === 'todo' ? 'track' : 'all';
    }

    if (!s.schemaVersion || s.schemaVersion < SCHEMA) {
      const prev = s.schemaVersion || 0;
      NOTEBOOKS.forEach((nb) => {
        const exists = s.notebooks.some((b) => b.id === nb.id || b.name === nb.name);
        if (!exists) s.notebooks.push({ ...nb });
      });
      /* 内置笔记本的归属/分组标记补齐（老数据没有 parentId） */
      s.notebooks.forEach((b) => {
        const def = NOTEBOOKS.find((d) => d.id === b.id);
        if (!def) return;
        if (def.parentId) b.parentId = def.parentId;
        if (def.group) b.group = true;
      });
      if (prev < 4) migrateSummaryNotes(s);
      if (prev < 5) migrateLegacyNotebooks(s);
      if (prev < 8) migrateRemoveInbox(s);
      s.schemaVersion = SCHEMA;
    }
    return s;
  }

  /** v4 迁移：把散落在「每周工作 / 每月工作 / 年度工作」里的 AI 总结归到「工作总结」下 */
  function migrateSummaryNotes(s) {
    const bucket = { week: 'nb-sum-weekly', month: 'nb-sum-monthly', quarter: 'nb-sum-quarterly', year: 'nb-sum-yearly' };
    const from = ['nb-weekly', 'nb-monthly', 'nb-yearly'];
    (s.notes || []).forEach((n) => {
      if (n.deletedAt || !from.includes(n.notebookId)) return;
      if (!(n.tags || []).includes('AI总结')) return;
      const t = String(n.title || '');
      let kind = 'month';
      if (/季度|Q[1-4]|第[一二三四]季度/.test(t)) kind = 'quarter';
      else if (/年度|年报|[0-9]{4}\s*年/.test(t)) kind = 'year';
      else if (/周/.test(t)) kind = 'week';
      n.notebookId = bucket[kind];
    });
  }

  /**
   * v5 迁移：删除「每周工作 / 每月工作 / 年度工作」三个旧笔记本，
   * 里面的笔记按标题/归属并入「工作总结」下的四个分类，避免数据丢失。
   */
  function migrateLegacyNotebooks(s) {
    const LEGACY_IDS = ['nb-weekly', 'nb-monthly', 'nb-yearly'];
    const LEGACY_NAMES = ['每周工作', '每月工作', '年度工作'];
    const nbs = s.notebooks || [];
    const legacy = new Set();
    nbs.forEach((b) => {
      if (LEGACY_IDS.includes(b.id) || LEGACY_NAMES.includes(b.name)) legacy.add(b.id);
    });
    if (!legacy.size) return;

    (s.notes || []).forEach((n) => {
      if (!legacy.has(n.notebookId)) return;
      const t = String(n.title || '');
      let target = 'nb-sum-monthly';
      if (/季度|Q[1-4]|第[一二三四]季度/.test(t)) target = 'nb-sum-quarterly';
      else if (/年度|年报/.test(t)) target = 'nb-sum-yearly';
      else if (/周/.test(t)) target = 'nb-sum-weekly';
      else if (n.notebookId === 'nb-weekly') target = 'nb-sum-weekly';
      else if (n.notebookId === 'nb-yearly') target = 'nb-sum-yearly';
      n.notebookId = target;
    });

    s.notebooks = nbs.filter((b) => !legacy.has(b.id));
    const ui = s.ui || {};
    if (legacy.has(ui.notebookId)) {
      ui.view = 'all';
      ui.notebookId = null;
    }
  }

  /**
   * v8 迁移：删除「收集箱」笔记本，箱内笔记并入「每日工作」（或第一个普通笔记本），
   * 待办事项不再走笔记本，改为侧栏的独立入口。
   */
  function migrateRemoveInbox(s) {
    const inbox = new Set();
    (s.notebooks || []).forEach((b) => {
      if (b.id === 'nb-inbox' || b.name === '收集箱') inbox.add(b.id);
    });
    if (!inbox.size) return;

    const fallback = (s.notebooks || []).find((b) => !inbox.has(b.id) && !b.parentId && !b.group);
    const targetId = fallback ? fallback.id : '';

    (s.notes || []).forEach((n) => { if (inbox.has(n.notebookId)) n.notebookId = targetId; });
    (s.kinds || []).forEach((k) => {
      if (inbox.has(k.notebookId)) k.notebookId = targetId;
      (k.subs || []).forEach((x) => { if (inbox.has(x.notebookId)) x.notebookId = targetId; });
    });
    s.notebooks = (s.notebooks || []).filter((b) => !inbox.has(b.id));

    const ui = s.ui || {};
    if (inbox.has(ui.notebookId)) { ui.view = 'all'; ui.notebookId = null; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? normalize(JSON.parse(raw)) : seedState();
    } catch (e) {
      console.warn('[store] 读取失败，使用示例数据', e);
      state = seedState();
    }
    return state;
  }

  /* notes.json 损坏时进入只读模式：界面可看（示例数据占位），但绝不写盘，
     等用户从 notes.json.bak.1~3 / notes.json.corrupt-* 里恢复原文件。 */
  let readonly = false;

  /**
   * 异步初始化：在桌面管家笔记窗口里优先读取 notes.json，
   * 普通浏览器则退回 localStorage。
   */
  async function init() {
    const bridge = global.NoteBridge;
    if (bridge && bridge.inShell) {
      let res = null;
      try { res = await bridge.loadState(); } catch (e) { res = null; }
      if (res && res.corrupt) {
        readonly = true;
        state = seedState();
        useBridge = true;
        try {
          document.dispatchEvent(new CustomEvent('guimo:notes-corrupt', { detail: { error: res.error } }));
        } catch (e) { /* 环境不支持 CustomEvent 也照常进入只读 */ }
        return state;
      }
      if (res && res.state && Array.isArray(res.state.notes)) {
        state = normalize(res.state);
        useBridge = true;
        return state;
      }
    }
    load();
    if (bridge && bridge.inShell) {
      useBridge = true;
      save(true); // 首次运行：把示例数据写入 notes.json
    }
    return state;
  }

  function save(immediate) {
    if (readonly) return; /* 损坏恢复前一律不落盘 */
    const done = () => {
      const json = JSON.stringify(state);
      if (useBridge && global.NoteBridge) {
        global.NoteBridge.saveState(json).then((ok) => {
          if (ok) return;
          /* 落盘失败：本次改动暂存 localStorage，同时通知界面提示用户 */
          try { localStorage.setItem(KEY, json); } catch (e) { /* ignore */ }
          try { document.dispatchEvent(new CustomEvent('guimo:save-failed')); } catch (e) { /* ignore */ }
        });
        return;
      }
      try {
        localStorage.setItem(KEY, json);
      } catch (e) {
        console.warn('[store] 保存失败', e);
      }
    };
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) { done(); return; }
    saveTimer = setTimeout(done, 260);
  }

  function emit() { listeners.forEach((fn) => fn(state)); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /* ───────── 查询 ───────── */
  const byId = (id) => state.notes.find((n) => n.id === id);
  const notebookOf = (id) => state.notebooks.find((b) => b.id === id);
  const activeNotes = () => state.notes.filter((n) => !n.deletedAt);

  /* ── 笔记本层级：分组笔记本 + 子笔记本 ── */
  const notebookKids = (id) => state.notebooks.filter((b) => b.parentId === id);
  const notebookScope = (id) => [id].concat(notebookKids(id).map((b) => b.id));
  const isGroupNotebook = (id) => {
    const b = notebookOf(id);
    return !!(b && (b.group || notebookKids(id).length));
  };
  const trackItems = () => state.trackItems || [];

  function noteTags(note) {
    return (note.tags || []).map((name) => ({ name, id: 'tag-' + name }));
  }

  function matchesSearch(note, q) {
    if (!q) return true;
    const kw = q.trim().toLowerCase();
    if (!kw) return true;
    const hay = [note.title, MD.plain(note.content, 4000), (note.tags || []).join(' ')]
      .join(' ').toLowerCase();
    return hay.includes(kw);
  }

  function sortNotes(list, sort) {
    const arr = list.slice();
    const pinnedFirst = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (sort === 'created') arr.sort((a, b) => pinnedFirst(a, b) || b.createdAt - a.createdAt);
    else if (sort === 'title') arr.sort((a, b) => pinnedFirst(a, b) || (a.title || '').localeCompare(b.title || '', 'zh'));
    else arr.sort((a, b) => pinnedFirst(a, b) || b.updatedAt - a.updatedAt);
    return arr;
  }

  function filteredNotes() {
    const ui = state.ui;
    const today = startOfDay(Date.now());

    if (ui.view === 'trash') {
      return state.notes.filter((n) => n.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
    }

    let list = activeNotes();
    if (ui.search) list = list.filter((n) => matchesSearch(n, ui.search));

    if (ui.view === 'notebook') {
      const scope = notebookScope(ui.notebookId);
      list = list.filter((n) => scope.includes(n.notebookId));
    }
    if (ui.view === 'tag') list = list.filter((n) => (n.tags || []).includes(tagName(ui.tagId)));
    if (ui.view === 'today') list = list.filter((n) => n.updatedAt >= today);
    /* 随手查：按「笔记类型」筛选；老笔记没有 kindId 时按模板归属兜底 */
    if (ui.view === 'lookup' && ui.kindId) {
      const k = (state.kinds || []).find((x) => x.id === ui.kindId);
      const tpls = k ? [k.templateId].concat((k.subs || []).map((x) => x.templateId)).filter(Boolean) : [];
      list = list.filter((n) => n.kindId === ui.kindId || (!n.kindId && tpls.includes(n.templateId)));
    }
    return sortNotes(list, ui.sort);
  }

  function tagName(id) {
    const t = state.tags.find((x) => x.id === id || x.name === id);
    return t ? t.name : id;
  }

  function counts() {
    const live = activeNotes();
    const today = startOfDay(Date.now());
    return {
      all: live.length,
      today: live.filter((n) => n.updatedAt >= today).length,
      track: trackItems().filter((t) => t.status !== 'done').length,
      trash: state.notes.filter((n) => n.deletedAt).length,
      perNotebook: state.notebooks.reduce((acc, b) => {
        const scope = notebookScope(b.id);
        acc[b.id] = live.filter((n) => scope.includes(n.notebookId)).length;
        return acc;
      }, {})
    };
  }

  function allTasks() {
    const out = [];
    activeNotes().forEach((n) => {
      MD.extractTasks(n.content).forEach((t) => {
        out.push({ note: n, ...t });
      });
    });
    return out;
  }

  /* ───────── 事项跟踪 ───────── */
  const TRACK_STATUS = ['todo', 'doing', 'done'];

  function trackItem(id) {
    return trackItems().find((t) => t.id === id) || null;
  }

  function normalizeTrack(it) {
    it.title = String(it.title || '未命名事项');
    it.detail = String(it.detail || '');
    it.status = TRACK_STATUS.includes(it.status) ? it.status : 'todo';
    it.createdAt = it.createdAt || Date.now();
    it.updatedAt = it.updatedAt || it.createdAt;
    it.closedAt = it.closedAt || null;
    /* 来自桌面便签的事项会记住便签 id，便于从便签「详情」直接跳到这里 */
    it.stickyId = it.stickyId || null;
    /* 已同步到便签的快照：用来识别「便签被改动」还是「自己推过去的回声」 */
    it.stickyAt = Number(it.stickyAt) || 0;
    it.stickyStatus = TRACK_STATUS.includes(it.stickyStatus) ? it.stickyStatus : null;
    it.stickyText = typeof it.stickyText === 'string' ? it.stickyText : null;
    /* 状态变更流水：进「每日工作」日志用（进度之外的另一种动态） */
    it.statusLog = Array.isArray(it.statusLog) ? it.statusLog.filter((s) => s && s.at) : [];
    /* 截止日期：YYYY-MM-DD，空表示不限期 */
    it.due = /^\d{4}-\d{2}-\d{2}$/.test(String(it.due || '')) ? it.due : null;
    it.progress = Array.isArray(it.progress) ? it.progress : [];
    it.risks = Array.isArray(it.risks) ? it.risks : [];
    return it;
  }

  function addTrackItem(opts) {
    const o = opts || {};
    const now = Date.now();
    const item = normalizeTrack({
      id: o.id || uid('trk'),
      title: String(o.title || '').trim() || '未命名事项',
      detail: String(o.detail || '').trim(),
      status: o.status || 'todo',
      createdAt: o.createdAt || now,
      updatedAt: o.updatedAt || o.createdAt || now,
      closedAt: o.closedAt || (o.status === 'done' ? (o.updatedAt || now) : null),
      stickyId: o.stickyId || null,
      due: o.due || null,
      progress: Array.isArray(o.progress) ? o.progress : [],
      risks: Array.isArray(o.risks) ? o.risks : []
    });
    state.trackItems.push(item);
    save();
    emit();
    return item;
  }

  function updateTrackItem(id, patch) {
    const it = trackItem(id);
    if (!it) return null;
    Object.assign(it, patch);
    normalizeTrack(it);
    it.updatedAt = Date.now();
    save();
    emit();
    return it;
  }

  function setTrackStatus(id, status) {
    const it = trackItem(id);
    if (!it) return null;
    const next = TRACK_STATUS.includes(status) ? status : it.status;
    if (next === it.status) return it;
    const at = Date.now();
    /* 记一笔状态流水，好让当天的「每日工作」日志留下痕迹 */
    if (!Array.isArray(it.statusLog)) it.statusLog = [];
    it.statusLog.push({ at, from: it.status, to: next });
    it.status = next;
    it.closedAt = next === 'done' ? at : null;
    it.updatedAt = at;
    save();
    emit();
    return it;
  }

  /** 记录一条进展；todo 状态自动转入 doing */
  function addTrackProgress(id, text, ts) {
    const it = trackItem(id);
    if (!it) return null;
    const at = ts || Date.now();
    const entry = { id: uid('p'), at, text: String(text || '').trim() };
    if (!entry.text) return it;
    it.progress.push(entry);
    if (it.status === 'todo') {
      if (!Array.isArray(it.statusLog)) it.statusLog = [];
      it.statusLog.push({ at, from: 'todo', to: 'doing' });
      it.status = 'doing';
    }
    it.updatedAt = at;
    save();
    emit();
    return it;
  }

  /** 记录一条风险 / 困难（不改变事项状态，独立于进展） */
  function addTrackRisk(id, text, ts) {
    const it = trackItem(id);
    if (!it) return null;
    if (!Array.isArray(it.risks)) it.risks = [];
    const at = ts || Date.now();
    const entry = { id: uid('r'), at, text: String(text || '').trim(), resolved: false };
    if (!entry.text) return it;
    it.risks.push(entry);
    it.updatedAt = at;
    save();
    emit();
    return it;
  }

  /** 切换风险的「已解决 / 未解决」状态 */
  function toggleTrackRisk(id, riskId) {
    const it = trackItem(id);
    if (!it) return null;
    const entry = (it.risks || []).find((r) => r.id === riskId);
    if (!entry) return it;
    entry.resolved = !entry.resolved;
    it.updatedAt = Date.now();
    save();
    emit();
    return it;
  }

  function deleteTrackItem(id) {
    const before = state.trackItems.length;
    const dead = state.trackItems.find((t) => t.id === id);
    state.trackItems = state.trackItems.filter((t) => t.id !== id);
    if (state.trackItems.length !== before) {
      /* 记下便签 id：下次同步时把桌面便签上的同一条也摘掉 */
      if (dead && dead.stickyId) {
        if (!Array.isArray(state.stickyGone)) state.stickyGone = [];
        state.stickyGone.push(dead.stickyId);
      }
      save(); emit();
    }
  }

  /* ───────── 便签同步标记 ───────── */

  /** 给待办挂上一个便签 id（不刷新 updatedAt，避免影响日志排序） */
  function linkSticky(id, stickyId) {
    const it = trackItem(id);
    if (!it || !stickyId) return null;
    it.stickyId = String(stickyId);
    save();
    return it;
  }

  /**
   * 记录「已经推送到便签」的快照。
   * 之后便签上出现不同内容，就说明是用户手动改的，可以放心回写。
   */
  function markStickySynced(entries) {
    let n = 0;
    (entries || []).forEach((e) => {
      if (!e || !e.id) return;
      const it = trackBySticky(e.id);
      if (!it) return;
      it.stickyAt = Date.now();
      it.stickyStatus = TRACK_STATUS.includes(e.status) ? e.status : it.status;
      it.stickyText = String(e.text || it.title || '');
      n++;
    });
    if (n) save();
    return n;
  }

  function clearStickyGone() {
    if (Array.isArray(state.stickyGone) && state.stickyGone.length) {
      state.stickyGone = [];
      save();
    }
  }

  /** 按桌面便签 id 找对应的事项跟踪记录 */
  function trackBySticky(stickyId) {
    if (!stickyId) return null;
    return trackItems().find((t) => t.stickyId === stickyId) || null;
  }

  /**
   * 把历史数据里「已经导入但没有 stickyId」的事项和便签重新对上号：
   * 标题完全一致、且该事项没有便签来源时，取创建时间最接近的一条。
   */
  function linkStickyTracks(list) {
    let changed = 0;
    (list || []).forEach((raw) => {
      if (!raw || !raw.id || trackBySticky(raw.id)) return;
      const title = String(raw.text || '').replace(/<!--.*?-->/g, '').trim();
      if (!title) return;
      const cands = trackItems().filter((t) => !t.stickyId && String(t.title || '').trim() === title);
      if (!cands.length) return;
      const at = Number(raw.at) || 0;
      const pick = cands.sort(
        (a, b) => Math.abs((a.createdAt || 0) - at) - Math.abs((b.createdAt || 0) - at)
      )[0];
      pick.stickyId = raw.id;
      changed++;
    });
    if (changed) save();
    return changed;
  }

  /**
   * 把桌面便签事项导入为跟踪事项；已导入过的（同 stickyId）跳过，
   * 所以可以在便签每次变化时安全地重复调用。
   */
  function importTrackItems(list) {
    let created = 0;
    (list || []).forEach((raw) => {
      if (!raw || !raw.id) return;
      const title = String(raw.text || '').replace(/<!--.*?-->/g, '').trim();
      if (!title) return;
      if (trackBySticky(raw.id)) return;
      const at = Number(raw.at) || Date.now();
      addTrackItem({
        title,
        status: raw.status === 'doing' || raw.status === 'done' ? raw.status : 'todo',
        createdAt: at,
        updatedAt: at,
        closedAt: raw.status === 'done' ? at : null,
        stickyId: raw.id,
        progress: [{ id: uid('p'), at, text: '从桌面便签导入' }]
      });
      created++;
    });
    if (created) { save(); emit(); }
    return created;
  }

  /* ───────── 变更 ───────── */
  function touch(note) {
    note.updatedAt = Date.now();
  }

  function createNote(opts) {
    const o = opts || {};
    const nb = o.notebookId || state.notebooks[0].id;
    const now = Date.now();
    const id = o.id || uid('note');
    const exist = state.notes.find((n) => n.id === id);
    if (exist) {
      if (exist.deletedAt) exist.deletedAt = null;
      return exist;
    }
    const note = {
      id,
      notebookId: nb,
      title: o.title || '无标题笔记',
      content: o.content || '',
      tags: o.tags || [],
      pinned: false,
      starred: false,
      templateId: o.templateId || null,
      kindId: o.kindId || null,
      kindSubId: o.kindSubId || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    state.notes.unshift(note);
    if (!o.silent) {
      /* 在笔记本里新建时留在当前笔记本，其它视图回到全部笔记 */
      if (state.ui.view !== 'notebook') state.ui.view = 'all';
      state.ui.search = '';
      state.ui.activeNoteId = note.id;
    }
    save();
    emit();
    return note;
  }

  function updateNote(id, patch, opts) {
    const n = byId(id);
    if (!n) return null;
    Object.assign(n, patch);
    if (!opts || opts.touch !== false) touch(n);
    save();
    emit();
    return n;
  }

  function trashNote(id) {
    const n = byId(id);
    if (!n) return;
    n.deletedAt = Date.now();
    if (state.ui.activeNoteId === id) {
      const next = filteredNotes()[0];
      state.ui.activeNoteId = next ? next.id : null;
    }
    save(); emit();
  }

  function restoreNote(id) {
    const n = byId(id);
    if (!n) return;
    n.deletedAt = null;
    n.updatedAt = Date.now();
    save(); emit();
  }

  function purgeNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id);
    if (state.ui.activeNoteId === id) state.ui.activeNoteId = null;
    save(); emit();
  }

  function emptyTrash() {
    state.notes = state.notes.filter((n) => !n.deletedAt);
    if (state.ui.view === 'trash') state.ui.activeNoteId = null;
    save(); emit();
  }

  /**
   * 三态循环：未开始 → 进行中 → 已完成 → 未开始
   * 便签里用圆点切换，这里保持同一套语义，勾选状态才能双向同步。
   */
  function cycleTask(noteId, line) {
    const n = byId(noteId);
    if (!n) return null;
    const lines = n.content.split('\n');
    const l = lines[line];
    if (l == null) return null;
    const m = l.match(/^(\s*[-*+]\s+)\[([ xX\/])\](.*)$/);
    if (!m) return null;
    const cur = m[2] === 'x' || m[2] === 'X' ? 'done' : m[2] === '/' ? 'doing' : 'todo';
    const next = cur === 'todo' ? 'doing' : cur === 'doing' ? 'done' : 'todo';
    const ch = next === 'done' ? 'x' : next === 'doing' ? '/' : ' ';
    lines[line] = m[1] + '[' + ch + ']' + m[3];
    n.content = lines.join('\n');
    touch(n);
    save(); emit();
    return next;
  }

  function addNotebook(name, color, opts) {
    const o = opts || {};
    const nb = { id: o.id || uid('nb'), name: name || '新笔记本', color: color || '#00a82d' };
    if (o.parentId) nb.parentId = o.parentId;
    if (o.group) nb.group = true;
    state.notebooks.push(nb);
    save(); emit();
    return nb;
  }

  /** 展开 / 收起分组笔记本（只影响侧栏显示） */
  function setNotebookExpanded(id, open) {
    state.ui.nbExpanded = state.ui.nbExpanded || {};
    state.ui.nbExpanded[id] = !!open;
    save();
  }

  function renameNotebook(id, name, color) {
    const nb = notebookOf(id);
    if (!nb) return;
    nb.name = name || nb.name;
    if (color) nb.color = color;
    save(); emit();
  }

  function deleteNotebook(id) {
    if (state.notebooks.length <= 1) return false;
    /* 分组笔记本 / 还有子笔记本的先不允许删，避免笔记没地方落 */
    if (notebookKids(id).length) return false;
    const target = state.notebooks.find((b) => b.id !== id && !b.group && !notebookKids(b.id).length)
      || state.notebooks.find((b) => b.id !== id);
    if (!target) return false;
    state.notes.forEach((n) => { if (n.notebookId === id) n.notebookId = target.id; });
    state.notebooks = state.notebooks.filter((b) => b.id !== id);
    if (state.ui.notebookId === id) { state.ui.view = 'all'; state.ui.notebookId = null; }
    save(); emit();
    return true;
  }

  /* ───────── 随手记类型 ───────── */
  const noteKinds = () => (state.kinds || []).filter((k) => !k.hidden);
  const allKinds = () => (state.kinds || []).slice();
  function noteKind(id) {
    return (state.kinds || []).find((k) => k.id === id) || null;
  }

  function addKind(data) {
    const k = normalizeKind(Object.assign({ builtin: false, hidden: false }, data || {}));
    state.kinds.push(k);
    save(); emit();
    return k;
  }

  function updateKind(id, patch) {
    const k = (state.kinds || []).find((x) => x.id === id);
    if (!k) return null;
    Object.assign(k, patch || {});
    normalizeKind(k, KINDS.find((d) => d.id === k.id));
    save(); emit();
    return k;
  }

  /** 内置类型只隐藏（可恢复），自定义类型直接删除 */
  function deleteKind(id) {
    const k = (state.kinds || []).find((x) => x.id === id);
    if (!k) return false;
    if (k.builtin) k.hidden = true;
    else state.kinds = state.kinds.filter((x) => x.id !== id);
    save(); emit();
    return true;
  }

  function restoreKinds() {
    state.kinds = defaultKinds();
    save(); emit();
  }

  function addTag(name) {
    const nm = String(name || '').trim().replace(/^#/, '');
    if (!nm) return null;
    const exist = state.tags.find((t) => t.name === nm);
    if (exist) return exist;
    const t = { id: 'tag-' + nm, name: nm };
    state.tags.push(t);
    save(); emit();
    return t;
  }

  function deleteTag(id) {
    const name = tagName(id);
    state.tags = state.tags.filter((t) => t.id !== id);
    state.notes.forEach((n) => { n.tags = (n.tags || []).filter((x) => x !== name); });
    if (state.ui.tagId === id) { state.ui.view = 'all'; state.ui.tagId = null; }
    save(); emit();
  }

  function setTagOnNote(noteId, tagNameValue, on) {
    const n = byId(noteId);
    if (!n) return;
    n.tags = n.tags || [];
    if (on && !n.tags.includes(tagNameValue)) n.tags.push(tagNameValue);
    if (!on) n.tags = n.tags.filter((t) => t !== tagNameValue);
    touch(n);
    save(); emit();
  }

  function setUI(patch) {
    Object.assign(state.ui, patch);
    save();
    emit();
  }

  /* ───────── 密码箱（这里只存密文，加解密在 vault.js） ───────── */
  function getVault() {
    return state.vault || null;
  }

  function setVault(blob) {
    state.vault = blob || null;
    save(true);
    emit();
  }

  /* ───────── 笔记本默认模板 ───────── */
  function defaultTemplateOf(nbId) {
    const nb = notebookOf(nbId);
    if (!nb) return null;
    if (typeof nb.defaultTemplateId === 'string') return nb.defaultTemplateId || null;
    return DEFAULT_TEMPLATES[nb.id] || DEFAULT_TEMPLATES[nb.name] || null;
  }

  function setNotebookDefaultTemplate(nbId, tplId) {
    const nb = notebookOf(nbId);
    if (!nb) return;
    nb.defaultTemplateId = tplId || '';
    save(); emit();
  }

  function replaceState(next) {
    state = normalize(next);
    save(true);
    emit();
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.notes)) throw new Error('文件格式不正确');
    replaceState(data);
  }

  function storageSize() {
    try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return 0; }
  }

  /* 脚本加载即初始化状态 */
  load();

  global.Store = {
    KEY, uid, load, save, subscribe, emit, get state() { return state; },
    get isReadonly() { return readonly; },
    getNote: byId, notebookOf, filteredNotes, counts, allTasks, sortNotes, tagName,
    createNote, updateNote, trashNote, restoreNote, purgeNote, emptyTrash, cycleTask, init,
    addNotebook, renameNotebook, deleteNotebook,
    notebookKids, notebookScope, isGroupNotebook, setNotebookExpanded,
    defaultTemplateOf, setNotebookDefaultTemplate, DEFAULT_TEMPLATES,
    addTag, deleteTag, setTagOnNote, setUI, replaceState,
    trackItems, trackItem, addTrackItem, updateTrackItem, setTrackStatus,
    addTrackProgress, addTrackRisk, toggleTrackRisk, deleteTrackItem, importTrackItems,
    trackBySticky, linkStickyTracks, linkSticky, markStickySynced, clearStickyGone,
    noteKinds, allKinds, noteKind, addKind, updateKind, deleteKind, restoreKinds,
    getVault, setVault,
    exportJSON, importJSON, storageSize,
    activeNotes
  };
})(window);
