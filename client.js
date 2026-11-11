/* ================================================================
 * 开发工作台（dsh-devwork）· 客户端面板
 *
 * 结构：常量与文案 → 图标 → 纯函数 → 请求层 → 通用组件
 *       → 今日 / 看板 / 列表 / 活动 → 抽屉 / 新建 / 设置 → 主应用 → 注册
 * 事实源：服务端 <workspace>/.devwork/board.json；面板只缓存一份快照，
 *         每次写操作后重拉；SSE 不可用则 15s 轮询兜底。
 * 主题：容器只用 --dsw-alias-* token（带浅色回退），类型/状态色为自有内容色。
 * 依赖：inject ['slots','uiWorkspace']；包与模块 id 均为 dsh-devwork。
 * ================================================================ */
window.__ModuleLoader__.load({
  id: 'dsh-devwork',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    const API = '/devwork/api';
    const POLL_MS = 15000;
    const FETCH_TIMEOUT_MS = 8000;
    const TICK_MS = 15000;

    /* ---------------- 文案 ---------------- */
    const ZH = {
      brand: '开发工作台',
      tagline: '设计 · 产品 · 开发，一屏推进',
      today: '今日', board: '看板', list: '列表', activity: '活动',
      newTask: '新建任务', refresh: '刷新', settings: '设置',
      live: '实时', polling: '轮询中', offline: '离线', connecting: '连接中',
      loadFail: '无法读取看板数据', retry: '重试',
      loading: '正在读取看板…',
      workspace: '工作区',
      noTasks: '还没有任务',
      noTasksHint: '新建一个任务，或让左侧对话里的 agent 用 dev_item 帮你拆解。',
      loadDemo: '载入示例任务',
      focus: '今日焦点',
      doing: '进行中', dueToday: '今日到期', overdue: '已逾期',
      review: '待验收', blocked: '受阻', done: '已完成', canceled: '已取消',
      stale: '停滞', stats: '概览',
      attention: '需要你决定', noAttention: '没有待决定事项',
      answer: '回答', answered: '已回答',
      wip: 'WIP', wipHint: '进行中任务超过上限，考虑先收尾再开工',
      search: '搜索标题或标签', filterType: '类型', filterPriority: '优先级', filterStatus: '状态',
      all: '全部', clear: '清除',
      moveTo: '移动到', open: '打开详情', del: '删除任务', status: '状态',
      start: '开始', submit: '提交验收', approve: '验收完成', rework: '返工',
      unblock: '恢复', reopen: '重开',
      handoffWork: '交给 agent 执行', handoffReview: '让 agent 复核', handoffPlan: '拆解下一步',
      confirmDelete: '删除后不可恢复，确认删除任务',
      confirmDone: '确认验收完成？',
      title: '标题', type: '类型', priority: '优先级', owner: '负责人',
      due: '到期', estimate: '估时(h)', spent: '已用(h)', progress: '进度',
      desc: '描述', descHint: '支持换行纯文本', checklist: '检查清单',
      addItem: '添加一项…', artifacts: '交付物', addArtifact: '添加交付物',
      label: '名称', path: '路径', log: '活动', none: '无',
      created: '已创建任务', updated: '已保存', moved: '状态已更新',
      synced: '看板已同步', deleted: '任务已删除', handoffFail: '无法发起会话',
      settingsTitle: '看板设置', wipLimit: '进行中上限', staleDays: '停滞天数',
      showCanceled: '显示已取消', autonomy: '自主性', save: '保存',
      saveOk: '设置已保存', exampleLoaded: '示例任务已载入',
      hours: 'h', minute: '分', hour: '时', day: '天',
      close: '关闭', emptyBoard: '看板是空的',
      overdueBy: '逾期', todayLabel: '今天', tomorrow: '明天',
      thisWeek: '完成率', noActivity: '暂无活动',
      agent: 'agent', human: '我', system: '系统',
      id: '编号', updatedAt: '更新', blockedReason: '受阻原因',
      retryHint: '确认宿主已重启并刷新页面',
      error: '出错了', dismiss: '知道了',
      moveHint: '拖拽卡片，或使用卡片菜单移动（键盘可用）',
      projects: '项目', allProjects: '全部项目', project: '项目', newProject: '新建项目',
      manageProjects: '管理项目', projectName: '项目名称', projectColor: '颜色',
      projectDesc: '项目说明', projectStatus: '项目状态', statusActive: '进行中',
      statusPaused: '已暂停', statusDone: '已结束', deleteProject: '删除项目',
      confirmDeleteProject: '删除后不可恢复，项目下的任务会移到「未归属」。确认删除',
      noProjects: '还没有项目', noProjectsHint: '先建立一个项目，再把任务放进去。',
      projectProgress: '完成率', nextDue: '最近到期', unassigned: '未归属',
      projectCreated: '项目已创建', projectUpdated: '项目已保存', projectDeleted: '项目已删除',
      projectNotEmpty: '项目下还有任务，请先移走或选择移到别的项目',
      filterProject: '项目', moveToProject: '移到项目', projectTasks: '任务',
      openCount: '未完成', editProject: '编辑项目', taskOfProject: '项目任务',
    };
    const EN = {
      brand: 'Dev workbench', tagline: 'Design · product · build, in one board',
      today: 'Today', board: 'Board', list: 'List', activity: 'Activity',
      newTask: 'New task', refresh: 'Refresh', settings: 'Settings',
      live: 'Live', polling: 'Polling', offline: 'Offline', connecting: 'Connecting',
      loadFail: 'Cannot read board data', retry: 'Retry', loading: 'Loading board…',
      workspace: 'Workspace', noTasks: 'No tasks yet',
      noTasksHint: 'Create one, or ask the agent to break work down with dev_item.',
      loadDemo: 'Load sample tasks', focus: "Today's focus",
      doing: 'In progress', dueToday: 'Due today', overdue: 'Overdue',
      review: 'In review', blocked: 'Blocked', done: 'Done', canceled: 'Canceled',
      stale: 'Stale', stats: 'Overview', attention: 'Needs your decision',
      noAttention: 'Nothing waiting on you', answer: 'Answer', answered: 'Answered',
      wip: 'WIP', wipHint: 'Work-in-progress is over the limit — finish before starting.',
      search: 'Search title or tag', filterType: 'Type', filterPriority: 'Priority',
      filterStatus: 'Status', all: 'All', clear: 'Clear', moveTo: 'Move to',
      open: 'Open details', del: 'Delete task', status: 'Status', start: 'Start', submit: 'Submit for review',
      approve: 'Approve', rework: 'Reopen work', unblock: 'Resume', reopen: 'Reopen',
      handoffWork: 'Run with agent', handoffReview: 'Agent review', handoffPlan: 'Plan next steps',
      confirmDelete: 'Deleting cannot be undone. Delete task', confirmDone: 'Approve as done?',
      title: 'Title', type: 'Type', priority: 'Priority', owner: 'Owner', due: 'Due',
      estimate: 'Est. hours', spent: 'Spent hours', progress: 'Progress', desc: 'Description',
      descHint: 'Plain text, newlines kept', checklist: 'Checklist', addItem: 'Add an item…',
      artifacts: 'Artifacts', addArtifact: 'Add artifact', label: 'Label', path: 'Path',
      log: 'Activity', none: 'None', created: 'Task created', updated: 'Saved',
      moved: 'Status updated', synced: 'Board synced', deleted: 'Task deleted',
      handoffFail: 'Could not start a session', settingsTitle: 'Board settings',
      wipLimit: 'WIP limit', staleDays: 'Stale after (days)', showCanceled: 'Show canceled',
      autonomy: 'Autonomy', save: 'Save', saveOk: 'Settings saved',
      exampleLoaded: 'Sample tasks loaded', hours: 'h', minute: 'm', hour: 'h', day: 'd',
      close: 'Close', emptyBoard: 'The board is empty', overdueBy: 'overdue',
      todayLabel: 'today', tomorrow: 'tomorrow', thisWeek: 'Completion',
      noActivity: 'No activity yet', agent: 'agent', human: 'me', system: 'system',
      id: 'ID', updatedAt: 'Updated', blockedReason: 'Blocked because',
      retryHint: 'Restart the host and refresh the page', error: 'Something went wrong',
      dismiss: 'Got it', moveHint: 'Drag a card, or use its menu to move (keyboard friendly)',
      projects: 'Projects', allProjects: 'All projects', project: 'Project', newProject: 'New project',
      manageProjects: 'Manage projects', projectName: 'Project name', projectColor: 'Color',
      projectDesc: 'Description', projectStatus: 'Status', statusActive: 'Active',
      statusPaused: 'Paused', statusDone: 'Finished', deleteProject: 'Delete project',
      confirmDeleteProject: 'This cannot be undone. Tasks move to Unassigned. Delete',
      noProjects: 'No projects yet', noProjectsHint: 'Create one, then add tasks to it.',
      projectProgress: 'Progress', nextDue: 'Next due', unassigned: 'Unassigned',
      projectCreated: 'Project created', projectUpdated: 'Project saved', projectDeleted: 'Project deleted',
      projectNotEmpty: 'Project still has tasks — move them first',
      filterProject: 'Project', moveToProject: 'Move to project', projectTasks: 'tasks',
      openCount: 'open', editProject: 'Edit project', taskOfProject: 'project tasks',
    };
    /* 面板文案以中文为主（列名/类型名等枚举也为中文）；EN 词表保留给后续 i18n。 */
    const DICT = ZH;
    const t = (k) => DICT[k] || ZH[k] || k;

    /* ---------------- 枚举 ---------------- */
    const STATUS = [
      { key: 'todo', label: '待办', color: '#64748B', icon: 'inbox', desc: '可以开始' },
      { key: 'doing', label: '进行中', color: '#059669', icon: 'play', desc: '正在做' },
      { key: 'review', label: '待验收', color: '#D97706', icon: 'circle-check', desc: '等人验收' },
      { key: 'blocked', label: '受阻', color: '#DC2626', icon: 'alert', desc: '等外部' },
      { key: 'done', label: '已完成', color: '#0D9488', icon: 'check', desc: '已验收' },
    ];
    const CANCELED = { key: 'canceled', label: '已取消', color: '#94A3B8', icon: 'x', desc: '' };
    const STATUS_MAP = { todo: STATUS[0], doing: STATUS[1], review: STATUS[2], blocked: STATUS[3], done: STATUS[4], canceled: CANCELED };
    const STATUS_LABEL = { todo: '待办', doing: '进行中', review: '待验收', blocked: '受阻', done: '已完成', canceled: '已取消' };

    const TYPES = [
      { key: 'design', label: '设计', color: '#8B5CF6', icon: 'pen' },
      { key: 'product', label: '产品', color: '#0284C7', icon: 'file' },
      { key: 'dev', label: '开发', color: '#059669', icon: 'code' },
      { key: 'qa', label: '测试', color: '#D97706', icon: 'circle-check' },
      { key: 'research', label: '调研', color: '#DB2777', icon: 'search' },
      { key: 'ops', label: '运维', color: '#64748B', icon: 'gear' },
    ];
    const TYPE_MAP = TYPES.reduce((m, x) => (m[x.key] = x, m), {});

    const PRIORITIES = [
      { key: 'P0', label: 'P0', color: '#DC2626' },
      { key: 'P1', label: 'P1', color: '#EA580C' },
      { key: 'P2', label: 'P2', color: '#0284C7' },
      { key: 'P3', label: 'P3', color: '#64748B' },
    ];
    const PRIORITY_MAP = PRIORITIES.reduce((m, x) => (m[x.key] = x, m), {});

    const PROJECT_COLORS = ['#5B7CFA', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#64748B'];
    const PROJECT_STATUS = [
      { key: 'active', label: '进行中', color: '#059669' },
      { key: 'paused', label: '已暂停', color: '#D97706' },
      { key: 'done', label: '已结束', color: '#64748B' },
    ];
    const PROJECT_STATUS_MAP = PROJECT_STATUS.reduce((m, x) => (m[x.key] = x, m), {});

    /* 人的状态机（与宿主 store.allowedTransition 同源） */
    const TRANSITIONS = {
      todo: ['doing', 'blocked', 'canceled'],
      doing: ['review', 'done', 'blocked', 'todo'],
      review: ['done', 'doing', 'canceled'],
      blocked: ['doing', 'todo', 'canceled'],
      done: ['review', 'todo'],
      canceled: ['todo'],
    };

    /* ---------------- 图标（自绘 24×24，stroke 1.8） ---------------- */
    const ICONS = {
      kanban: ['M4 4h4.5v16H4z', 'M9.8 4h4.5v10H9.8z', 'M15.6 4H20v6.5h-4.4z'],
      inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z'],
      play: ['M6 3.5l14 8.5-14 8.5z'],
      pause: ['M7 4h3.5v16H7z', 'M13.5 4H17v16h-3.5z'],
      'circle-check': ['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'M22 4L12 14.01l-3-3'],
      check: ['M20 6L9 17l-5-5'],
      alert: ['M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
      x: ['M18 6L6 18', 'M6 6l12 12'],
      plus: ['M12 5v14', 'M5 12h14'],
      search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
      filter: ['M22 3H2l8 9.5V19l4 2v-8.5z'],
      gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
      'chevron-down': ['M6 9l6 6 6-6'],
      'chevron-right': ['M9 6l6 6-6 6'],
      more: ['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
      trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M10 11v6', 'M14 11v6'],
      link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
      file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
      folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
      layers: ['M12 2l9 5-9 5-9-5 9-5z', 'M3 12l9 5 9-5', 'M3 17l9 5 9-5'],
      'folder-plus': ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', 'M12 11v6', 'M9 14h6'],
      sparkles: ['M12 3l1.9 5.6L19.5 10.5 13.9 12.4 12 18l-1.9-5.6L4.5 10.5 10.1 8.6z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
      refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
      calendar: ['M8 2v4', 'M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
      clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
      timer: ['M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 10v4l2 2', 'M9 2h6'],
      list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
      activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
      'arrow-right': ['M5 12h14', 'M12 5l7 7-7 7'],
      'arrow-up': ['M12 19V5', 'M5 12l7-7 7 7'],
      target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
      bolt: ['M13 2L3 14h7l-1 8 10-12h-7l1-8z'],
      user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
      pen: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
      code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
      flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
      dot: [],
    };
    function Icon(props) {
      const size = (props && props.size) || 16;
      const paths = ICONS[(props && props.name) || 'dot'] || [];
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block', flex: '0 0 auto' },
      }, paths.map((d, i) => h('path', { key: i, d: d })));
    }

    /* ---------------- 纯函数 ---------------- */
    const pad2 = (n) => String(n).padStart(2, '0');
    function localToday() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function dayDelta(due) {
      const today = localToday();
      if (!due) return null;
      const a = new Date(today + 'T00:00:00').getTime();
      const b = new Date(String(due) + 'T00:00:00').getTime();
      if (isNaN(b)) return null;
      return Math.round((b - a) / 86400000);
    }
    function dueLabel(due) {
      const d = dayDelta(due);
      if (d === null) return '';
      if (d === 0) return '今天';
      if (d === 1) return '明天';
      if (d === -1) return '昨天';
      if (d < 0) return '逾期 ' + (-d) + ' 天';
      return String(due).slice(5).replace('-', '/');
    }
    function dueTone(due) {
      const d = dayDelta(due);
      if (d === null) return '';
      if (d < 0) return 'danger';
      if (d === 0) return 'warn';
      return '';
    }
    function isClosed(task) { return task.status === 'done' || task.status === 'canceled'; }
    /* 未关闭任务的过去日期显示为「逾期 N 天」，已关闭任务只显示日期 */
    function dueLabelOf(task) {
      const d = dayDelta(task.due);
      if (d === null) return '';
      if (!isClosed(task) && d < 0) return '逾期 ' + (-d) + ' 天';
      return dueLabel(task.due);
    }
    function dueToneOf(task) {
      if (isClosed(task)) return '';
      return dueTone(task.due);
    }
    function relTime(iso) {
      if (!iso) return '';
      const ms = Date.now() - new Date(iso).getTime();
      if (isNaN(ms) || ms < 0) return '';
      const m = Math.floor(ms / 60000);
      if (m < 1) return '刚刚';
      if (m < 60) return m + ' 分钟前';
      const hrs = Math.floor(m / 60);
      if (hrs < 24) return hrs + ' 小时前';
      const days = Math.floor(hrs / 24);
      if (days < 30) return days + ' 天前';
      return new Date(iso).toLocaleDateString();
    }
    function elapsedText(startedAt, now) {
      if (!startedAt) return '';
      const ms = now - new Date(startedAt).getTime();
      if (isNaN(ms) || ms < 0) return '';
      const mins = Math.floor(ms / 60000);
      if (mins < 60) return mins + ' 分钟';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + ' 小时 ' + (mins % 60) + ' 分';
      return Math.floor(hrs / 24) + ' 天 ' + (hrs % 24) + ' 小时';
    }
    function timeOfDay(iso) {
      try { const d = new Date(iso); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); } catch (e) { return ''; }
    }
    function dayKey(iso) {
      try { const d = new Date(iso); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); } catch (e) { return ''; }
    }
    function dayTitle(key) {
      if (!key) return '';
      const today = localToday();
      if (key === today) return '今天';
      const y = new Date(new Date(today + 'T00:00:00').getTime() - 86400000);
      const yd = y.getFullYear() + '-' + pad2(y.getMonth() + 1) + '-' + pad2(y.getDate());
      if (key === yd) return '昨天';
      return key;
    }
    const toArray = (v) => Array.isArray(v) ? v : [];
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const initialOf = (s) => { const x = String(s || t('human')).trim(); return x ? x.slice(0, 1).toUpperCase() : '·'; };
    function typeOf(k) { return TYPE_MAP[k] || TYPES[2]; }
    function projectStatusOf(k) { return PROJECT_STATUS_MAP[k] || PROJECT_STATUS[0]; }
    function projectById(projects, id) { return toArray(projects).find((p) => p && p.id === id) || null; }
    function projectOfTask(projects, task) { return task && task.projectId ? projectById(projects, task.projectId) : null; }
    function projectNameOf(projects, id) { const p = projectById(projects, id); return p ? p.name : t('unassigned'); }
    function projectColorOf(projects, id) { const p = projectById(projects, id); return p ? p.color : '#94A3B8'; }
    function filterTasksByProject(tasks, projectId) {
      const list = toArray(tasks);
      return projectId ? list.filter((x) => x && x.projectId === projectId) : list;
    }
    function projectStat(project, tasks) {
      const scoped = toArray(tasks).filter((x) => x && x.projectId === project.id);
      const total = scoped.length;
      if (project.stats && typeof project.stats === 'object') return project.stats;
      const done = scoped.filter((x) => x.status === 'done').length;
      const canceled = scoped.filter((x) => x.status === 'canceled').length;
      const denom = total - canceled;
      return {
        total: total, open: scoped.filter((x) => isOpen(x)).length,
        doing: scoped.filter((x) => x.status === 'doing').length,
        review: scoped.filter((x) => x.status === 'review').length,
        blocked: scoped.filter((x) => x.status === 'blocked').length,
        done: done, canceled: canceled,
        progress: denom > 0 ? Math.round((done / denom) * 100) : 0,
      };
    }
    function statusOf(k) { return STATUS_MAP[k] || STATUS[0]; }
    function moveTargets(status) { return (TRANSITIONS[status] || []).map((k) => statusOf(k)); }
    function allowedTo(status, target) { return (TRANSITIONS[status] || []).indexOf(target) >= 0; }
    function isOverdue(task) { const d = dayDelta(task.due); return d !== null && d < 0 && task.status !== 'done' && task.status !== 'canceled'; }
    function isDueToday(task) { return dayDelta(task.due) === 0 && task.status !== 'done' && task.status !== 'canceled'; }
    function isOpen(task) { return task.status !== 'done' && task.status !== 'canceled'; }
    function checklistDone(task) { return toArray(task.checklist).filter((c) => c && c.done).length; }
    function pct(task) {
      const list = toArray(task.checklist);
      if (list.length) return Math.round((checklistDone(task) / list.length) * 100);
      return clamp(Number(task.progress) || 0, 0, 100);
    }
    function sortTasks(list) {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return list.slice().sort((a, b) => {
        const pa = rank[a.priority] === undefined ? 9 : rank[a.priority];
        const pb = rank[b.priority] === undefined ? 9 : rank[b.priority];
        if (pa !== pb) return pa - pb;
        const da = a.due || '9999-99-99';
        const db = b.due || '9999-99-99';
        if (da !== db) return da < db ? -1 : 1;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
    }

    /* ---------------- 请求层 ---------------- */
    function timeoutSignal(ms) {
      try { if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms); } catch (e) { /* ignore */ }
      try {
        if (typeof AbortController === 'function') {
          const ctl = new AbortController();
          const tid = setTimeout(() => { try { ctl.abort(); } catch (e) { /* ignore */ } }, ms);
          if (ctl.signal && typeof ctl.signal.addEventListener === 'function') ctl.signal.addEventListener('abort', () => clearTimeout(tid), { once: true });
          return ctl.signal;
        }
      } catch (e) { /* ignore */ }
      return undefined;
    }
    async function request(path, opts) {
      const o = opts || {};
      let res;
      try {
        res = await fetch(API + path, {
          method: o.method || 'GET',
          headers: o.body ? { 'Content-Type': 'application/json' } : undefined,
          body: o.body ? JSON.stringify(o.body) : undefined,
          signal: timeoutSignal(FETCH_TIMEOUT_MS),
          credentials: 'same-origin',
        });
      } catch (e) { return { ok: false, reason: '请求失败：' + String((e && e.message) || e), code: 'NETWORK' }; }
      let payload = null;
      try { payload = await res.json(); } catch (e) { payload = null; }
      if (!payload || typeof payload !== 'object') payload = { ok: false, reason: '响应不是 JSON（HTTP ' + res.status + '）' };
      if (payload.ok !== true && !payload.reason) payload.reason = 'HTTP ' + res.status;
      return payload;
    }
    const get = (path) => request(path);
    const post = (path, body) => request(path, { method: 'POST', body: body || {} });

    /* ---------------- 数据 hook ---------------- */
    function useWorkbench() {
      const [data, setData] = useState(null);
      const [err, setErr] = useState('');
      const [live, setLive] = useState('connecting');
      const [lastSync, setLastSync] = useState(0);
      const [toasts, setToasts] = useState([]);
      const revRef = useRef(-1);
      const toastSeq = useRef(0);
      const pushToast = useCallback((msg, kind) => {
        toastSeq.current += 1;
        const id = toastSeq.current;
        setToasts((cur) => cur.concat([{ id: id, msg: msg, kind: kind || 'info' }]));
        setTimeout(() => { setToasts((cur) => cur.filter((x) => x.id !== id)); }, 3200);
      }, []);
      const refresh = useCallback(async (quiet) => {
        const r = await get('/state');
        if (!r.ok) {
          setErr(r.reason || t('loadFail'));
          setLive((cur) => (cur === 'live' ? cur : 'offline'));
          return null;
        }
        setErr('');
        const prev = revRef.current;
        if (!quiet && prev !== -1 && r.rev !== prev) pushToast(t('synced'), 'info');
        revRef.current = r.rev;
        setData(r);
        setLastSync(Date.now());
        return r;
      }, [pushToast]);

      useEffect(() => { refresh(true); }, [refresh]);

      /* SSE：能连上就是实时；失败降级轮询 */
      useEffect(() => {
        let es = null;
        let disposed = false;
        const start = () => {
          if (typeof EventSource !== 'function') { setLive('poll'); return; }
          try { es = new EventSource(API + '/stream'); } catch (e) { setLive('poll'); return; }
          es.addEventListener('hello', () => { if (!disposed) setLive('live'); });
          es.addEventListener('state', () => { if (!disposed) { setLive('live'); refresh(false); } });
          es.onerror = () => { if (disposed) return; setLive('poll'); try { es.close(); } catch (e) { /* ignore */ } es = null; };
        };
        start();
        return () => { disposed = true; try { if (es) es.close(); } catch (e) { /* ignore */ } };
      }, [refresh]);

      /* 轮询兜底：可见 + 未实时 + 15s */
      useEffect(() => {
        const id = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          if (live === 'live') return;
          refresh(true);
        }, POLL_MS);
        return () => clearInterval(id);
      }, [live, refresh]);

      useEffect(() => {
        const onVisible = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh(true); };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
      }, [refresh]);

      const send = useCallback(async (path, body, opts) => {
        const o = opts || {};
        const r = await post(path, body);
        if (!r.ok) {
          pushToast(r.reason || t('error'), 'error');
          await refresh(true);
          return r;
        }
        await refresh(true);
        if (o.toast) pushToast(o.toast, 'ok');
        return r;
      }, [pushToast, refresh]);

      return { data: data, err: err, live: live, lastSync: lastSync, toasts: toasts, setToasts: setToasts, refresh: refresh, send: send, pushToast: pushToast };
    }

    function useNow(ms) {
      const [now, setNow] = useState(Date.now());
      useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(id);
      }, [ms]);
      return now;
    }

    /* ---------------- 通用组件 ---------------- */
    function Btn(props) {
      const p = props || {};
      const attrs = {
        type: 'button', className: 'dw-btn' + (p.kind ? ' dw-btn-' + p.kind : '') + (p.small ? ' dw-btn-sm' : '') + (p.block ? ' dw-btn-block' : '') + (p.className ? ' ' + p.className : ''),
        onClick: p.onClick, disabled: !!p.disabled, title: p.title || undefined,
        'aria-label': p['aria-label'] || undefined,
      };
      return h('button', attrs, p.icon ? h(Icon, { name: p.icon, size: p.small ? 14 : 15 }) : null, p.children ? h('span', null, p.children) : null);
    }
    function IconBtn(props) {
      const p = props || {};
      return h('button', {
        type: 'button', className: 'dw-iconbtn' + (p.active ? ' on' : ''), onClick: p.onClick,
        title: p.title || undefined, 'aria-label': p['aria-label'] || p.title || undefined, disabled: !!p.disabled,
      }, h(Icon, { name: p.name || 'dot', size: p.size || 16 }));
    }
    function Chip(props) {
      const p = props || {};
      const style = p.color ? { '--dw-chip': p.color } : undefined;
      return h('span', { className: 'dw-chip' + (p.tone ? ' dw-chip-' + p.tone : '') + (p.color ? ' dw-chip-color' : ''), style: style, title: p.title || undefined }, p.children);
    }
    function TypeDot(props) {
      return h('span', { className: 'dw-typedot', style: { background: typeOf(props.type).color }, 'aria-hidden': 'true' });
    }
    function TypeTag(props) {
      const ty = typeOf(props.type);
      return h('span', { className: 'dw-typetag', style: { '--dw-type-color': ty.color } }, h(TypeDot, { type: props.type }), ty.label);
    }
    function PriorityTag(props) {
      const pr = PRIORITY_MAP[props.priority];
      if (!pr) return null;
      if (props.onlyHigh && pr.key !== 'P0' && pr.key !== 'P1') return null;
      return h('span', { className: 'dw-prio', style: { '--dw-prio': pr.color } }, pr.label);
    }
    function Avatar(props) {
      return h('span', { className: 'dw-avatar', title: props.name || '', 'aria-hidden': 'true' }, initialOf(props.name));
    }
    function LiveBadge(props) {
      const live = props.live;
      const label = live === 'live' ? t('live') : live === 'poll' ? t('polling') : live === 'offline' ? t('offline') : t('connecting');
      return h('span', {
        className: 'dw-live dw-live-' + live, role: 'status', 'aria-live': 'polite',
        title: props.lastSync ? '最近同步 ' + timeOfDay(new Date(props.lastSync).toISOString()) : '',
      }, h('span', { className: 'dw-live-dot', 'aria-hidden': 'true' }), label);
    }
    function Bar(props) {
      const v = clamp(Number(props.value) || 0, 0, 100);
      return h('span', { className: 'dw-bar' + (props.tone ? ' dw-bar-' + props.tone : '') }, h('span', { className: 'dw-bar-fill', style: { width: v + '%' } }));
    }
    function Ring(props) {
      const size = props.size || 46;
      const stroke = 4;
      const r = (size - stroke * 2) / 2;
      const c = 2 * Math.PI * r;
      const v = clamp(Number(props.value) || 0, 0, 100);
      return h('span', { className: 'dw-ring' },
        h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, 'aria-hidden': 'true' },
          h('circle', { cx: size / 2, cy: size / 2, r: r, fill: 'none', stroke: 'var(--dw-border-2)', strokeWidth: stroke }),
          h('circle', {
            cx: size / 2, cy: size / 2, r: r, fill: 'none', stroke: 'var(--dw-accent)', strokeWidth: stroke, strokeLinecap: 'round',
            strokeDasharray: c, strokeDashoffset: c * (1 - v / 100),
            transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
            style: { transition: 'stroke-dashoffset .35s ease' },
          })),
        h('span', { className: 'dw-ring-text' }, v + '%'));
    }
    function Spinner(props) {
      return h('span', { className: 'dw-spinner' + (props && props.small ? ' sm' : ''), role: 'status', 'aria-label': t('loading') },
        h('span', null), h('span', null), h('span', null));
    }
    function Empty(props) {
      return h('div', { className: 'dw-empty' },
        h('svg', { viewBox: '0 0 120 88', width: 168, height: 123, 'aria-hidden': 'true', className: 'dw-empty-art' },
          h('rect', { x: 12, y: 16, width: 30, height: 56, rx: 7, fill: 'none', stroke: 'var(--dw-border-2)', strokeWidth: 2 }),
          h('rect', { x: 48, y: 26, width: 30, height: 46, rx: 7, fill: 'none', stroke: 'var(--dw-border-2)', strokeWidth: 2 }),
          h('rect', { x: 84, y: 10, width: 24, height: 40, rx: 6, fill: 'none', stroke: 'var(--dw-border-2)', strokeWidth: 2 }),
          h('path', { d: 'M20 28h14M20 36h10M56 38h14M56 46h10M90 22h12', stroke: 'var(--dw-accent)', strokeWidth: 2, strokeLinecap: 'round', opacity: .7 }),
          h('circle', { cx: 96, cy: 64, r: 12, fill: 'var(--dw-surface-2)', stroke: 'var(--dw-accent)', strokeWidth: 2 }),
          h('path', { d: 'M96 59v10M91 64h10', stroke: 'var(--dw-accent)', strokeWidth: 2, strokeLinecap: 'round' })),
        h('div', { className: 'dw-empty-title' }, props.title),
        props.desc ? h('div', { className: 'dw-empty-desc' }, props.desc) : null,
        props.children ? h('div', { className: 'dw-empty-actions' }, props.children) : null);
    }
    function SectionHead(props) {
      return h('div', { className: 'dw-sec-head' },
        h('span', { className: 'dw-sec-title' }, props.icon ? h(Icon, { name: props.icon, size: 14 }) : null, props.title),
        props.count !== undefined ? h('span', { className: 'dw-sec-count' }, props.count) : null,
        props.extra ? h('span', { className: 'dw-sec-extra' }, props.extra) : null);
    }
    function ToastStack(props) {
      const list = toArray(props.toasts);
      if (!list.length) return null;
      return h('div', { className: 'dw-toasts', 'aria-live': 'polite' },
        list.map((x) => h('div', { key: x.id, className: 'dw-toast dw-toast-' + x.kind }, x.msg)));
    }

    /* ---------------- 项目组件 ---------------- */
    const PROJECT_STORE_KEY = 'dsh-devwork:project';
    function readStoredProject() { try { return localStorage.getItem(PROJECT_STORE_KEY) || ''; } catch (e) { return ''; } }
    function storeProject(id) { try { if (id) localStorage.setItem(PROJECT_STORE_KEY, id); else localStorage.removeItem(PROJECT_STORE_KEY); } catch (e) { /* ignore */ } }

    function ProjectTag(props) {
      const p = props.project;
      const name = p ? p.name : t('unassigned');
      const short = name.length > 9 ? name.slice(0, 9) + '…' : name;
      return h('span', {
        className: 'dw-projtag', title: name,
        style: { '--dw-proj-color': p ? p.color : '#94A3B8' },
      }, h('span', { className: 'dw-projdot', 'aria-hidden': 'true' }), short);
    }

    function ProjectSwitcher(props) {
      const projects = toArray(props.projects);
      const value = props.value || '';
      const current = projectById(projects, value);
      const [open, setOpen] = useState(false);
      const ref = useRef(null);
      useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
      }, [open]);
      const openCount = (p) => Number((p.stats || {}).open) || 0;
      const totalOpen = projects.reduce((n, p) => n + openCount(p), 0);
      if (!projects.length) {
        return h('button', { type: 'button', className: 'dw-projswitch', onClick: props.onCreate },
          h(Icon, { name: 'folder-plus', size: 14 }), h('span', { className: 'dw-projswitch-name' }, t('newProject')));
      }
      return h('div', { className: 'dw-projswitch-wrap', ref: ref },
        h('button', {
          type: 'button', className: 'dw-projswitch', 'aria-haspopup': 'menu', 'aria-expanded': open,
          title: current ? current.name : t('allProjects'),
          onClick: () => setOpen(!open),
        },
          h('span', { className: 'dw-projdot', style: { background: current ? current.color : 'var(--dw-text-3)' }, 'aria-hidden': 'true' }),
          h('span', { className: 'dw-projswitch-name' }, current ? current.name : t('allProjects')),
          h('span', { className: 'dw-projswitch-count' }, current ? openCount(current) : totalOpen),
          h(Icon, { name: 'chevron-down', size: 13 })),
        open ? h('div', { className: 'dw-menu dw-projswitch-menu', role: 'menu' },
          h('button', {
            type: 'button', role: 'menuitemradio', 'aria-checked': value === '',
            className: 'dw-menu-item' + (value === '' ? ' on' : ''),
            onClick: () => { setOpen(false); props.onChange(''); },
          }, h(Icon, { name: 'layers', size: 14 }), h('span', { className: 'dw-menu-grow' }, t('allProjects')),
            h('span', { className: 'dw-menu-count' }, projects.length + ' · ' + totalOpen)),
          h('div', { className: 'dw-menu-sep' }),
          projects.map((p) => h('button', {
            key: p.id, type: 'button', role: 'menuitemradio', 'aria-checked': value === p.id,
            className: 'dw-menu-item' + (value === p.id ? ' on' : ''),
            onClick: () => { setOpen(false); props.onChange(p.id); },
          },
            h('span', { className: 'dw-projdot', style: { background: p.color }, 'aria-hidden': 'true' }),
            h('span', { className: 'dw-menu-grow' }, p.name),
            h('span', { className: 'dw-menu-count' }, openCount(p)))),
          h('div', { className: 'dw-menu-sep' }),
          h('button', { type: 'button', role: 'menuitem', className: 'dw-menu-item', onClick: () => { setOpen(false); props.onCreate(); } },
            h(Icon, { name: 'plus', size: 14 }), t('newProject')),
          h('button', { type: 'button', role: 'menuitem', className: 'dw-menu-item', onClick: () => { setOpen(false); props.onManage(); } },
            h(Icon, { name: 'folder', size: 14 }), t('manageProjects'))) : null);
    }

    function ProjectsView(props) {
      const data = props.data;
      const projects = toArray(data.projects);
      const tasks = toArray(data.tasks);
      const [menuId, setMenuId] = useState('');
      const menuRef = useRef(null);
      useEffect(() => {
        if (!menuId) return undefined;
        const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuId(''); };
        const onKey = (e) => { if (e.key === 'Escape') setMenuId(''); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
      }, [menuId]);

      const askDelete = async (project) => {
        setMenuId('');
        if (!(typeof window !== 'undefined' && window.confirm(t('confirmDeleteProject') + '「' + project.name + '」？'))) return;
        const r = await props.onDeleteProject(project.id, '');
        if (r && !r.ok && r.code === 'PROJECT_NOT_EMPTY') {
          if (typeof window !== 'undefined' && window.confirm('项目「' + project.name + '」下还有任务，确认把它们移到「未归属」并删除项目？')) {
            await props.onDeleteProject(project.id, '');
          }
        }
      };

      const card = (p) => {
        const st = projectStat(p, tasks);
        const ps = projectStatusOf(p.status);
        const denom = Math.max(0, (st.total || 0) - (st.canceled || 0));
        const done = Number(st.done) || 0;
        const rate = denom ? Math.round((done / denom) * 100) : 0;
        const nextDue = st.nextDue || '';
        return h('article', {
          key: p.id, className: 'dw-projcard', style: { '--dw-proj-color': p.color },
          tabIndex: 0,
          onClick: () => props.onOpenProject(p.id),
          onKeyDown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) props.onOpenProject(p.id); },
        },
          h('div', { className: 'dw-projcard-head' },
            h('span', { className: 'dw-projdot lg', style: { background: p.color } }),
            h('span', { className: 'dw-projcard-name' }, p.name),
            h('span', { className: 'dw-projstatus', style: { '--dw-proj-status': ps.color } }, ps.label),
            h('div', { className: 'dw-projcard-menu', ref: menuId === p.id ? menuRef : null },
              h('button', {
                type: 'button', className: 'dw-card-more', 'aria-haspopup': 'menu', 'aria-expanded': menuId === p.id,
                'aria-label': t('project'), onClick: (e) => { e.stopPropagation(); setMenuId(menuId === p.id ? '' : p.id); },
              }, h(Icon, { name: 'more', size: 15 })),
              menuId === p.id ? h('div', { className: 'dw-menu', role: 'menu' },
                h('button', { type: 'button', role: 'menuitem', className: 'dw-menu-item', onClick: (e) => { e.stopPropagation(); setMenuId(''); props.onEditProject(p); } },
                  h(Icon, { name: 'pen', size: 14 }), t('editProject')),
                h('button', { type: 'button', role: 'menuitem', className: 'dw-menu-item danger', onClick: (e) => { e.stopPropagation(); askDelete(p); } },
                  h(Icon, { name: 'trash', size: 14 }), t('deleteProject'))) : null)),
          p.description ? h('p', { className: 'dw-projcard-desc' }, p.description) : null,
          h('div', { className: 'dw-projcard-progress' },
            h(Bar, { value: rate }),
            h('span', { className: 'dw-projcard-pct' }, rate + '%')),
          h('div', { className: 'dw-projcard-counts' },
            h('span', null, h('b', null, Number(st.todo) || 0), ' 待办'),
            h('span', { className: 'dot-green' }, h('b', null, Number(st.doing) || 0), ' ', t('doing')),
            h('span', { className: 'dot-amber' }, h('b', null, Number(st.review) || 0), ' ', t('review')),
            h('span', { className: 'dot-red' }, h('b', null, Number(st.blocked) || 0), ' ', t('blocked')),
            h('span', { className: 'dot-muted' }, h('b', null, done), ' ', t('done'))),
          h('div', { className: 'dw-projcard-foot' },
            h('span', null, h(Icon, { name: 'list', size: 12 }), (Number(st.total) || 0) + ' ' + t('projectTasks')),
            nextDue ? h('span', { className: 'dw-due dw-due-' + (dueTone(nextDue) || 'normal') }, h(Icon, { name: 'calendar', size: 12 }), t('nextDue') + ' ' + nextDue.slice(5).replace('-', '/')) : null));
      };

      return h('div', { className: 'dw-projects-view' },
        h('div', { className: 'dw-toolbar' },
          h('div', { className: 'dw-filter-chips' },
            h('span', { className: 'dw-count-note' }, projects.length + ' 个项目 · ' + tasks.length + ' 个任务')),
          h('div', { className: 'dw-toolbar-right' },
            props.projectFilter ? h(Btn, { small: true, icon: 'x', onClick: () => props.onFilter('') }, '查看全部') : null,
            h(Btn, { small: true, kind: 'primary', icon: 'plus', onClick: props.onCreateProject }, t('newProject')))),
        projects.length ? h('div', { className: 'dw-projgrid' },
          projects.map(card),
          h('button', { type: 'button', className: 'dw-projcard add', onClick: props.onCreateProject },
            h(Icon, { name: 'folder-plus', size: 20 }), h('span', null, t('newProject'))))
          : h('div', { className: 'dw-empty-simple' }, h(Empty, {
            title: t('noProjects'), desc: t('noProjectsHint'),
          }, h(Btn, { kind: 'primary', icon: 'plus', onClick: props.onCreateProject }, t('newProject')))));
    }

    function ProjectDialog(props) {
      const mode = props.mode || 'create';
      const p = props.project || null;
      const [name, setName] = useState(p ? p.name : '');
      const [color, setColor] = useState(p ? p.color : PROJECT_COLORS[0]);
      const [description, setDescription] = useState(p ? (p.description || '') : '');
      const [status, setStatus] = useState(p ? p.status : 'active');
      const [busy, setBusy] = useState(false);
      const [confirm, setConfirm] = useState(false);
      const ref = useRef(null);
      useEffect(() => { if (ref.current) { try { ref.current.focus(); } catch (e) { /* ignore */ } } }, []);
      const submit = async () => {
        const v = name.trim();
        if (!v) return;
        setBusy(true);
        const payload = mode === 'edit'
          ? { id: p.id, patch: { name: v, color: color, description: description, status: status } }
          : { name: v, color: color, description: description };
        const r = await props.onSave(payload, mode);
        setBusy(false);
        if (r && r.ok) props.onClose();
      };
      const doDelete = async () => {
        setConfirm(false);
        let r = await props.onDelete(p.id);
        if (r && !r.ok && r.code === 'PROJECT_NOT_EMPTY') {
          if (typeof window !== 'undefined' && window.confirm('项目「' + name + '」下还有任务，确认移到「未归属」并删除项目？')) {
            r = await props.onDelete(p.id, '');
          } else {
            return;
          }
        }
        if (r && r.ok) props.onClose();
      };
      return h('div', { className: 'dw-modal-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('project') },
        h('div', { className: 'dw-scrim', onClick: props.onClose }),
        h('div', { className: 'dw-modal' },
          h('header', { className: 'dw-modal-head' },
            h('span', { className: 'dw-modal-title' }, mode === 'edit' ? t('editProject') : t('newProject')),
            h(IconBtn, { name: 'x', title: t('close'), onClick: props.onClose })),
          h('div', { className: 'dw-modal-body' },
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('projectName')),
              h('input', { ref: ref, type: 'text', value: name, placeholder: '例如：登录改版', onChange: (e) => setName(e.target.value) })),
            h('div', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('projectColor')),
              h('div', { className: 'dw-swatches', role: 'group', 'aria-label': t('projectColor') },
                PROJECT_COLORS.map((c) => h('button', {
                  key: c, type: 'button', className: 'dw-swatch' + (c.toLowerCase() === String(color).toLowerCase() ? ' on' : ''),
                  style: { background: c }, 'aria-label': c, 'aria-pressed': c.toLowerCase() === String(color).toLowerCase(),
                  onClick: () => setColor(c),
                })))),
            mode === 'edit' ? h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('projectStatus')),
              h('select', { value: status, onChange: (e) => setStatus(e.target.value) },
                PROJECT_STATUS.map((x) => h('option', { key: x.key, value: x.key }, x.label)))) : null,
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('projectDesc')),
              h('textarea', { rows: 3, value: description, onChange: (e) => setDescription(e.target.value) }))),
          h('footer', { className: 'dw-modal-foot' },
            mode === 'edit' ? h('button', { type: 'button', className: 'dw-danger-btn', onClick: () => setConfirm(true) },
              h(Icon, { name: 'trash', size: 14 }), t('deleteProject')) : h('span', null),
            h('div', { className: 'dw-modal-actions' },
              h(Btn, { onClick: props.onClose }, '取消'),
              h(Btn, { kind: 'primary', onClick: submit, disabled: busy || !name.trim() }, t('save')))),
          confirm ? h('div', { className: 'dw-confirm', role: 'alertdialog' },
            h('div', { className: 'dw-confirm-text' }, t('confirmDeleteProject') + '「' + name + '」？'),
            h('div', { className: 'dw-confirm-actions' },
              h(Btn, { small: true, onClick: () => setConfirm(false) }, '取消'),
              h(Btn, { small: true, kind: 'danger', onClick: doDelete }, t('deleteProject')))) : null));
    }

    /* ---------------- 任务卡 ---------------- */
    function TaskCard(props) {
      const task = props.task;
      const now = props.now;
      const [menu, setMenu] = useState(false);
      const menuRef = useRef(null);
      const st = statusOf(task.status);
      const ty = typeOf(task.type);
      const targets = moveTargets(task.status).filter((s) => s.key !== 'canceled');
      const checklist = toArray(task.checklist);

      useEffect(() => {
        if (!menu) return undefined;
        const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
        const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
      }, [menu]);

      const onDragStart = (e) => {
        try { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
        if (props.onDragStart) props.onDragStart(task.id);
        e.currentTarget.classList.add('dragging');
      };
      const onDragEnd = (e) => { e.currentTarget.classList.remove('dragging'); if (props.onDragEnd) props.onDragEnd(); };

      return h('article', {
        className: 'dw-card dw-card-' + task.status + (props.compact ? ' compact' : ''),
        draggable: true, onDragStart: onDragStart, onDragEnd: onDragEnd,
        style: { '--dw-type-color': ty.color, '--dw-status-color': st.color },
        tabIndex: 0,
        onClick: () => props.onOpen(task),
        onKeyDown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); props.onOpen(task); } },
        'aria-label': task.title + '，' + st.label,
      },
        h('div', { className: 'dw-card-top' },
          h('div', { className: 'dw-card-tags' },
            h(TypeTag, { type: task.type }),
            h(PriorityTag, { priority: task.priority, onlyHigh: true }),
            props.showProject ? h(ProjectTag, { project: props.project }) : null),
          h('div', { className: 'dw-card-menu-wrap', ref: menuRef },
            h('button', {
              type: 'button', className: 'dw-card-more', 'aria-haspopup': 'menu', 'aria-expanded': menu,
              'aria-label': t('moveTo'), onClick: (e) => { e.stopPropagation(); setMenu(!menu); },
            }, h(Icon, { name: 'more', size: 15 })),
            menu ? h('div', { className: 'dw-menu', role: 'menu' },
              h('button', { type: 'button', role: 'menuitem', className: 'dw-menu-item', onClick: () => { setMenu(false); props.onOpen(task); } },
                h(Icon, { name: 'arrow-right', size: 14 }), t('open')),
              h('div', { className: 'dw-menu-sep' }),
              h('div', { className: 'dw-menu-label' }, t('moveTo')),
              targets.map((s) => h('button', {
                key: s.key, type: 'button', role: 'menuitem', className: 'dw-menu-item',
                onClick: () => { setMenu(false); props.onMove(task.id, s.key); },
              }, h('span', { className: 'dw-statusdot', style: { background: s.color } }), s.label))) : null)),
        h('h3', { className: 'dw-card-title' }, task.title),
        task.description ? h('p', { className: 'dw-card-desc' }, task.description) : null,
        checklist.length ? h('div', { className: 'dw-card-sub' },
          h('span', { className: 'dw-mini' }, h(Icon, { name: 'list', size: 12 }), checklistDone(task) + '/' + checklist.length)) : null,
        task.status === 'doing' || (pct(task) > 0 && !isClosed(task)) ? h('div', { className: 'dw-card-progress' },
          h(Bar, { value: pct(task), tone: task.status === 'blocked' ? 'danger' : null }),
          h('span', { className: 'dw-card-pct' }, pct(task) + '%')) : null,
        h('div', { className: 'dw-card-foot' },
          h('span', { className: 'dw-card-meta' },
            task.due ? h('span', { className: 'dw-due dw-due-' + (dueToneOf(task) || 'normal') }, h(Icon, { name: 'calendar', size: 12 }), dueLabelOf(task)) : null,
            task.status === 'doing' && task.startedAt ? h('span', { className: 'dw-elapsed' }, h(Icon, { name: 'timer', size: 12 }), elapsedText(task.startedAt, now)) : null),
          h(Avatar, { name: task.owner })));
    }

    /* ---------------- 看板 ---------------- */
    function BoardView(props) {
      const data = props.data;
      const [dragId, setDragId] = useState('');
      const [overCol, setOverCol] = useState('');
      const [typeFilter, setTypeFilter] = useState('');
      const [query, setQuery] = useState('');
      const tasks = filterTasksByProject(data.tasks, props.projectFilter);
      const wipLimit = Number((data.settings || {}).wipLimit) || 0;
      const doingCount = tasks.filter((x) => x.status === 'doing').length;
      const showCanceled = !!(data.settings || {}).showCanceled;

      const filtered = tasks.filter((task) => {
        if (!showCanceled && task.status === 'canceled') return false;
        if (typeFilter && task.type !== typeFilter) return false;
        if (query) {
          const hay = (task.title + ' ' + toArray(task.tags).join(' ')).toLowerCase();
          if (hay.indexOf(query.toLowerCase()) < 0) return false;
        }
        return true;
      });
      const cols = STATUS.concat(showCanceled ? [CANCELED] : []);

      return h('div', { className: 'dw-board-view' },
        h('div', { className: 'dw-toolbar' },
          h('div', { className: 'dw-filter-chips', role: 'group', 'aria-label': t('filterType') },
            h('button', { type: 'button', className: 'dw-filter' + (typeFilter === '' ? ' on' : ''), onClick: () => setTypeFilter('') }, t('all')),
            TYPES.map((ty) => h('button', {
              key: ty.key, type: 'button', className: 'dw-filter' + (typeFilter === ty.key ? ' on' : ''),
              style: { '--dw-type-color': ty.color }, onClick: () => setTypeFilter(typeFilter === ty.key ? '' : ty.key),
            }, h(TypeDot, { type: ty.key }), ty.label))),
          h('div', { className: 'dw-toolbar-right' },
            h('label', { className: 'dw-search' },
              h(Icon, { name: 'search', size: 14 }),
              h('input', { type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'), onChange: (e) => setQuery(e.target.value) })),
            wipLimit ? h('span', { className: 'dw-wip' + (doingCount > wipLimit ? ' over' : ''), title: t('wipHint') },
              t('wip'), ' ', h('b', null, doingCount + '/' + wipLimit)) : null)),
        h('div', { className: 'dw-board', style: { gridTemplateColumns: 'repeat(' + cols.length + ',minmax(200px,1fr))' } },
          cols.map((col) => {
            const list = sortTasks(filtered.filter((task) => task.status === col.key));
            const isOver = overCol === col.key;
            return h('section', {
              key: col.key, className: 'dw-col' + (isOver ? ' over' : '') + (col.key === 'doing' ? ' col-doing' : ''),
              onDragEnter: (e) => { e.preventDefault(); setOverCol(col.key); },
              onDragOver: (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ } },
              onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(''); },
              onDrop: (e) => {
                e.preventDefault();
                let id = '';
                try { id = e.dataTransfer.getData('text/plain'); } catch (err) { /* ignore */ }
                id = id || dragId;
                setOverCol('');
                if (!id) return;
                const task = tasks.find((x) => x.id === id);
                if (task && task.status !== col.key && allowedTo(task.status, col.key)) props.onMove(id, col.key);
                else if (task && task.status !== col.key) props.pushToast('不允许从「' + STATUS_LABEL[task.status] + '」直接到「' + col.label + '」', 'error');
              },
            },
              h('header', { className: 'dw-col-head' },
                h('span', { className: 'dw-col-bar', style: { background: col.color } }),
                h('span', { className: 'dw-col-name' }, col.label),
                h('span', { className: 'dw-col-count' }, list.length),
                col.key === 'doing' && wipLimit ? h('span', { className: 'dw-col-wip' + (list.length > wipLimit ? ' over' : ''), title: t('wipHint') },
                  h('span', { className: 'dw-col-wip-bar' }, h('span', { style: { width: Math.min(100, Math.round(list.length / wipLimit * 100)) + '%' } }))) : null),
              h('div', { className: 'dw-col-body' },
                list.length ? list.map((task) => h(TaskCard, {
                  key: task.id, task: task, now: props.now, onOpen: props.onOpen, onMove: props.onMove,
                  project: projectOfTask(data.projects, task), showProject: !props.projectFilter,
                  onDragStart: setDragId, onDragEnd: () => setDragId(''),
                })) : h('div', { className: 'dw-col-empty' }, col.key === 'done' ? '—' : '暂无')),
            );
          })),
        h('div', { className: 'dw-board-hint' }, t('moveHint')));
    }

    /* ---------------- 今日 ---------------- */
    function StatTile(props) {
      return h('button', {
        type: 'button', className: 'dw-stat' + (props.tone ? ' dw-stat-' + props.tone : '') + (props.onClick ? ' clickable' : ''),
        onClick: props.onClick || undefined, 'aria-label': props.label + ' ' + props.value,
      },
        h('span', { className: 'dw-stat-icon' }, h(Icon, { name: props.icon, size: 15 })),
        h('span', { className: 'dw-stat-text' },
          h('span', { className: 'dw-stat-value' }, props.value),
          h('span', { className: 'dw-stat-label' }, props.label)));
    }
    function AttentionCard(props) {
      const item = props.item;
      const [answer, setAnswer] = useState('');
      const [busy, setBusy] = useState(false);
      const submit = async () => {
        const text = answer.trim();
        if (!text) { props.pushToast('请先写回答', 'error'); return; }
        setBusy(true);
        const r = await props.onResolve(item.id, text);
        setBusy(false);
        if (r && r.ok) setAnswer('');
      };
      return h('div', { className: 'dw-attn' },
        h('div', { className: 'dw-attn-head' },
          h('span', { className: 'dw-attn-icon' }, h(Icon, { name: item.kind === 'blocked' ? 'alert' : 'bolt', size: 15 })),
          h('span', { className: 'dw-attn-title' }, item.kind === 'blocked' ? '被阻塞，需要你决定' : item.kind === 'review' ? '等待验收' : '需要你决定'),
          item.target && item.target.kind === 'task' && props.taskTitle ? h('button', { type: 'button', className: 'dw-attn-link', onClick: () => props.onOpen(item.target.id) }, props.taskTitle) : null,
          h('span', { className: 'dw-attn-time' }, relTime(item.askedAt))),
        h('div', { className: 'dw-attn-q' }, item.question),
        h('div', { className: 'dw-attn-form' },
          h('input', {
            type: 'text', value: answer, placeholder: '写下你的决定…', 'aria-label': t('answer'),
            onChange: (e) => setAnswer(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } },
          }),
          h(Btn, { kind: 'primary', small: true, onClick: submit, disabled: busy }, t('answer'))));
    }
    function TodayView(props) {
      const data = props.data;
      const allTasks = toArray(data.tasks);
      const tasks = filterTasksByProject(allTasks, props.projectFilter);
      const taskById = (id) => allTasks.find((x) => x.id === id);
      const attention = toArray(data.attention).filter((x) => {
        if (x.status === 'resolved') return false;
        if (!props.projectFilter) return true;
        if (!x.target) return false;
        if (x.target.kind === 'task') { const tk = taskById(x.target.id); return !!(tk && tk.projectId === props.projectFilter); }
        if (x.target.kind === 'project') return x.target.id === props.projectFilter;
        return false;
      });
      const doing = sortTasks(tasks.filter((x) => x.status === 'doing'));
      const due = sortTasks(tasks.filter(isDueToday));
      const overdue = sortTasks(tasks.filter(isOverdue));
      const review = sortTasks(tasks.filter((x) => x.status === 'review'));
      const blocked = sortTasks(tasks.filter((x) => x.status === 'blocked'));
      const staleDays = Number((data.settings || {}).staleDays) || 3;
      const staleCut = Date.now() - staleDays * 86400000;
      const stale = sortTasks(tasks.filter((x) => isOpen(x) && x.updatedAt && new Date(x.updatedAt).getTime() < staleCut && x.status !== 'blocked'));
      const total = tasks.filter((x) => x.status !== 'canceled').length;
      const doneCount = tasks.filter((x) => x.status === 'done').length;
      const rate = total ? Math.round((doneCount / total) * 100) : 0;
      const attentionTask = (id) => { const x = tasks.find((y) => y.id === id); return x ? x.title : ''; };
      const showTaskRow = (task) => h(TaskCard, {
        key: task.id, task: task, now: props.now, compact: true, onOpen: props.onOpen, onMove: props.onMove,
        project: projectOfTask(data.projects, task), showProject: !props.projectFilter,
      });

      return h('div', { className: 'dw-today' },
        attention.length ? h('div', { className: 'dw-attn-wrap' },
          h(SectionHead, { icon: 'bolt', title: t('attention'), count: attention.length }),
          attention.map((item) => h(AttentionCard, {
            key: item.id, item: item, pushToast: props.pushToast, onResolve: props.onResolveAttention,
            onOpen: (id) => { const tk = tasks.find((x) => x.id === id); if (tk) props.onOpen(tk); },
            taskTitle: item.target && item.target.kind === 'task' ? attentionTask(item.target.id) : '',
          }))) : null,
        h('div', { className: 'dw-stats' },
          h(StatTile, { icon: 'play', label: t('doing'), value: doing.length, onClick: () => props.onGo('board') }),
          h(StatTile, { icon: 'calendar', label: t('dueToday'), value: due.length, tone: due.length ? 'warn' : '', onClick: () => props.onGo('list') }),
          h(StatTile, { icon: 'alert', label: t('overdue'), value: overdue.length, tone: overdue.length ? 'danger' : '', onClick: () => props.onGo('list') }),
          h(StatTile, { icon: 'circle-check', label: t('review'), value: review.length, onClick: () => props.onGo('board') }),
          h(StatTile, { icon: 'clock', label: t('stale'), value: stale.length, onClick: () => props.onGo('list') }),
          h('div', { className: 'dw-stat dw-stat-ring' },
            h(Ring, { value: rate, size: 46 }),
            h('span', { className: 'dw-stat-label' }, t('thisWeek')))),
        h('div', { className: 'dw-today-grid' },
          h('section', { className: 'dw-panel' },
            h(SectionHead, { icon: 'play', title: t('doing'), count: doing.length }),
            doing.length ? h('div', { className: 'dw-panel-body' }, doing.map(showTaskRow))
              : h('div', { className: 'dw-panel-empty' }, '没有进行中的任务')),
          h('section', { className: 'dw-panel' },
            h(SectionHead, { icon: 'calendar', title: t('dueToday') + ' / ' + t('overdue'), count: due.length + overdue.length }),
            (due.length + overdue.length) ? h('div', { className: 'dw-panel-body' }, overdue.concat(due).map(showTaskRow))
              : h('div', { className: 'dw-panel-empty' }, '今天没有到期任务')),
          h('section', { className: 'dw-panel' },
            h(SectionHead, { icon: 'circle-check', title: t('review'), count: review.length, extra: review.length ? h('button', { type: 'button', className: 'dw-linkish', onClick: () => props.onGo('board') }, '去验收') : null }),
            review.length ? h('div', { className: 'dw-panel-body' }, review.map(showTaskRow))
              : h('div', { className: 'dw-panel-empty' }, '没有待验收任务')),
          h('section', { className: 'dw-panel' },
            h(SectionHead, { icon: 'alert', title: t('blocked'), count: blocked.length }),
            blocked.length ? h('div', { className: 'dw-panel-body' }, blocked.map(showTaskRow))
              : h('div', { className: 'dw-panel-empty' }, '没有受阻任务')),
          stale.length ? h('section', { className: 'dw-panel dw-panel-stale' },
            h(SectionHead, { icon: 'clock', title: t('stale'), count: stale.length }),
            h('div', { className: 'dw-panel-body' }, stale.slice(0, 6).map(showTaskRow))) : null));
    }

    /* ---------------- 列表 ---------------- */
    function ListView(props) {
      const data = props.data;
      const [query, setQuery] = useState('');
      const [typeF, setTypeF] = useState('');
      const [statusF, setStatusF] = useState('');
      const [priorityF, setPriorityF] = useState('');
      const tasks = filterTasksByProject(data.tasks, props.projectFilter);
      const rows = sortTasks(tasks.filter((task) => {
        if (typeF && task.type !== typeF) return false;
        if (statusF && task.status !== statusF) return false;
        if (priorityF && task.priority !== priorityF) return false;
        if (query) {
          const hay = (task.title + ' ' + toArray(task.tags).join(' ') + ' ' + task.description).toLowerCase();
          if (hay.indexOf(query.toLowerCase()) < 0) return false;
        }
        return true;
      }));
      const sel = (value, onChange, options, label) => h('select', { className: 'dw-select', value: value, 'aria-label': label, onChange: (e) => onChange(e.target.value) },
        h('option', { value: '' }, label + '：' + t('all')),
        options.map((o) => h('option', { key: o.key, value: o.key }, o.label)));
      return h('div', { className: 'dw-list' },
        h('div', { className: 'dw-toolbar' },
          h('label', { className: 'dw-search' }, h(Icon, { name: 'search', size: 14 }),
            h('input', { type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'), onChange: (e) => setQuery(e.target.value) })),
          h('div', { className: 'dw-toolbar-right' },
            sel(typeF, setTypeF, TYPES, t('filterType')),
            sel(statusF, setStatusF, STATUS.concat([CANCELED]), t('filterStatus')),
            sel(priorityF, setPriorityF, PRIORITIES, t('filterPriority')),
            h('span', { className: 'dw-count-note' }, rows.length + ' 项'))),
        rows.length ? h('div', { className: 'dw-table-wrap' },
          h('table', { className: 'dw-table' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, ''),
              h('th', { scope: 'col' }, t('title')),
              h('th', { scope: 'col' }, t('type')),
              h('th', { scope: 'col' }, t('project')),
              h('th', { scope: 'col' }, t('priority')),
              h('th', { scope: 'col' }, t('owner')),
              h('th', { scope: 'col' }, t('due')),
              h('th', { scope: 'col' }, t('progress')),
              h('th', { scope: 'col' }, t('updatedAt')))),
            h('tbody', null, rows.map((task) => {
              const tags = toArray(task.tags);
              return h('tr', {
                key: task.id, className: 'dw-row' + (task.status === 'done' ? ' done' : ''), tabIndex: 0,
                onClick: () => props.onOpen(task),
                onKeyDown: (e) => { if (e.key === 'Enter') props.onOpen(task); },
              },
                h('td', null, h('span', { className: 'dw-statusdot', style: { background: statusOf(task.status).color }, title: statusOf(task.status).label })),
                h('td', null,
                  h('div', { className: 'dw-row-title' }, task.title),
                  tags.length ? h('div', { className: 'dw-row-tags' }, tags.slice(0, 3).map((tag) => h('span', { key: tag, className: 'dw-tag' }, tag))) : null),
                h('td', null, h(TypeTag, { type: task.type })),
                h('td', null, h(ProjectTag, { project: projectOfTask(data.projects, task) })),
                h('td', null, h(PriorityTag, { priority: task.priority })),
                h('td', null, task.owner ? h('span', { className: 'dw-owner' }, task.owner) : '—'),
                h('td', null, task.due ? h('span', { className: 'dw-due dw-due-' + (dueToneOf(task) || 'normal') }, dueLabelOf(task)) : '—'),
                h('td', null, h('span', { className: 'dw-row-progress' }, h(Bar, { value: pct(task) }), h('span', null, pct(task) + '%'))),
                h('td', null, h('span', { className: 'dw-muted' }, relTime(task.updatedAt))));
            }))))
          : h('div', { className: 'dw-empty-simple' }, h(Empty, { title: '没有匹配的任务', desc: '换个筛选条件，或新建一个任务。' }, h(Btn, { kind: 'primary', onClick: props.onCreate, icon: 'plus' }, t('newTask')))));
    }

    /* ---------------- 活动 ---------------- */
    function ActivityView(props) {
      const data = props.data;
      const all = toArray(data.activity);
      const taskById = (id) => toArray(data.tasks).find((x) => x.id === id);
      const list = all.filter((item) => {
        if (!props.projectFilter) return true;
        const tk = item.taskId ? taskById(item.taskId) : null;
        return !!(tk && tk.projectId === props.projectFilter);
      }).slice().reverse();
      const groups = [];
      let cur = null;
      list.forEach((item) => {
        const key = dayKey(item.at);
        if (!cur || cur.key !== key) { cur = { key: key, items: [] }; groups.push(cur); }
        cur.items.push(item);
      });
      const byIcon = (by) => by === 'agent' ? 'sparkles' : by === 'system' ? 'gear' : 'user';
      const taskTitle = (id) => { const x = toArray(data.tasks).find((y) => y.id === id); return x ? x.title : ''; };
      return h('div', { className: 'dw-activity-view' },
        h('div', { className: 'dw-toolbar' },
          h('div', { className: 'dw-filter-chips' }, h('span', { className: 'dw-count-note' }, list.length + ' 条活动')),
          h('div', { className: 'dw-toolbar-right' },
            h(Btn, { small: true, icon: 'refresh', onClick: () => props.onRefresh() }, t('refresh')))),
        list.length ? groups.map((g) => h('section', { key: g.key, className: 'dw-day' },
          h('div', { className: 'dw-day-head' }, dayTitle(g.key), h('span', { className: 'dw-day-count' }, g.items.length)),
          h('div', { className: 'dw-timeline' }, g.items.map((item, i) => h('div', { key: g.key + i, className: 'dw-tl-item' },
            h('span', { className: 'dw-tl-dot dw-tl-' + (item.by || 'system') }, h(Icon, { name: byIcon(item.by), size: 11 })),
            h('div', { className: 'dw-tl-body' },
              h('div', { className: 'dw-tl-text' },
                item.taskId && taskTitle(item.taskId) ? h('button', { type: 'button', className: 'dw-linkish', onClick: () => props.onOpen(item.taskId) }, taskTitle(item.taskId)) : null,
                item.taskId && taskTitle(item.taskId) ? h('span', { className: 'dw-tl-sep' }, ' · ') : null,
                h('span', null, item.text || '')),
              h('div', { className: 'dw-tl-meta' }, timeOfDay(item.at), ' · ', item.by === 'agent' ? t('agent') : item.by === 'human' ? t('human') : t('system'))))))))
          : h('div', { className: 'dw-empty-simple' }, h(Empty, { title: t('noActivity'), desc: '任务一有变化就会出现在这里。' })));
    }

    /* ---------------- 任务抽屉 ---------------- */
    function TaskDrawer(props) {
      const task = props.task;
      const data = props.data;
      const [title, setTitle] = useState(task.title);
      const [desc, setDesc] = useState(task.description || '');
      const [newItem, setNewItem] = useState('');
      const [artLabel, setArtLabel] = useState('');
      const [artPath, setArtPath] = useState('');
      const [blockedReason, setBlockedReason] = useState(task.blockedReason || '');
      const [confirm, setConfirm] = useState('');
      const firstRef = useRef(null);
      const taskId = task.id;

      useEffect(() => { setTitle(task.title); setDesc(task.description || ''); setBlockedReason(task.blockedReason || ''); setConfirm(''); }, [taskId]);
      useEffect(() => { if (firstRef.current) { try { firstRef.current.focus(); } catch (e) { /* ignore */ } } }, [taskId]);

      const patch = (p) => props.onUpdate(task.id, p);
      const movement = moveTargets(task.status);
      const attention = toArray(data.attention).filter((x) => x.status !== 'resolved' && x.target && x.target.kind === 'task' && x.target.id === task.id);
      const logs = toArray(data.activity).filter((x) => x.taskId === task.id).slice().reverse();
      const ty = typeOf(task.type);

      const saveTitle = () => {
        const v = String(title || '').trim();
        if (!v) { setTitle(task.title); return; }
        if (v !== task.title) patch({ title: v });
      };
      const saveDesc = () => { if ((desc || '') !== (task.description || '')) patch({ description: desc }); };
      const toggleItem = (id) => {
        const next = toArray(task.checklist).map((c) => c.id === id ? { id: c.id, text: c.text, done: !c.done } : c);
        patch({ checklist: next });
      };
      const addItem = () => {
        const text = String(newItem || '').trim();
        if (!text) return;
        const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        patch({ checklist: toArray(task.checklist).concat([{ id: id, text: text, done: false }]) });
        setNewItem('');
      };
      const addArtifact = () => {
        const label = String(artLabel || '').trim();
        const path = String(artPath || '').trim();
        if (!label && !path) return;
        patch({ artifacts: toArray(task.artifacts).concat([{ label: label || path, path: path }]) });
        setArtLabel(''); setArtPath('');
      };
      const removeArtifact = (idx) => patch({ artifacts: toArray(task.artifacts).filter((_, i) => i !== idx) });
      const doMove = (target) => {
        if (target === 'done') {
          setConfirm('done');
          return;
        }
        if (target === 'blocked' && !String(blockedReason || '').trim()) {
          setBlockedReason(task.blockedReason || '');
        }
        props.onMove(task.id, target, target === 'blocked' ? blockedReason : '');
      };
      const confirmDone = () => { setConfirm(''); props.onMove(task.id, 'done'); };
      const confirmDelete = () => { setConfirm(''); props.onDelete(task.id); };

      return h('div', { className: 'dw-drawer-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': task.title },
        h('div', { className: 'dw-scrim', onClick: props.onClose }),
        h('aside', { className: 'dw-drawer' },
          h('header', { className: 'dw-drawer-head' },
            h('div', { className: 'dw-drawer-id' },
              h(TypeTag, { type: task.type }),
              h('span', { className: 'dw-id' }, task.id),
              h('span', { className: 'dw-status-pill', style: { '--dw-status-color': statusOf(task.status).color } },
                h('span', { className: 'dw-statusdot', style: { background: statusOf(task.status).color } }), statusOf(task.status).label)),
            h('div', { className: 'dw-drawer-head-actions' },
              h(IconBtn, { name: 'x', title: t('close'), onClick: props.onClose }))),
          h('div', { className: 'dw-drawer-body' },
            h('input', {
              ref: firstRef, className: 'dw-title-input', value: title, 'aria-label': t('title'),
              onChange: (e) => setTitle(e.target.value), onBlur: saveTitle,
              onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } },
            }),
            h('div', { className: 'dw-props' },
              h('label', { className: 'dw-prop' }, h('span', null, t('project')),
                h('select', { value: task.projectId || '', onChange: (e) => patch({ projectId: e.target.value }) },
                  h('option', { value: '' }, t('unassigned')),
                  toArray(data.projects).map((p) => h('option', { key: p.id, value: p.id }, p.name)))),
              h('label', { className: 'dw-prop' }, h('span', null, t('type')),
                h('select', { value: task.type, onChange: (e) => patch({ type: e.target.value }) }, TYPES.map((x) => h('option', { key: x.key, value: x.key }, x.label)))),
              h('label', { className: 'dw-prop' }, h('span', null, t('status')),
                h('select', { value: task.status, onChange: (e) => doMove(e.target.value) },
                  h('option', { value: task.status }, STATUS_LABEL[task.status]),
                  movement.map((s) => h('option', { key: s.key, value: s.key }, s.label)))),
              h('label', { className: 'dw-prop' }, h('span', null, t('priority')),
                h('select', { value: task.priority, onChange: (e) => patch({ priority: e.target.value }) }, PRIORITIES.map((x) => h('option', { key: x.key, value: x.key }, x.label)))),
              h('label', { className: 'dw-prop' }, h('span', null, t('owner')),
                h('input', { type: 'text', defaultValue: task.owner || '', placeholder: '—', onBlur: (e) => { if (e.target.value !== (task.owner || '')) patch({ owner: e.target.value }); } })),
              h('label', { className: 'dw-prop' }, h('span', null, t('due')),
                h('input', { type: 'date', value: task.due || '', onChange: (e) => patch({ due: e.target.value }) })),
              h('label', { className: 'dw-prop' }, h('span', null, t('estimate')),
                h('input', { type: 'number', min: 0, step: 0.5, value: task.estimate || 0, onChange: (e) => patch({ estimate: Number(e.target.value) }) })),
              h('label', { className: 'dw-prop' }, h('span', null, t('spent')),
                h('input', { type: 'number', min: 0, step: 0.5, value: task.spent || 0, onChange: (e) => patch({ spent: Number(e.target.value) }) })),
            ),
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, '标签 · 逗号分隔'),
              h('input', {
                type: 'text', defaultValue: toArray(task.tags).join(', '), placeholder: '如：登录, v0.1',
                onBlur: (e) => {
                  const next = String(e.target.value || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
                  if (next.join('|') !== toArray(task.tags).join('|')) patch({ tags: next });
                },
              })),
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('progress') + ' · ' + pct(task) + '%'),
              h('input', { type: 'range', min: 0, max: 100, step: 5, value: pct(task), onChange: (e) => patch({ progress: Number(e.target.value) }) })),
            task.status === 'blocked' || task.blockedReason ? h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('blockedReason')),
              h('textarea', { rows: 2, defaultValue: blockedReason, onBlur: (e) => { const v = e.target.value; setBlockedReason(v); if (v !== (task.blockedReason || '')) patch({ blockedReason: v }); } })) : null,
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('desc') + ' · ' + t('descHint')),
              h('textarea', { rows: 3, value: desc, onChange: (e) => setDesc(e.target.value), onBlur: saveDesc })),
            attention.length ? h('div', { className: 'dw-drawer-attn' },
              attention.map((item, i) => h(AttentionCard, {
                key: item.id || i, item: item, pushToast: props.pushToast, onResolve: props.onResolveAttention,
                onOpen: () => {}, taskTitle: '',
              }))) : null,
            h('div', { className: 'dw-field' },
              h('div', { className: 'dw-field-label' }, t('checklist') + ' · ' + checklistDone(task) + '/' + toArray(task.checklist).length),
              h('div', { className: 'dw-checklist' },
                toArray(task.checklist).map((c) => h('label', { key: c.id, className: 'dw-check' + (c.done ? ' done' : '') },
                  h('input', { type: 'checkbox', checked: !!c.done, onChange: () => toggleItem(c.id) }),
                  h('span', null, c.text))),
                h('div', { className: 'dw-check-add' },
                  h('input', {
                    type: 'text', value: newItem, placeholder: t('addItem'), 'aria-label': t('addItem'),
                    onChange: (e) => setNewItem(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } },
                  }),
                  h(IconBtn, { name: 'plus', title: t('addItem'), onClick: addItem })))),
            h('div', { className: 'dw-field' },
              h('div', { className: 'dw-field-label' }, t('artifacts')),
              toArray(task.artifacts).length ? h('div', { className: 'dw-artifacts' },
                toArray(task.artifacts).map((a, i) => h('div', { key: i, className: 'dw-artifact' },
                  h(Icon, { name: 'file', size: 13 }),
                  h('span', { className: 'dw-artifact-label' }, a.label || a.path),
                  a.path ? h('code', { className: 'dw-artifact-path' }, a.path) : null,
                  h(IconBtn, { name: 'x', title: '移除', size: 13, onClick: () => removeArtifact(i) }))) ) : null,
              h('div', { className: 'dw-artifact-add' },
                h('input', { type: 'text', value: artLabel, placeholder: t('label'), 'aria-label': t('label'), onChange: (e) => setArtLabel(e.target.value) }),
                h('input', { type: 'text', value: artPath, placeholder: t('path'), 'aria-label': t('path'), onChange: (e) => setArtPath(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addArtifact(); } } }),
                h(Btn, { small: true, onClick: addArtifact, icon: 'plus' }, t('addArtifact')))),
            h('div', { className: 'dw-field' },
              h('div', { className: 'dw-field-label' }, t('log')),
              logs.length ? h('div', { className: 'dw-tasklog' }, logs.slice(0, 12).map((x, i) => h('div', { key: i, className: 'dw-tasklog-item' },
                h('span', { className: 'dw-tl-dot dw-tl-' + (x.by || 'system') }, h(Icon, { name: x.by === 'agent' ? 'sparkles' : x.by === 'human' ? 'user' : 'gear', size: 10 })),
                h('span', null, x.text || ''), h('span', { className: 'dw-muted' }, ' · ' + timeOfDay(x.at))))) : h('div', { className: 'dw-muted' }, t('noActivity')))),
          h('footer', { className: 'dw-drawer-foot' },
            h('div', { className: 'dw-handoff' },
              h(Btn, { small: true, icon: 'sparkles', onClick: () => props.onHandoff(task, 'work') }, t('handoffWork')),
              h(Btn, { small: true, icon: 'search', onClick: () => props.onHandoff(task, 'review') }, t('handoffReview')),
              h(Btn, { small: true, icon: 'bolt', onClick: () => props.onHandoff(task, 'plan') }, t('handoffPlan'))),
            h('div', { className: 'dw-drawer-danger' },
              h('button', { type: 'button', className: 'dw-danger-btn', onClick: () => setConfirm('delete') },
                h(Icon, { name: 'trash', size: 14 }), t('del'))))),
        confirm === 'done' ? h('div', { className: 'dw-confirm', role: 'alertdialog', 'aria-label': t('confirmDone') },
          h('div', { className: 'dw-confirm-text' }, t('confirmDone')),
          h('div', { className: 'dw-confirm-actions' },
            h(Btn, { small: true, onClick: () => setConfirm('') }, '取消'),
            h(Btn, { small: true, kind: 'primary', onClick: confirmDone }, t('approve')))) : null,
        confirm === 'delete' ? h('div', { className: 'dw-confirm', role: 'alertdialog', 'aria-label': t('confirmDelete') },
          h('div', { className: 'dw-confirm-text' }, t('confirmDelete') + '「' + task.title + '」？'),
          h('div', { className: 'dw-confirm-actions' },
            h(Btn, { small: true, onClick: () => setConfirm('') }, '取消'),
            h(Btn, { small: true, kind: 'danger', onClick: confirmDelete }, t('del')))) : null
      );
    }

    /* ---------------- 新建任务 ---------------- */
    function CreateDialog(props) {
      const defaults = props.defaults || {};
      const projects = toArray(props.projects);
      const [title, setTitle] = useState('');
      const [type, setType] = useState('dev');
      const [priority, setPriority] = useState('P2');
      const [due, setDue] = useState('');
      const [estimate, setEstimate] = useState('');
      const [owner, setOwner] = useState(defaults.owner || '我');
      const [projectId, setProjectId] = useState(defaults.projectId || '');
      const [desc, setDesc] = useState('');
      const [busy, setBusy] = useState(false);
      const ref = useRef(null);
      useEffect(() => { if (ref.current) { try { ref.current.focus(); } catch (e) { /* ignore */ } } }, []);
      const submit = async () => {
        const v = title.trim();
        if (!v) return;
        setBusy(true);
        const r = await props.onCreate({
          title: v, type: type, priority: priority, due: due || '',
          estimate: estimate ? Number(estimate) : 0, owner: owner, description: desc,
          projectId: projectId || '',
        });
        setBusy(false);
        if (r && r.ok) props.onClose();
      };
      return h('div', { className: 'dw-modal-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('newTask') },
        h('div', { className: 'dw-scrim', onClick: props.onClose }),
        h('div', { className: 'dw-modal' },
          h('header', { className: 'dw-modal-head' },
            h('span', { className: 'dw-modal-title' }, t('newTask')),
            h(IconBtn, { name: 'x', title: t('close'), onClick: props.onClose })),
          h('div', { className: 'dw-modal-body' },
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('title')),
              h('input', { ref: ref, type: 'text', value: title, placeholder: '例如：登录页空状态设计', onChange: (e) => setTitle(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); } })),
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('project')),
              h('select', { value: projectId, onChange: (e) => setProjectId(e.target.value) },
                h('option', { value: '' }, t('unassigned')),
                projects.map((p) => h('option', { key: p.id, value: p.id }, p.name)))),
            h('div', { className: 'dw-modal-grid' },
              h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('type')),
                h('select', { value: type, onChange: (e) => setType(e.target.value) }, TYPES.map((x) => h('option', { key: x.key, value: x.key }, x.label)))),
              h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('priority')),
                h('select', { value: priority, onChange: (e) => setPriority(e.target.value) }, PRIORITIES.map((x) => h('option', { key: x.key, value: x.key }, x.label)))),
              h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('due')),
                h('input', { type: 'date', value: due, onChange: (e) => setDue(e.target.value) })),
              h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('estimate')),
                h('input', { type: 'number', min: 0, step: 0.5, value: estimate, placeholder: '4', onChange: (e) => setEstimate(e.target.value) })),
              h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('owner')),
                h('input', { type: 'text', value: owner, onChange: (e) => setOwner(e.target.value) }))),
            h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('desc')),
              h('textarea', { rows: 3, value: desc, onChange: (e) => setDesc(e.target.value) }))),
          h('footer', { className: 'dw-modal-foot' },
            h('span', { className: 'dw-muted' }, '⌘/Ctrl + Enter'),
            h('div', { className: 'dw-modal-actions' },
              h(Btn, { onClick: props.onClose }, '取消'),
              h(Btn, { kind: 'primary', onClick: submit, disabled: busy || !title.trim(), icon: 'plus' }, t('newTask'))))));
    }

    /* ---------------- 设置 ---------------- */
    function SettingsPopover(props) {
      const s = props.settings || {};
      const [wip, setWip] = useState(String(s.wipLimit || 3));
      const [stale, setStale] = useState(String(s.staleDays || 3));
      const [showCanceled, setShowCanceled] = useState(!!s.showCanceled);
      const [autonomy, setAutonomy] = useState(s.autonomy || 'observe');
      const ref = useRef(null);
      useEffect(() => {
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) props.onClose(); };
        const onKey = (e) => { if (e.key === 'Escape') props.onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
      }, [props]);
      const save = () => props.onSave({
        wipLimit: clamp(parseInt(wip, 10) || 3, 1, 20),
        staleDays: clamp(parseInt(stale, 10) || 3, 1, 60),
        showCanceled: !!showCanceled,
        autonomy: autonomy,
      });
      return h('div', { className: 'dw-pop', ref: ref, role: 'dialog', 'aria-label': t('settingsTitle') },
        h('div', { className: 'dw-pop-title' }, t('settingsTitle')),
        h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('wipLimit')),
          h('input', { type: 'number', min: 1, max: 20, value: wip, onChange: (e) => setWip(e.target.value) })),
        h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('staleDays')),
          h('input', { type: 'number', min: 1, max: 60, value: stale, onChange: (e) => setStale(e.target.value) })),
        h('label', { className: 'dw-field' }, h('span', { className: 'dw-field-label' }, t('autonomy')),
          h('select', { value: autonomy, onChange: (e) => setAutonomy(e.target.value) },
            h('option', { value: 'observe' }, 'observe · 只建议'),
            h('option', { value: 'assisted' }, 'assisted · 安全动作'),
            h('option', { value: 'auto' }, 'auto · 自动安全动作'))),
        h('label', { className: 'dw-switch-row' },
          h('input', { type: 'checkbox', checked: showCanceled, onChange: (e) => setShowCanceled(e.target.checked) }),
          h('span', null, t('showCanceled'))),
        h('div', { className: 'dw-pop-root' }, h(Icon, { name: 'kanban', size: 13 }), h('code', null, props.root || '')),
        h('div', { className: 'dw-pop-actions' }, h(Btn, { small: true, kind: 'primary', onClick: save }, t('save'))));
    }

    /* ---------------- 主应用 ---------------- */
    function Workbench(props) {
      const actions = (props && props.actions) || {};
      const wb = useWorkbench();
      const data = wb.data;
      const [view, setView] = useState('today');
      const [openId, setOpenId] = useState('');
      const [createOpen, setCreateOpen] = useState(false);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [projectFilter, setProjectFilterState] = useState(readStoredProject);
      const [projectDialog, setProjectDialog] = useState(null);
      const now = useNow(TICK_MS);
      const setProjectFilter = useCallback((id) => { setProjectFilterState(id || ''); storeProject(id || ''); }, []);

      /* 项目被删除/未加载时回退到「全部项目」 */
      useEffect(() => {
        if (!data || !projectFilter) return;
        if (!projectById(data.projects, projectFilter)) setProjectFilter('');
      }, [data, projectFilter, setProjectFilter]);

      const openTask = data && openId ? toArray(data.tasks).find((x) => x.id === openId) : null;

      useEffect(() => {
        const onKey = (e) => {
          const tag = String((e.target && e.target.tagName) || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key === 'Escape') { setCreateOpen(false); setSettingsOpen(false); setOpenId(''); }
          else if (e.key === 'n') { e.preventDefault(); setCreateOpen(true); }
          else if (e.key === '1') setView('today');
          else if (e.key === '2') setView('board');
          else if (e.key === '3') setView('list');
          else if (e.key === '4') setView('projects');
          else if (e.key === '5') setView('activity');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);

      const createTask = useCallback(async (payload) => {
        const r = await wb.send('/task/create', payload, { toast: t('created') });
        if (r.ok && r.task) { setOpenId(r.task.id); }
        return r;
      }, [wb]);
      const updateTask = useCallback(async (id, patch) => wb.send('/task/update', { id: id, patch: patch }, { toast: t('updated') }), [wb]);
      const moveTask = useCallback(async (id, status, note) => {
        if (status === 'done' && !(typeof window !== 'undefined' && window.confirm(t('confirmDone')))) return { ok: false, reason: 'canceled' };
        return wb.send('/task/move', { id: id, status: status, note: note || '' }, { toast: t('moved') });
      }, [wb]);
      const deleteTask = useCallback(async (id) => {
        const r = await wb.send('/task/delete', { id: id }, { toast: t('deleted') });
        if (r.ok) setOpenId('');
        return r;
      }, [wb]);
      const resolveAttention = useCallback((id, answer) => wb.send('/attention/resolve', { id: id, answer: answer }, { toast: t('answered') }), [wb]);
      const handoff = useCallback(async (task, mode) => {
        const r = await wb.send('/handoff', { taskId: task.id, mode: mode });
        if (r.ok && r.sessionId && actions.openSession) {
          try { actions.openSession(r.sessionId); } catch (e) { /* ignore */ }
          wb.pushToast('已发起会话 ' + String(r.sessionId).slice(0, 12), 'ok');
        } else if (!r.ok) {
          wb.pushToast(r.reason || t('handoffFail'), 'error');
        }
        return r;
      }, [wb, actions]);
      const saveSettings = useCallback(async (patch) => {
        await wb.send('/settings/update', { patch: patch }, { toast: t('saveOk') });
        setSettingsOpen(false);
      }, [wb]);
      const saveProject = useCallback(async (payload, mode) => {
        const r = mode === 'edit'
          ? await wb.send('/project/update', payload, { toast: t('projectUpdated') })
          : await wb.send('/project/create', payload, { toast: t('projectCreated') });
        if (r && r.ok && r.project) setProjectFilter(r.project.id);
        return r;
      }, [wb, setProjectFilter]);
      const deleteProject = useCallback(async (id, moveTo) => {
        const body = { id: id };
        if (moveTo !== undefined && moveTo !== null) body.moveTo = moveTo;
        const r = await wb.send('/project/delete', body, { toast: t('projectDeleted') });
        if (r && r.ok && projectFilter === id) setProjectFilter('');
        return r;
      }, [wb, setProjectFilter, projectFilter]);
      const loadDemo = useCallback(async () => {
        const projects = toArray(data && data.projects);
        const sample = [
          { project: '登录改版', title: '梳理「任务详情」信息架构', type: 'product', priority: 'P1', due: localToday(), estimate: 3, description: '列出字段、分组、空态与错误态；输出一页结构图。' },
          { project: '登录改版', title: '任务卡与看板视觉稿', type: 'design', priority: 'P1', due: localToday(), estimate: 4, description: '五个状态列的卡片样式，含进行中进度与受阻标识。' },
          { project: '账号体系', title: '实现实时同步（SSE + 轮询兜底）', type: 'dev', priority: 'P0', due: localToday(), estimate: 6, description: 'EventSource 断开自动降级；服务端 mutation 后广播 rev。' },
        ];
        const ids = {};
        for (const smp of sample) {
          let pid = ids[smp.project];
          if (!pid) {
            const found = projects.find((p) => p.name === smp.project);
            if (found) pid = found.id;
            else {
              const cr = await wb.send('/project/create', { name: smp.project, color: PROJECT_COLORS[Object.keys(ids).length % PROJECT_COLORS.length] });
              pid = cr && cr.project ? cr.project.id : '';
            }
            ids[smp.project] = pid;
          }
          await wb.send('/task/create', { ...smp, project: undefined, projectId: pid });
        }
        wb.pushToast(t('exampleLoaded'), 'ok');
      }, [wb, data]);

      const tabs = [
        { key: 'today', label: t('today'), icon: 'target' },
        { key: 'board', label: t('board'), icon: 'kanban' },
        { key: 'list', label: t('list'), icon: 'list' },
        { key: 'projects', label: t('projects'), icon: 'folder' },
        { key: 'activity', label: t('activity'), icon: 'activity' },
      ];
      const attentionCount = data ? toArray(data.attention).filter((x) => x.status !== 'resolved').length : 0;

      const header = h('header', { className: 'dw-head' },
        h('div', { className: 'dw-brand' },
          h('span', { className: 'dw-brand-mark', 'aria-hidden': 'true' }, h(Icon, { name: 'kanban', size: 17 })),
          h('div', { className: 'dw-brand-text' },
            h('span', { className: 'dw-brand-title' }, t('brand')),
            h('span', { className: 'dw-brand-sub' }, data && data.root ? data.root : t('tagline')))),
        data ? h(ProjectSwitcher, {
          projects: toArray(data.projects), value: projectFilter, onChange: setProjectFilter,
          onCreate: () => setProjectDialog({ mode: 'create', project: null }),
          onManage: () => setView('projects'),
        }) : null,
        h('nav', { className: 'dw-tabs', role: 'tablist', 'aria-label': t('brand') },
          tabs.map((tab) => h('button', {
            key: tab.key, type: 'button', role: 'tab', 'aria-selected': view === tab.key,
            className: 'dw-tab' + (view === tab.key ? ' on' : ''), onClick: () => setView(tab.key),
          }, h(Icon, { name: tab.icon, size: 14 }), tab.label,
            tab.key === 'today' && attentionCount ? h('span', { className: 'dw-tab-badge' }, attentionCount) : null))),
        h('div', { className: 'dw-head-right' },
          h(LiveBadge, { live: wb.live, lastSync: wb.lastSync }),
          h(IconBtn, { name: 'refresh', title: t('refresh'), onClick: () => wb.refresh(false) }),
          h('div', { className: 'dw-settings-wrap' },
            h(IconBtn, { name: 'gear', title: t('settings'), active: settingsOpen, onClick: () => setSettingsOpen(!settingsOpen) }),
            settingsOpen && data ? h(SettingsPopover, { settings: data.settings, root: data.root, onClose: () => setSettingsOpen(false), onSave: saveSettings }) : null),
          h(Btn, { kind: 'primary', small: true, icon: 'plus', onClick: () => setCreateOpen(true) }, t('newTask'))));

      let body = null;
      if (!data) {
        body = h('div', { className: 'dw-center' },
          wb.err ? h('div', { className: 'dw-error-card' },
            h('div', { className: 'dw-error-title' }, h(Icon, { name: 'alert', size: 16 }), t('loadFail')),
            h('div', { className: 'dw-error-desc' }, wb.err),
            h('div', { className: 'dw-error-hint' }, t('retryHint')),
            h(Btn, { kind: 'primary', icon: 'refresh', onClick: () => wb.refresh(false) }, t('retry')))
            : h('div', { className: 'dw-loading' }, h(Spinner, null), h('span', null, t('loading'))));
      } else if (!toArray(data.tasks).length && view !== 'projects' && !projectFilter) {
        body = h('div', { className: 'dw-center' }, h(Empty, {
          title: t('noTasks'), desc: t('noTasksHint'),
        }, h(Btn, { kind: 'primary', icon: 'plus', onClick: () => setCreateOpen(true) }, t('newTask')),
          h(Btn, { icon: 'sparkles', onClick: loadDemo }, t('loadDemo'))));
      } else if (view === 'today') {
        body = h(TodayView, { data: data, now: now, projectFilter: projectFilter, onGo: setView, onOpen: (task) => setOpenId(task.id), onMove: moveTask, pushToast: wb.pushToast, onResolveAttention: resolveAttention });
      } else if (view === 'board') {
        body = h(BoardView, { data: data, now: now, projectFilter: projectFilter, onOpen: (task) => setOpenId(task.id), onMove: moveTask, pushToast: wb.pushToast });
      } else if (view === 'list') {
        body = h(ListView, { data: data, projectFilter: projectFilter, onOpen: (task) => setOpenId(task.id), onCreate: () => setCreateOpen(true) });
      } else if (view === 'projects') {
        body = h(ProjectsView, {
          data: data, projectFilter: projectFilter,
          onFilter: setProjectFilter,
          onOpenProject: (id) => { setProjectFilter(id); setView('board'); },
          onCreateProject: () => setProjectDialog({ mode: 'create', project: null }),
          onEditProject: (p) => setProjectDialog({ mode: 'edit', project: p }),
          onDeleteProject: deleteProject,
        });
      } else {
        body = h(ActivityView, { data: data, projectFilter: projectFilter, onOpen: (id) => setOpenId(id), onRefresh: () => wb.refresh(false) });
      }

      return h('div', { className: 'dw-root' },
        header,
        wb.err && data ? h('div', { className: 'dw-banner', role: 'status' }, h(Icon, { name: 'alert', size: 14 }), wb.err,
          h('button', { type: 'button', className: 'dw-linkish', onClick: () => wb.refresh(false) }, t('retry'))) : null,
        h('main', { className: 'dw-main' }, body),
        openTask ? h(TaskDrawer, {
          task: openTask, data: data, pushToast: wb.pushToast,
          onClose: () => setOpenId(''), onUpdate: updateTask, onMove: moveTask, onDelete: deleteTask,
          onHandoff: handoff, onResolveAttention: resolveAttention,
        }) : null,
        createOpen ? h(CreateDialog, {
          onCreate: createTask, onClose: () => setCreateOpen(false),
          projects: data ? data.projects : [],
          defaults: {
            owner: (data && data.settings && data.settings.owner) || '我',
            projectId: projectFilter || ((toArray(data && data.projects)[0] || {}).id || ''),
          },
        }) : null,
        projectDialog ? h(ProjectDialog, {
          mode: projectDialog.mode, project: projectDialog.project,
          onSave: saveProject, onDelete: deleteProject, pushToast: wb.pushToast,
          onClose: () => setProjectDialog(null),
        }) : null,
        h(ToastStack, { toasts: wb.toasts }));
    }

    /* ---------------- 样式 ---------------- */
    const CSS = `
.dw-root{
  position:relative;
  --dw-bg:var(--dsw-alias-bg-base,transparent);
  --dw-surface:var(--dsw-alias-bg-layer-1,#fff);
  --dw-surface-2:var(--dsw-alias-bg-layer-2,#f5f6f7);
  --dw-surface-3:var(--dsw-alias-bg-layer-3,#ebeef2);
  --dw-border:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  --dw-border-2:var(--dsw-alias-border-l2,rgba(0,0,0,.14));
  --dw-text:var(--dsw-alias-label-primary,#1f2329);
  --dw-text-2:var(--dsw-alias-label-secondary,#646a73);
  --dw-text-3:var(--dsw-alias-label-tertiary,#8a9099);
  --dw-brand:var(--dsw-alias-brand-primary,#4d6bfe);
  --dw-on-brand:var(--dsw-alias-label-primary-inverted,#fff);
  --dw-accent:var(--dsw-alias-state-business-primary,#4d6bfe);
  --dw-danger:var(--dsw-alias-state-error-primary,#d92d20);
  --dw-warn:var(--dsw-alias-state-warn-primary,#e58b00);
  --dw-success:var(--dsw-alias-state-success-primary,#1a7f45);
  --dw-idle:var(--dsw-alias-state-idle-primary,#cfd3d6);
  --dw-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));
  --dw-active:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.07));
  --dw-focus:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 34%,transparent);
  --dw-radius:var(--dsw-radius-md,12px);
  --dw-radius-sm:var(--dsw-radius-sm,8px);
  --dw-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;
  background:var(--dw-bg);color:var(--dw-text);
  font-size:var(--dsh-content-font-size,13px);line-height:1.55;
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}
.dw-root *{box-sizing:border-box}
.dw-root button{font-family:inherit}
.dw-root :focus-visible{outline:none;box-shadow:var(--dw-focus);border-radius:6px}
.dw-root ::-webkit-scrollbar{width:8px;height:8px}
.dw-root ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.12));border-radius:8px}
.dw-root ::-webkit-scrollbar-track{background:transparent}
.dw-root input,.dw-root textarea,.dw-root select{font-family:inherit;font-size:inherit;color:var(--dw-text)}

/* header */
.dw-head{display:flex;align-items:center;gap:14px;flex:0 0 auto;
  padding:calc(11px + var(--dsh-frame-top-clearance,0px)) 16px 10px calc(16px + var(--dsh-frame-leading-clearance,0px));
  border-bottom:1px solid var(--dw-border);position:relative;z-index:5}
.dw-head::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--dw-accent) 55%,transparent),transparent 42%);pointer-events:none}
.dw-brand{display:flex;align-items:center;gap:9px;min-width:0}
.dw-brand-mark{width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;
  color:var(--dw-brand);background:color-mix(in srgb,var(--dw-accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--dw-accent) 26%,transparent);flex:0 0 auto}
.dw-brand-text{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.dw-brand-title{font-size:14px;font-weight:650;letter-spacing:.2px}
.dw-brand-sub{font-size:11px;color:var(--dw-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
.dw-tabs{display:flex;align-items:center;gap:2px;padding:3px;border-radius:10px;background:var(--dw-surface-2);border:1px solid var(--dw-border)}
.dw-tab{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border:0;border-radius:8px;background:transparent;
  color:var(--dw-text-2);font-size:12.5px;font-weight:520;cursor:pointer;transition:background .16s ease,color .16s ease}
.dw-tab:hover{background:var(--dw-hover);color:var(--dw-text)}
.dw-tab.on{background:var(--dw-surface);color:var(--dw-text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dw-tab-badge{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--dw-danger);color:#fff;
  font-size:10px;font-weight:650;display:inline-flex;align-items:center;justify-content:center}
.dw-head-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto}
.dw-settings-wrap{position:relative}

/* buttons / chips */
.dw-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--dw-radius-sm);
  border:1px solid var(--dw-border-2);background:var(--dw-surface);color:var(--dw-text);font-size:12.5px;font-weight:540;cursor:pointer;
  transition:background .15s ease,border-color .15s ease,transform .12s ease;white-space:nowrap}
.dw-btn:hover{background:var(--dw-hover)}
.dw-btn:active{transform:translateY(.5px)}
.dw-btn:disabled{opacity:.45;cursor:not-allowed}
.dw-btn-sm{height:27px;padding:0 9px;font-size:12px;border-radius:7px}
.dw-btn-primary{background:var(--dw-brand);border-color:transparent;color:var(--dw-on-brand)}
.dw-btn-primary:hover{filter:brightness(1.06);background:var(--dw-brand)}
.dw-btn-danger{background:color-mix(in srgb,var(--dw-danger) 12%,transparent);border-color:color-mix(in srgb,var(--dw-danger) 40%,transparent);color:var(--dw-danger)}
.dw-btn-block{width:100%}
.dw-iconbtn{width:29px;height:29px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;
  border:1px solid transparent;background:transparent;color:var(--dw-text-2);cursor:pointer;transition:background .15s ease,color .15s ease}
.dw-iconbtn:hover{background:var(--dw-hover);color:var(--dw-text)}
.dw-iconbtn.on{background:color-mix(in srgb,var(--dw-accent) 12%,transparent);color:var(--dw-accent);border-color:color-mix(in srgb,var(--dw-accent) 30%,transparent)}
.dw-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;background:var(--dw-surface-2);
  color:var(--dw-text-2);font-size:11px;font-weight:540;white-space:nowrap;border:1px solid var(--dw-border)}
.dw-chip-color{background:color-mix(in srgb,var(--dw-chip) 12%,transparent);border-color:color-mix(in srgb,var(--dw-chip) 30%,transparent);color:var(--dw-chip)}
.dw-typetag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:560;color:var(--dw-text-2);white-space:nowrap}
.dw-typedot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 0%,transparent)}
.dw-prio{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;font-size:10.5px;font-weight:680;letter-spacing:.3px;
  color:var(--dw-prio);background:color-mix(in srgb,var(--dw-prio) 13%,transparent);border:1px solid color-mix(in srgb,var(--dw-prio) 32%,transparent)}
.dw-avatar{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  background:var(--dw-surface-3);color:var(--dw-text-2);font-size:10px;font-weight:650;flex:0 0 auto}
.dw-live{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dw-border);
  background:var(--dw-surface-2);color:var(--dw-text-2);font-size:11px;font-weight:560;white-space:nowrap}
.dw-live-dot{width:6px;height:6px;border-radius:50%;background:var(--dw-idle);flex:0 0 auto}
.dw-live-live{color:var(--dw-success);border-color:color-mix(in srgb,var(--dw-success) 34%,transparent);background:color-mix(in srgb,var(--dw-success) 9%,transparent)}
.dw-live-live .dw-live-dot{background:var(--dw-success);animation:dw-pulse 1.8s ease-in-out infinite}
.dw-live-poll{color:var(--dw-warn);border-color:color-mix(in srgb,var(--dw-warn) 32%,transparent);background:color-mix(in srgb,var(--dw-warn) 8%,transparent)}
.dw-live-poll .dw-live-dot{background:var(--dw-warn)}
.dw-live-offline{color:var(--dw-danger);border-color:color-mix(in srgb,var(--dw-danger) 32%,transparent);background:color-mix(in srgb,var(--dw-danger) 8%,transparent)}
.dw-live-offline .dw-live-dot{background:var(--dw-danger)}
@keyframes dw-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}

/* main */
.dw-main{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:14px 16px calc(20px + var(--dsh-frame-bottom-clearance,0px))}
.dw-today,.dw-list,.dw-activity-view,.dw-projects-view{flex:1 1 auto;min-height:0;overflow:auto}
.dw-board-view{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dw-banner{display:flex;align-items:center;gap:8px;margin:0 16px;padding:8px 12px;border-radius:8px;
  background:color-mix(in srgb,var(--dw-warn) 12%,transparent);color:var(--dw-warn);font-size:12px}
.dw-muted{color:var(--dw-text-3)}
.dw-linkish{border:0;background:none;padding:0;color:var(--dw-accent);cursor:pointer;font-size:inherit;text-decoration:none}
.dw-linkish:hover{text-decoration:underline}
.dw-count-note{font-size:12px;color:var(--dw-text-3)}
.dw-statusdot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto}
.dw-due{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dw-text-2);white-space:nowrap}
.dw-due-warn{color:var(--dw-warn)}
.dw-due-danger{color:var(--dw-danger)}
.dw-bar{display:block;height:4px;border-radius:99px;background:var(--dw-border);overflow:hidden;flex:1 1 auto}
.dw-bar-fill{display:block;height:100%;border-radius:99px;background:var(--dw-accent);transition:width .3s ease}
.dw-bar-danger .dw-bar-fill{background:var(--dw-danger)}
.dw-spinner{display:inline-flex;gap:4px;align-items:center}
.dw-spinner span{width:5px;height:5px;border-radius:50%;background:var(--dw-text-3);animation:dw-bounce 1s ease-in-out infinite}
.dw-spinner span:nth-child(2){animation-delay:.14s}
.dw-spinner span:nth-child(3){animation-delay:.28s}
@keyframes dw-bounce{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
.dw-center{height:100%;display:flex;align-items:center;justify-content:center;padding:28px}
.dw-loading{display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--dw-text-2);font-size:13px}

/* empty */
.dw-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:20px;max-width:460px}
.dw-empty-art{opacity:.9;margin-bottom:2px}
.dw-empty-title{font-size:15px;font-weight:640}
.dw-empty-desc{font-size:12.5px;color:var(--dw-text-2);line-height:1.7}
.dw-empty-actions{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;justify-content:center}
.dw-empty-simple{display:flex;align-items:center;justify-content:center;padding:32px 0}
.dw-error-card{max-width:460px;border:1px solid var(--dw-border);border-radius:var(--dw-radius);background:var(--dw-surface);padding:20px;display:flex;flex-direction:column;gap:8px}
.dw-error-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:640;color:var(--dw-danger)}
.dw-error-desc{font-size:12.5px;color:var(--dw-text-2)}
.dw-error-hint{font-size:12px;color:var(--dw-text-3)}
.dw-error-card .dw-btn{align-self:flex-start;margin-top:4px}

/* toolbar */
.dw-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.dw-toolbar-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dw-filter-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dw-filter{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:7px;border:1px solid var(--dw-border);
  background:transparent;color:var(--dw-text-2);font-size:12px;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease}
.dw-filter:hover{background:var(--dw-hover)}
.dw-filter.on{background:color-mix(in srgb,var(--dw-accent) 11%,transparent);border-color:color-mix(in srgb,var(--dw-accent) 34%,transparent);color:var(--dw-accent);font-weight:560}
.dw-search{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:8px;border:1px solid var(--dw-border);
  background:var(--dw-surface);color:var(--dw-text-3);min-width:190px}
.dw-search input{border:0;background:transparent;outline:none;width:100%;color:var(--dw-text);font-size:12px}
.dw-select{height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dw-border);background:var(--dw-surface);color:var(--dw-text-2);font-size:12px;cursor:pointer}
.dw-wip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:7px;background:var(--dw-surface-2);
  border:1px solid var(--dw-border);font-size:11.5px;color:var(--dw-text-2)}
.dw-wip.over{color:var(--dw-warn);border-color:color-mix(in srgb,var(--dw-warn) 40%,transparent);background:color-mix(in srgb,var(--dw-warn) 9%,transparent)}

/* stats */
.dw-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin-bottom:14px}
.dw-stat{display:flex;align-items:center;gap:9px;min-height:56px;padding:9px 12px;border-radius:var(--dw-radius);
  border:1px solid var(--dw-border);background:var(--dw-surface);text-align:left;color:var(--dw-text);cursor:default}
.dw-stat.clickable{cursor:pointer;transition:border-color .16s ease,transform .16s ease,background .16s ease}
.dw-stat.clickable:hover{border-color:var(--dw-border-2);background:var(--dw-surface-2);transform:translateY(-1px)}
.dw-stat-icon{width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;
  background:var(--dw-surface-2);color:var(--dw-text-2);flex:0 0 auto}
.dw-stat-text{display:flex;flex-direction:column;line-height:1.15;min-width:0}
.dw-stat-value{font-size:19px;font-weight:660;letter-spacing:-.2px;font-variant-numeric:tabular-nums}
.dw-stat-label{font-size:11.5px;color:var(--dw-text-2);white-space:nowrap}
.dw-stat-warn .dw-stat-icon{background:color-mix(in srgb,var(--dw-warn) 13%,transparent);color:var(--dw-warn)}
.dw-stat-warn .dw-stat-value{color:var(--dw-warn)}
.dw-stat-danger .dw-stat-icon{background:color-mix(in srgb,var(--dw-danger) 12%,transparent);color:var(--dw-danger)}
.dw-stat-danger .dw-stat-value{color:var(--dw-danger)}
.dw-stat-ring{flex-direction:column;justify-content:center;gap:2px;align-items:center;padding:6px}
.dw-stat-ring .dw-stat-label{text-align:center}
.dw-ring{position:relative;display:inline-flex;align-items:center;justify-content:center}
.dw-ring-text{position:absolute;font-size:10.5px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dw-text-2)}

/* today */
.dw-today{display:flex;flex-direction:column;gap:12px}
.dw-attn-wrap{display:flex;flex-direction:column;gap:8px}
.dw-attn{border:1px solid color-mix(in srgb,var(--dw-warn) 34%,transparent);border-left:3px solid var(--dw-warn);
  border-radius:var(--dw-radius-sm);background:color-mix(in srgb,var(--dw-warn) 7%,var(--dw-surface));padding:10px 12px}
.dw-attn-head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--dw-warn)}
.dw-attn-icon{display:inline-flex}
.dw-attn-link{border:0;background:none;padding:0;color:var(--dw-text);font-size:12px;text-decoration:underline;cursor:pointer}
.dw-attn-time{margin-left:auto;font-weight:400;font-size:11px;color:var(--dw-text-3)}
.dw-attn-q{margin:6px 0 8px;font-size:13px;color:var(--dw-text);line-height:1.6}
.dw-attn-form{display:flex;gap:8px}
.dw-attn-form input{flex:1 1 auto;height:30px;padding:0 10px;border-radius:7px;border:1px solid var(--dw-border-2);background:var(--dw-bg);color:var(--dw-text);font-size:12.5px;min-width:0}
.dw-sec-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dw-sec-title{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:620;color:var(--dw-text)}
.dw-sec-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--dw-surface-2);border:1px solid var(--dw-border);
  color:var(--dw-text-2);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.dw-sec-extra{margin-left:auto;font-size:11.5px;color:var(--dw-text-3)}
.dw-today-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.dw-panel{border:1px solid var(--dw-border);border-radius:var(--dw-radius);background:var(--dw-surface);padding:12px;display:flex;flex-direction:column;min-height:120px}
.dw-panel-body{display:flex;flex-direction:column;gap:8px}
.dw-panel-empty{display:flex;align-items:center;justify-content:center;flex:1;min-height:64px;color:var(--dw-text-3);font-size:12px}
.dw-panel-stale{border-style:dashed}

/* board */
.dw-board-view{display:flex;flex-direction:column;height:100%;min-height:0}
.dw-board{display:grid;grid-template-columns:repeat(5,minmax(200px,1fr));gap:10px;flex:1 1 auto;min-height:0;align-items:stretch}
.dw-col{display:flex;flex-direction:column;min-height:0;border:1px solid var(--dw-border);border-radius:var(--dw-radius);
  background:color-mix(in srgb,var(--dw-surface-2) 55%,transparent);transition:background .16s ease,border-color .16s ease}
.dw-col.over{background:color-mix(in srgb,var(--dw-accent) 8%,var(--dw-surface));border-color:color-mix(in srgb,var(--dw-accent) 45%,transparent)}
.dw-col-head{display:flex;align-items:center;gap:7px;padding:9px 10px 8px;flex:0 0 auto;border-bottom:1px solid var(--dw-border)}
.dw-col-bar{width:3px;height:13px;border-radius:2px;flex:0 0 auto}
.dw-col-name{font-size:12px;font-weight:620;color:var(--dw-text)}
.dw-col-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--dw-surface);border:1px solid var(--dw-border);
  color:var(--dw-text-2);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.dw-col-wip{margin-left:auto;width:42px;height:4px;border-radius:99px;background:var(--dw-border);overflow:hidden}
.dw-col-wip>span{display:block;height:100%;background:var(--dw-success);border-radius:99px}
.dw-col-wip.over>span{background:var(--dw-warn)}
.dw-col-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.dw-col-empty{display:flex;align-items:center;justify-content:center;min-height:56px;color:var(--dw-text-3);font-size:11.5px;
  border:1px dashed var(--dw-border);border-radius:var(--dw-radius-sm)}
.dw-board-hint{font-size:11px;color:var(--dw-text-3);padding-top:8px;text-align:center}

/* card */
.dw-card{position:relative;display:flex;flex-direction:column;gap:7px;padding:10px 11px 9px;border-radius:var(--dw-radius-sm);
  border:1px solid var(--dw-border);background:var(--dw-surface);cursor:pointer;
  transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease;border-left:2px solid var(--dw-type-color)}
.dw-card:hover{border-color:var(--dw-border-2);box-shadow:0 2px 8px rgba(0,0,0,.06);transform:translateY(-1px)}
.dw-card:focus-visible{box-shadow:var(--dw-focus)}
.dw-card.dragging{opacity:.45}
.dw-card.compact{padding:9px 10px}
.dw-card-top{display:flex;align-items:center;gap:6px;min-height:18px}
.dw-card-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.dw-card-menu-wrap{position:relative;margin-left:auto}
.dw-card-more{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;
  background:transparent;color:var(--dw-text-3);cursor:pointer;opacity:0;transition:opacity .15s ease,background .15s ease}
.dw-card:hover .dw-card-more,.dw-card-more[aria-expanded="true"]{opacity:1}
.dw-card-more:hover{background:var(--dw-hover);color:var(--dw-text)}
.dw-menu{position:absolute;right:0;top:24px;z-index:30;min-width:158px;padding:4px;border-radius:9px;
  border:1px solid var(--dw-border-2);background:var(--dsw-alias-bg-overlay,var(--dw-surface));box-shadow:0 10px 28px rgba(0,0,0,.18)}
.dw-menu-item{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;
  background:transparent;color:var(--dw-text);font-size:12px;text-align:left;cursor:pointer}
.dw-menu-item:hover{background:var(--dw-hover)}
.dw-menu-label{padding:5px 8px 3px;font-size:10.5px;color:var(--dw-text-3);letter-spacing:.3px}
.dw-menu-sep{height:1px;margin:4px 2px;background:var(--dw-border)}
.dw-card-title{margin:0;font-size:12.8px;font-weight:600;line-height:1.45;color:var(--dw-text);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dw-card-desc{margin:0;font-size:11.5px;line-height:1.55;color:var(--dw-text-2);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dw-card-sub{display:flex;gap:8px;align-items:center}
.dw-mini{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dw-text-3)}
.dw-card-progress{display:flex;align-items:center;gap:7px}
.dw-card-pct{font-size:10.5px;color:var(--dw-text-3);font-variant-numeric:tabular-nums}
.dw-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:1px}
.dw-card-meta{display:flex;align-items:center;gap:10px;min-width:0}
.dw-elapsed{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dw-success)}

/* list */
.dw-list{display:flex;flex-direction:column;gap:10px}
.dw-table-wrap{border:1px solid var(--dw-border);border-radius:var(--dw-radius);background:var(--dw-surface);overflow:auto}
.dw-table{width:100%;border-collapse:collapse;font-size:12px}
.dw-table th{position:sticky;top:0;z-index:1;text-align:left;font-size:11px;font-weight:600;color:var(--dw-text-3);
  padding:9px 10px;background:var(--dw-surface-2);border-bottom:1px solid var(--dw-border);white-space:nowrap}
.dw-table td{padding:9px 10px;border-bottom:1px solid var(--dw-border);vertical-align:middle;color:var(--dw-text)}
.dw-table tbody tr:last-child td{border-bottom:0}
.dw-row{cursor:pointer;transition:background .13s ease}
.dw-row:hover{background:var(--dw-hover)}
.dw-row.done .dw-row-title{color:var(--dw-text-3);text-decoration:line-through}
.dw-row-title{font-weight:540;line-height:1.4}
.dw-row-tags{display:flex;gap:4px;margin-top:3px;flex-wrap:wrap}
.dw-tag{font-size:10px;padding:0 5px;height:16px;line-height:16px;border-radius:4px;background:var(--dw-surface-2);color:var(--dw-text-3);border:1px solid var(--dw-border)}
.dw-owner{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dw-text-2)}
.dw-row-progress{display:inline-flex;align-items:center;gap:6px;min-width:86px;font-size:10.5px;color:var(--dw-text-3)}
.dw-row-progress .dw-bar{width:48px;flex:0 0 auto}

/* activity */
.dw-activity-view{display:flex;flex-direction:column;gap:10px;max-width:860px;padding-bottom:4px}
.dw-day{display:flex;flex-direction:column;gap:6px}
.dw-day-head{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:620;color:var(--dw-text-2);padding:2px 2px 4px}
.dw-day-count{font-weight:400;color:var(--dw-text-3);font-size:11px}
.dw-timeline{display:flex;flex-direction:column;gap:2px;border-left:1px solid var(--dw-border-2);margin-left:8px;padding-left:14px}
.dw-tl-item{display:flex;gap:10px;position:relative;padding:5px 0}
.dw-tl-dot{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
  margin-left:-22px;margin-top:1px;background:var(--dw-surface);border:1px solid var(--dw-border-2);color:var(--dw-text-2)}
.dw-tl-agent{color:var(--dw-accent);border-color:color-mix(in srgb,var(--dw-accent) 40%,transparent);background:color-mix(in srgb,var(--dw-accent) 9%,var(--dw-surface))}
.dw-tl-human{color:var(--dw-text);border-color:var(--dw-border-2)}
.dw-tl-body{min-width:0}
.dw-tl-text{font-size:12.5px;line-height:1.55;color:var(--dw-text);word-break:break-word}
.dw-tl-sep{color:var(--dw-text-3)}
.dw-tl-meta{font-size:10.5px;color:var(--dw-text-3);margin-top:1px}

/* drawer */
.dw-drawer-layer{position:absolute;inset:0;z-index:40;display:flex;justify-content:flex-end}
.dw-scrim{position:absolute;inset:0;background:rgba(9,13,22,.38);backdrop-filter:blur(1px);animation:dw-fade .16s ease}
.dw-drawer{position:relative;width:min(540px,100%);height:100%;display:flex;flex-direction:column;
  background:var(--dw-surface);border-left:1px solid var(--dw-border-2);box-shadow:-14px 0 40px rgba(0,0,0,.18);
  animation:dw-slide .2s cubic-bezier(.2,.8,.3,1)}
@keyframes dw-slide{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}
@keyframes dw-fade{from{opacity:0}to{opacity:1}}
.dw-drawer-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--dw-border);flex:0 0 auto}
.dw-drawer-id{display:flex;align-items:center;gap:8px;min-width:0}
.dw-id{font-family:var(--dw-mono);font-size:11px;color:var(--dw-text-3)}
.dw-status-pill{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:560;
  color:var(--dw-status-color);background:color-mix(in srgb,var(--dw-status-color) 12%,transparent);border:1px solid color-mix(in srgb,var(--dw-status-color) 30%,transparent)}
.dw-drawer-head-actions{margin-left:auto;display:flex;gap:4px}
.dw-drawer-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:13px}
.dw-title-input{width:100%;border:1px solid transparent;background:transparent;border-radius:8px;padding:4px 6px;margin:-4px -6px;
  font-size:17px;font-weight:650;letter-spacing:-.2px;color:var(--dw-text);outline:none;transition:border-color .15s ease,background .15s ease}
.dw-title-input:hover,.dw-title-input:focus{background:var(--dw-surface-2);border-color:var(--dw-border)}
.dw-props{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.dw-prop{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dw-text-3)}
.dw-prop input,.dw-prop select{height:29px;padding:0 8px;border-radius:7px;border:1px solid var(--dw-border);background:var(--dw-bg);
  color:var(--dw-text);font-size:12px;outline:none;width:100%}
.dw-prop input[type=range]{padding:0;height:22px;border:0;background:transparent;accent-color:var(--dw-accent)}
.dw-field{display:flex;flex-direction:column;gap:5px}
.dw-field-label{font-size:11px;color:var(--dw-text-3)}
.dw-field input[type=text],.dw-field input[type=number],.dw-field input[type=date],.dw-field select,.dw-field textarea{
  width:100%;padding:7px 9px;border-radius:7px;border:1px solid var(--dw-border);background:var(--dw-bg);color:var(--dw-text);
  font-size:12.5px;outline:none;transition:border-color .15s ease}
.dw-field textarea{resize:vertical;min-height:56px;line-height:1.6}
.dw-field input[type=range]{width:100%;height:22px;padding:0;border:0;background:transparent;accent-color:var(--dw-accent);cursor:pointer}
.dw-field input:focus,.dw-field textarea:focus,.dw-prop input:focus,.dw-prop select:focus{border-color:color-mix(in srgb,var(--dw-accent) 55%,transparent)}
.dw-checklist{display:flex;flex-direction:column;gap:2px}
.dw-check{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;font-size:12.5px;cursor:pointer}
.dw-check:hover{background:var(--dw-hover)}
.dw-check input{accent-color:var(--dw-accent)}
.dw-check.done span{color:var(--dw-text-3);text-decoration:line-through}
.dw-check-add{display:flex;gap:6px;align-items:center;margin-top:2px}
.dw-check-add input{flex:1 1 auto;height:29px;padding:0 9px;border-radius:7px;border:1px dashed var(--dw-border-2);background:transparent;color:var(--dw-text);font-size:12.5px;outline:none}
.dw-artifacts{display:flex;flex-direction:column;gap:4px}
.dw-artifact{display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:6px;background:var(--dw-surface-2);font-size:12px;color:var(--dw-text-2)}
.dw-artifact-label{color:var(--dw-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dw-artifact-path{font-family:var(--dw-mono);font-size:10.5px;color:var(--dw-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto}
.dw-artifact-add{display:flex;gap:6px;align-items:center}
.dw-artifact-add input{flex:1 1 0;min-width:0;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--dw-border);background:var(--dw-bg);color:var(--dw-text);font-size:12px;outline:none}
.dw-tasklog{display:flex;flex-direction:column;gap:3px}
.dw-tasklog .dw-tl-dot{margin-left:0;margin-top:0;width:15px;height:15px}
.dw-tasklog-item{display:flex;align-items:flex-start;gap:7px;font-size:12px;color:var(--dw-text-2);line-height:1.5}
.dw-drawer-attn{display:flex;flex-direction:column;gap:8px}
.dw-drawer-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 14px calc(10px + var(--dsh-frame-bottom-clearance,0px));
  border-top:1px solid var(--dw-border);background:var(--dw-surface-2);flex-wrap:wrap}
.dw-handoff{display:flex;gap:6px;flex-wrap:wrap}
.dw-drawer-danger{margin-left:auto}
.dw-danger-btn{display:inline-flex;align-items:center;gap:5px;height:27px;padding:0 8px;border-radius:7px;border:1px solid transparent;
  background:transparent;color:var(--dw-text-3);font-size:12px;cursor:pointer;transition:background .15s ease,color .15s ease}
.dw-danger-btn:hover{background:color-mix(in srgb,var(--dw-danger) 10%,transparent);color:var(--dw-danger)}
.dw-confirm{position:absolute;left:50%;bottom:76px;transform:translateX(-50%);z-index:50;display:flex;flex-direction:column;gap:10px;
  min-width:300px;max-width:calc(100% - 28px);padding:14px;border-radius:10px;border:1px solid var(--dw-border-2);
  background:var(--dsw-alias-bg-overlay,var(--dw-surface));box-shadow:0 16px 40px rgba(0,0,0,.24)}
.dw-confirm-text{font-size:12.5px;line-height:1.6;color:var(--dw-text)}
.dw-confirm-actions{display:flex;justify-content:flex-end;gap:8px}

/* modal */
.dw-modal-layer{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:20px}
.dw-modal{position:relative;width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:14px;
  border:1px solid var(--dw-border-2);background:var(--dsw-alias-bg-overlay,var(--dw-surface));box-shadow:0 24px 60px rgba(0,0,0,.28);
  animation:dw-pop-in .18s cubic-bezier(.2,.8,.3,1)}
@keyframes dw-pop-in{from{transform:translateY(8px) scale(.99);opacity:.7}to{transform:none;opacity:1}}
.dw-modal-head{display:flex;align-items:center;padding:13px 15px;border-bottom:1px solid var(--dw-border)}
.dw-modal-title{font-size:14px;font-weight:640}
.dw-modal-head>.dw-iconbtn{margin-left:auto}
.dw-modal-body{display:flex;flex-direction:column;gap:10px;padding:15px;overflow:auto}
.dw-modal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.dw-modal-foot{display:flex;align-items:center;gap:10px;padding:11px 15px;border-top:1px solid var(--dw-border);background:var(--dw-surface-2);border-radius:0 0 14px 14px}
.dw-modal-actions{margin-left:auto;display:flex;gap:8px}

/* settings popover */
.dw-pop{position:absolute;right:0;top:36px;z-index:35;width:252px;display:flex;flex-direction:column;gap:10px;padding:13px;
  border-radius:11px;border:1px solid var(--dw-border-2);background:var(--dsw-alias-bg-overlay,var(--dw-surface));box-shadow:0 18px 44px rgba(0,0,0,.22)}
.dw-pop-title{font-size:12.5px;font-weight:640}
.dw-pop .dw-field input,.dw-pop .dw-field select{height:29px;padding:0 8px;border-radius:7px;border:1px solid var(--dw-border);background:var(--dw-bg);color:var(--dw-text);font-size:12px;outline:none}
.dw-switch-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dw-text-2);cursor:pointer}
.dw-switch-row input{accent-color:var(--dw-accent)}
.dw-pop-root{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dw-text-3);word-break:break-all}
.dw-pop-root code{font-family:var(--dw-mono);font-size:10.5px}
.dw-pop-actions{display:flex;justify-content:flex-end}

/* 项目切换器 */
.dw-projswitch-wrap{position:relative;flex:0 0 auto}
.dw-projswitch{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 9px;max-width:210px;
  border-radius:var(--dw-radius-sm);border:1px solid var(--dw-border);background:var(--dw-surface);color:var(--dw-text);
  font-size:12.5px;font-weight:560;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.dw-projswitch:hover{background:var(--dw-surface-2)}
.dw-projswitch-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dw-projswitch-count{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--dw-surface-3);color:var(--dw-text-2);
  font-size:10px;font-weight:650;display:inline-flex;align-items:center;justify-content:center}
.dw-projswitch-menu{left:0;right:auto;top:36px;min-width:238px;max-height:340px;overflow:auto}
.dw-menu-grow{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dw-menu-count{font-size:10px;color:var(--dw-text-3);font-variant-numeric:tabular-nums}
.dw-menu-item.on{background:color-mix(in srgb,var(--dw-accent) 11%,transparent);color:var(--dw-accent)}
.dw-menu-item.danger{color:var(--dw-danger)}
.dw-menu-item.danger:hover{background:color-mix(in srgb,var(--dw-danger) 10%,transparent)}
.dw-projdot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto;background:var(--dw-text-3)}
.dw-projdot.lg{width:10px;height:10px}

/* 卡片上的项目标签 */
.dw-projtag{display:inline-flex;align-items:center;gap:4px;max-width:132px;height:18px;padding:0 6px;border-radius:5px;
  font-size:10.5px;color:var(--dw-text-2);background:var(--dw-surface-2);border:1px solid var(--dw-border);white-space:nowrap;overflow:hidden}
.dw-projtag .dw-projdot{width:6px;height:6px;background:var(--dw-proj-color)}
.dw-projtag{--dw-proj-color:#94A3B8}

/* 项目视图 */
.dw-projects-view{display:flex;flex-direction:column;gap:12px}
.dw-projgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.dw-projcard{position:relative;display:flex;flex-direction:column;gap:9px;padding:13px 14px;border-radius:var(--dw-radius);
  border:1px solid var(--dw-border);border-left:3px solid var(--dw-proj-color,#5B7CFA);background:var(--dw-surface);
  cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
.dw-projcard:hover{border-color:var(--dw-border-2);box-shadow:0 4px 14px rgba(0,0,0,.08);transform:translateY(-1px)}
.dw-projcard:focus-visible{box-shadow:var(--dw-focus)}
.dw-projcard-head{display:flex;align-items:center;gap:8px;min-width:0}
.dw-projcard-name{font-size:13.5px;font-weight:640;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dw-projstatus{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:5px;font-size:10.5px;font-weight:560;
  color:var(--dw-proj-status);background:color-mix(in srgb,var(--dw-proj-status) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--dw-proj-status) 32%,transparent);white-space:nowrap;flex:0 0 auto}
.dw-projcard-menu{position:relative;margin-left:auto}
.dw-projcard .dw-card-more{opacity:.65}
.dw-projcard:hover .dw-card-more{opacity:1}
.dw-projcard-desc{margin:0;font-size:11.5px;line-height:1.55;color:var(--dw-text-2);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dw-projcard-progress{display:flex;align-items:center;gap:8px}
.dw-projcard-pct{font-size:10.5px;color:var(--dw-text-3);font-variant-numeric:tabular-nums;min-width:32px;text-align:right}
.dw-projcard-counts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dw-text-2)}
.dw-projcard-counts b{color:var(--dw-text);font-weight:640;font-variant-numeric:tabular-nums}
.dw-projcard-counts .dot-green b{color:var(--dw-success)}
.dw-projcard-counts .dot-amber b{color:var(--dw-warn)}
.dw-projcard-counts .dot-red b{color:var(--dw-danger)}
.dw-projcard-counts .dot-muted b{color:var(--dw-text-3)}
.dw-projcard-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px;
  font-size:10.5px;color:var(--dw-text-3)}
.dw-projcard-foot span{display:inline-flex;align-items:center;gap:4px}
.dw-projcard.add{justify-content:center;align-items:center;gap:6px;min-height:150px;border-style:dashed;border-left-width:1px;
  color:var(--dw-text-2);font-size:12.5px;background:transparent}
.dw-projcard.add:hover{color:var(--dw-accent);border-color:color-mix(in srgb,var(--dw-accent) 45%,transparent);transform:none}

/* 颜色选择 */
.dw-swatches{display:flex;gap:8px;flex-wrap:wrap}
.dw-swatch{width:24px;height:24px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);transition:transform .12s ease}
.dw-swatch:hover{transform:scale(1.08)}
.dw-swatch.on{border-color:var(--dw-text);box-shadow:0 0 0 2px var(--dw-surface)}

@media (max-width:1180px){
  .dw-brand-sub{display:none}
  .dw-projswitch{max-width:160px}
  .dw-projswitch-name{max-width:80px}
}
@media (max-width:1020px){
  .dw-tab{padding:0 8px;gap:4px}
}

/* toasts */
.dw-toasts{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:80;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
.dw-toast{padding:7px 13px;border-radius:999px;font-size:12px;border:1px solid var(--dw-border-2);
  background:var(--dsw-alias-bg-overlay,var(--dw-surface));color:var(--dw-text);box-shadow:0 8px 24px rgba(0,0,0,.18);animation:dw-toast-in .18s ease}
.dw-toast-ok{border-color:color-mix(in srgb,var(--dw-success) 40%,transparent)}
.dw-toast-error{border-color:color-mix(in srgb,var(--dw-danger) 44%,transparent);color:var(--dw-danger)}
@keyframes dw-toast-in{from{transform:translateY(6px);opacity:0}to{transform:none;opacity:1}}

@media (max-width:900px){
  .dw-brand-sub{max-width:160px}
  .dw-board{grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);grid-template-columns:none;overflow-x:auto;padding-bottom:6px}
  .dw-today-grid{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .dw-root *,.dw-root *::before,.dw-root *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
}
`;

    /* ---------------- 侧栏图标 ---------------- */
    const PanelIcon = function (props) {
      const size = (props && props.size) || 16;
      const active = !!(props && props.active);
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: active ? 2 : 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M4 4h4.5v16H4z' }),
        h('path', { d: 'M9.8 4h4.5v10H9.8z' }),
        h('path', { d: 'M15.6 4H20v6.5h-4.4z' }));
    };

    return {
      /* slots 与 uiWorkspace 必须声明：否则 apply 早于服务就绪，注册会被静默丢弃 */
      inject: ['slots', 'uiWorkspace'],
      apply(ctx) {
        const svc = (n) => {
          try { const v = ctx[n]; if (v !== undefined && v !== null) return v; } catch (e) { /* ignore */ }
          try { return ctx.get ? ctx.get(n) : undefined; } catch (e) { return undefined; }
        };
        const slots = svc('slots');
        const uiWorkspace = svc('uiWorkspace');
        const openSession = (id) => {
          try { if (id && uiWorkspace && typeof uiWorkspace.openSession === 'function') uiWorkspace.openSession(id); } catch (e) { /* ignore */ }
        };

        let styleEl = null;
        try {
          styleEl = document.createElement('style');
          styleEl.setAttribute('data-plugin', 'dsh-devwork');
          styleEl.textContent = CSS;
          document.head.appendChild(styleEl);
        } catch (e) { /* ignore */ }
        const disposeStyle = () => { try { if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); } catch (e) { /* ignore */ } };

        try {
          if (slots && typeof slots.inject === 'function') {
            slots.inject('sidebar.panellist', () => slots.register({
              name: 'sidebar.panellist', id: 'devwork', order: 34,
              label: function () { return t('brand'); },
            }, PanelIcon));
            slots.inject('main', () => slots.register({ name: 'main', key: 'devwork' }, function () {
              return h(Workbench, { actions: { openSession: openSession } });
            }));
          } else {
            try { console.error('[dsh-devwork] slots 服务不可用，面板未注册'); } catch (e) { /* ignore */ }
          }
        } catch (e) {
          try { console.error('[dsh-devwork] 面板注册失败', e); } catch (e2) { /* ignore */ }
        }
        try { if (typeof ctx.effect === 'function') ctx.effect(function () { return disposeStyle; }, 'dsh-devwork: styles'); } catch (e) { /* ignore */ }
      },
    };
  },
});
