/**
 * dsh-devwork · 宿主半（DeepSeek Harness Web UI 插件）
 *
 * 能力：
 * - agent 工具：dev_board / dev_item / dev_attention / dev_brief / dev_project（v2）
 * - HTTP 路由 /devwork/api/*（meta · state · stream · task/* · project/* · attention/* · settings · handoff）
 * - 系统提示词注入：开发工作台编排规则 + 回报协议 + 红线 + 项目与并行（v2 §10.4）
 * - 客户端面板（client.js，另一侧）：5 列看板 / 今日焦点 / 活动流 / 项目视图
 *
 * 约束：本插件运行时无法 import @deepseek-ai/*，服务一律通过 ctx.get(...) 探测；
 * webServer / connection / workspaceRegistry / sessionController 缺失时，工具与提示词照常工作。
 */

import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import * as U from './src/util.js';
import * as S from './src/store.js';

/* 与 package.json / cordis.patch.yml 的导入行 id 保持一致。 */
export const name = 'dsh-devwork';
export const inject = ['tools', 'systemPrompt'];

const API = '/devwork/api';
const VERSION = '0.1.0';

/* ---------------- 基础 HTTP 工具 ---------------- */

function text(t) {
  return [{ type: 'text', text: String(t === undefined || t === null ? '' : t) }];
}

function json(res, status, payload, headers) {
  try {
    if (res.writableEnded) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(payload));
  } catch {
    /* 响应已发送或连接已断开 */
  }
}

function qs(req) {
  const o = {};
  try {
    const u = new URL(String((req && req.url) || '/'), 'http://localhost');
    for (const [k, v] of u.searchParams) o[k] = v;
  } catch { /* 非法 URL 忽略 */ }
  return o;
}

/** 读 JSON 请求体（上限 400KB；空体 → {}）。 */
function readJsonBody(req, maxBytes = 400000) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(U.fail('INVALID_INPUT', '请求体过大'));
        try { req.destroy(); } catch { /* 忽略 */ }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw || !raw.trim()) { resolveBody({}); return; }
      try {
        const v = JSON.parse(raw);
        resolveBody(U.isPlainObject(v) ? v : {});
      } catch {
        reject(U.fail('INVALID_INPUT', 'JSON 解析失败'));
      }
    });
    req.on('error', () => reject(U.fail('INVALID_INPUT', '读取请求体失败')));
  });
}

/** 服务探测：ctx.<name> 或 ctx.get(name)；缺失返回 undefined（不抛）。 */
function svcOfImpl(ctx, n) {
  try {
    if (ctx && ctx[n] && typeof ctx[n] === 'object') return ctx[n];
  } catch { /* 忽略 */ }
  try {
    return typeof ctx.get === 'function' ? ctx.get(n) : undefined;
  } catch {
    return undefined;
  }
}

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i;

/** 从 Host 头取 hostname（IPv6 保留方括号，去掉端口）。 */
function hostnameOf(hostHeader) {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end === -1 ? raw : raw.slice(0, end + 1);
  }
  return raw.split(':')[0];
}

/**
 * 无 connection 服务时的最小来源护栏（非 Web 组合 / 测试环境）：
 * Host 必须回环（缺省视为本机）；Origin 必须与 Host 同源且回环；cross-site 一律拒绝。
 * @returns {0|403} 0 = 放行
 */
function fallbackFence(req) {
  const h = (req && req.headers) || {};
  const hostRaw = String(h.host || '').trim().toLowerCase();
  const hostName = hostnameOf(hostRaw);
  if (hostRaw && !LOCAL_HOST_RE.test(hostName)) return 403;
  if (String(h['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403;
  const origin = String(h.origin || '').trim();
  if (origin) {
    try {
      const o = new URL(origin);
      if (!LOCAL_HOST_RE.test(o.hostname.toLowerCase())) return 403;
      if (hostRaw && o.host.toLowerCase() !== hostRaw) return 403;
    } catch {
      return 403;
    }
  }
  return 0;
}

/**
 * 路由统一守卫：方法白名单 → connection.admit（缺省走 Host/Origin fence）→ POST JSON 类型。
 * @returns {boolean} true = 继续执行 handler
 */
function makeGuard(ctx) {
  let warned = false;
  return function guard(req, res, opts = {}) {
    const methods = Array.isArray(opts.methods) && opts.methods.length ? opts.methods : ['GET'];
    const method = String((req && req.method) || 'GET').toUpperCase();
    if (!methods.includes(method)) {
      json(res, 405, { ok: false, reason: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' }, { Allow: methods.join(', ') });
      return false;
    }

    const conn = svcOfImpl(ctx, 'connection');
    if (conn && typeof conn.admit === 'function') {
      let admission;
      try {
        admission = conn.admit(req);
      } catch {
        json(res, 500, { ok: false, reason: '鉴权检查失败', code: 'INTERNAL' });
        return false;
      }
      if (admission && typeof admission === 'object' && 'rejection' in admission) {
        const code = admission.rejection === 401 ? 401 : 403;
        json(res, code, { ok: false, reason: code === 401 ? '未授权：需要浏览器会话' : '来源不可信', code: 'FORBIDDEN' });
        return false;
      }
    } else {
      if (!warned) {
        warned = true;
        try { ctx.logger?.warn?.('dsh-devwork: 未挂载 connection，路由使用 Host/Origin fence 兜底'); } catch { /* 忽略 */ }
      }
      if (fallbackFence(req)) {
        json(res, 403, { ok: false, reason: '来源不可信', code: 'FORBIDDEN' });
        return false;
      }
    }

    if (opts.json && method === 'POST') {
      const ct = String(((req && req.headers) || {})['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ct !== 'application/json') {
        json(res, 415, { ok: false, reason: 'Content-Type 必须为 application/json', code: 'UNSUPPORTED_MEDIA_TYPE' });
        return false;
      }
    }
    return true;
  };
}

const STATUS_OF_CODE = {
  INVALID_INPUT: 400,
  INVALID_ROOT: 400,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  HUMAN_ONLY: 409,
  PROJECT_NOT_EMPTY: 409,
  READ_FAILED: 500,
  WRITE_FAILED: 500,
};

function sendError(res, e) {
  const code = String((e && e.code) || '');
  const status = STATUS_OF_CODE[code] || 500;
  const reason = String((e && (e.message || e.code)) || e || '服务器错误');
  json(res, status, { ok: false, reason, code: code || 'INTERNAL' });
}

/* ---------------- 工作区根解析（CONTRACT §5） ---------------- */

const MARKERS = ['.git', 'package.json', '.devwork'];

function hasMarker(dir) {
  for (const m of MARKERS) {
    try { if (existsSync(join(dir, m))) return true; } catch { /* 忽略 */ }
  }
  return false;
}

function workspacePathOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  for (const k of ['cwd', 'path', 'root', 'dir', 'directory', 'workspacePath', 'rootPath']) {
    const x = v[k];
    if (typeof x === 'string' && x) return x;
    if (x && typeof x.path === 'string' && x.path) return x.path;
    if (x && typeof x.root === 'string' && x.root) return x.root;
  }
  return '';
}

function workspaceIdOf(v) {
  if (!v || typeof v !== 'object') return '';
  const direct = v.id || v.workspaceId;
  if (typeof direct === 'string' && direct) return direct;
  if (v.workspace && typeof v.workspace.id === 'string') return v.workspace.id;
  if (v.session && typeof v.session.workspaceId === 'string') return v.session.workspaceId;
  return '';
}

function listWorkspaces(ctx) {
  const reg = svcOfImpl(ctx, 'workspaceRegistry');
  if (!reg) return [];
  for (const m of ['list', 'all', 'workspaces']) {
    try {
      const v = typeof reg[m] === 'function' ? reg[m]() : undefined;
      const arr = Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : null);
      if (arr) return arr.filter(Boolean);
    } catch { /* 下一个方法 */ }
  }
  return [];
}

/**
 * 解析工作区根，返回 {root, how}；失败抛 INVALID_ROOT。
 * 顺序严格按 CONTRACT §5：显式 root → registry.current → registry.list 第一个存在 →
 * sessionController.current → cwd 上溯（含项目标记）→ process.cwd()。
 */
function resolveRoot(ctx, explicit) {
  const requested = U.trimStr(explicit, 2000);
  if (requested) {
    const root = U.assertSafeRoot(requested);
    const list = listWorkspaces(ctx);
    if (list.length) {
      const inReg = list.some((w) => {
        const p = workspacePathOf(w);
        return p ? U.isUnder(p, root) : false;
      });
      if (!inReg) throw U.fail('INVALID_ROOT', 'root 不在已注册工作区内：' + root);
    }
    return { root, how: '参数指定（已校验）' };
  }

  const reg = svcOfImpl(ctx, 'workspaceRegistry');
  if (reg) {
    for (const m of ['current', 'getCurrent', 'active']) {
      try {
        const w = typeof reg[m] === 'function' ? reg[m]() : undefined;
        const p = workspacePathOf(w);
        if (!p) continue;
        try { return { root: U.assertSafeRoot(p), how: 'workspaceRegistry.' + m + '()' }; } catch { /* 继续 */ }
      } catch { /* 下一个方法 */ }
    }
    for (const m of ['list', 'all', 'workspaces']) {
      try {
        const v = typeof reg[m] === 'function' ? reg[m]() : undefined;
        const arr = Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : []);
        for (const it of arr) {
          const p = workspacePathOf(it);
          if (!p) continue;
          try { return { root: U.assertSafeRoot(p), how: 'workspaceRegistry.' + m + '()' }; } catch { /* 继续 */ }
        }
      } catch { /* 下一个方法 */ }
    }
  }

  const sc = svcOfImpl(ctx, 'sessionController');
  if (sc) {
    for (const m of ['current', 'getCurrent', 'active']) {
      try {
        const v = typeof sc[m] === 'function' ? sc[m]() : undefined;
        const p = workspacePathOf(v) || workspacePathOf(v && (v.session || v.workspace));
        if (!p) continue;
        try { return { root: U.assertSafeRoot(p), how: 'sessionController.' + m + '()' }; } catch { /* 继续 */ }
      } catch { /* 下一个方法 */ }
    }
  }

  let cur = process.cwd();
  for (let i = 0; i < 6 && cur; i++) {
    if (hasMarker(cur)) {
      try {
        return { root: U.assertSafeRoot(cur), how: i === 0 ? 'process.cwd()（含项目标记）' : 'cwd 上溯（含项目标记）' };
      } catch { /* 继续上溯 */ }
    }
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }

  try {
    return { root: U.assertSafeRoot(process.cwd()), how: 'process.cwd()' };
  } catch {
    throw U.fail('INVALID_ROOT', '无法确定工作区根，请在请求里显式传 root');
  }
}

/** 从 query/body 取 root（body 优先）。 */
function rootParam(req, body) {
  const b = body && typeof body === 'object' ? body.root : undefined;
  const v = b !== undefined && b !== null && String(b).trim() ? b : qs(req).root;
  return U.trimStr(v, 2000);
}

/* ---------------- 文本渲染（工具输出） ---------------- */

function oneLine(s, max) {
  return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 60);
}

/** 任务所属项目（找不到返回 null）。 */
function projectOfTask(board, task) {
  return task && task.projectId && S.findProject(board, task.projectId);
}

function taskLine(t, project) {
  const bits = [`${t.id} ${t.title}`];
  bits.push(S.typeLabel(t.type));
  bits.push(t.priority);
  if (project) bits.push(project.name);
  if (t.owner) bits.push(t.owner);
  if (t.due) bits.push('到期 ' + String(t.due).slice(5));
  if (t.progress) bits.push(t.progress + '%');
  if (t.status === 'blocked' && t.blockedReason) bits.push('卡点：' + oneLine(t.blockedReason, 40));
  if (t.status === 'review' && t.reviewNote) bits.push('回执：' + oneLine(t.reviewNote, 30));
  return '- ' + bits.join('｜');
}

function describeFilters(a) {
  const bits = [];
  if (a.status) bits.push('状态=' + a.status);
  if (a.type) bits.push('类型=' + a.type);
  if (a.priority) bits.push('优先级=' + a.priority);
  if (a.owner) bits.push('负责人=' + a.owner);
  if (a.q) bits.push('关键词=' + a.q);
  return bits.join('｜');
}

function filterTasks(tasks, a, projectId) {
  const q = oneLine(a.q, 100).toLowerCase();
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    if (!t) return false;
    if (projectId && t.projectId !== projectId) return false;
    if (a.status && t.status !== a.status) return false;
    if (a.type && t.type !== a.type) return false;
    if (a.priority && t.priority !== a.priority) return false;
    if (a.owner && !String(t.owner || '').includes(String(a.owner))) return false;
    if (q) {
      const hay = [t.id, t.title, t.description, (t.tags || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** 任务行附带项目名：仅在「全部项目」视图（未指定项目过滤）时显示，避免单项目视图重复。 */
function showProjectInLines(project) {
  return !project;
}

function boardText(board, tasks, root, how, filters, project) {
  /* 指定项目时用项目范围内的统计，避免抬头显示全局数字 */
  const stats = project
    ? S.computeStats({ tasks: (Array.isArray(board.tasks) ? board.tasks : []).filter((t) => t && t.projectId === project.id) })
    : S.computeStats(board);
  const lines = [];
  lines.push('开发工作台｜工作区：' + root);
  const scope = project ? `项目：${project.name}（${project.id}）｜` : '项目：全部项目｜';
  lines.push(`${scope}依据：${how}｜rev ${board.rev}｜任务 ${stats.total}｜进行中 ${stats.doing}｜受阻 ${stats.blocked}｜待验收 ${stats.review}｜今日到期 ${stats.dueToday}｜已逾期 ${stats.overdue}`);
  const desc = describeFilters(filters || {});
  if (desc) lines.push('过滤：' + desc + `（命中 ${tasks.length} 条）`);
  const withProject = showProjectInLines(project);

  for (const st of S.STATUSES) {
    const group = tasks.filter((t) => t.status === st);
    if (!group.length) continue;
    if (lines.length > 2) lines.push('');
    lines.push(`${S.statusLabel(st)}（${group.length}）`);
    for (const t of group.slice(0, 20)) lines.push(taskLine(t, withProject ? projectOfTask(board, t) : null));
    if (group.length > 20) lines.push(`…还有 ${group.length - 20} 条（用 status/type/priority/q 过滤）`);
  }
  if (!tasks.length) {
    lines.push('');
    lines.push('（没有符合条件的任务；用 dev_item action=create 建任务，或在左侧「开发工作台」面板新建）');
  }

  const wip = U.clampInt(board.settings && board.settings.wipLimit, 1, 20, 3);
  const doingInScope = project
    ? tasks.filter((t) => t.status === 'doing').length
    : stats.byStatus.doing;
  if (doingInScope > wip) {
    lines.push('');
    lines.push(`提醒：进行中 ${doingInScope} 个，超过 WIP 上限 ${wip}——先收口再开新任务。`);
  }
  const openAtt = S.listAttention(board).length;
  if (openAtt) lines.push(`待处理注意力：${openAtt} 条（dev_attention action=list 查看）。`);
  lines.push('');
  lines.push('下一步：dev_board view=brief 看今日简报；dev_item action=create 建任务；dev_item action=move 移泳道；dev_project list 查看项目。');
  return lines.join('\n');
}

/** 项目总览文本（dev_board view=projects）。 */
function projectLine(p) {
  const s = p.stats || {};
  const bits = [
    `${p.id} ${p.name}`,
    S.projectStatusLabel(p.status),
    `任务 ${Number(s.total) || 0}`,
    `进行中 ${Number(s.doing) || 0}`,
    `待验收 ${Number(s.review) || 0}`,
    `受阻 ${Number(s.blocked) || 0}`,
    `完成率 ${Number(s.progress) || 0}%`,
  ];
  if (s.nextDue) bits.push('最近到期 ' + s.nextDue);
  if (p.description) bits.push('说明：' + oneLine(p.description, 40));
  return '- ' + bits.join('｜');
}

function projectsText(board, now, project) {
  const all = (Array.isArray(board.projects) ? board.projects : []).map((p) => ({
    ...p,
    stats: S.computeProjectStats(board, p.id, now),
  }));
  const projects = project ? all.filter((p) => p.id === project.id) : all;
  const lines = ['开发工作台 · 项目总览' + (project ? `（${project.name}）` : '')];
  lines.push(`项目 ${projects.length} 个｜任务 ${(Array.isArray(board.tasks) ? board.tasks : []).length} 个｜rev ${board.rev}`);
  lines.push('');
  for (const p of projects) lines.push(projectLine(p));
  const unassigned = (Array.isArray(board.tasks) ? board.tasks : []).filter((t) => t && !t.projectId);
  if (unassigned.length && !project) lines.push(`未归属任务：${unassigned.length} 个（用 dev_item action=update project=<项目> 改归）`);
  lines.push('');
  lines.push('按项目看板：dev_board project=<id或名称>；新建项目：dev_project create；删除项目只能由人在面板执行。');
  return { text: lines.join('\n'), projects };
}

function taskText(t, board) {
  const lines = [];
  lines.push(`${t.id} · ${t.title}`);
  const proj = board ? projectOfTask(board, t) : null;
  lines.push(`项目：${proj ? proj.name + '（' + proj.id + '）' : '未归属'}`);
  lines.push(`状态：${S.statusLabel(t.status)}｜类型：${S.typeLabel(t.type)}｜优先级：${t.priority}｜负责人：${t.owner || '-'}`);
  lines.push(`到期：${t.due || '-'}｜预估：${t.estimate}h｜已投入：${t.spent}h｜进度：${t.progress}%`);
  if (t.startedAt) lines.push('开始：' + t.startedAt);
  if (t.doneAt) lines.push('完成：' + t.doneAt);
  lines.push(`创建：${t.createdAt}｜更新：${t.updatedAt}`);
  if (t.description) { lines.push(''); lines.push('说明：'); lines.push(t.description); }
  if (t.checklist && t.checklist.length) {
    lines.push('');
    lines.push('检查项：');
    for (const c of t.checklist) lines.push(`- [${c.done ? 'x' : ' '}] ${c.text}（${c.id}）`);
  }
  if (t.artifacts && t.artifacts.length) {
    lines.push('');
    lines.push('产出：');
    for (const a of t.artifacts) lines.push(`- ${a.label}：${a.path}`);
  }
  if (t.links && t.links.length) {
    lines.push('');
    lines.push('链接：');
    for (const l of t.links) lines.push(`- [${l.kind}] ${l.label}：${l.ref}`);
  }
  if (t.dependencies && t.dependencies.length) {
    lines.push('');
    lines.push('依赖：' + t.dependencies.join('、'));
  }
  if (t.tags && t.tags.length) lines.push('标签：' + t.tags.join('、'));
  if (t.blockedReason) { lines.push(''); lines.push('卡点：' + t.blockedReason); }
  if (t.reviewNote) { lines.push(''); lines.push('回执：' + t.reviewNote); }
  if (t.sessionId) lines.push('执行会话：' + t.sessionId);
  return lines.join('\n');
}

function statsText(stats) {
  const lines = [];
  lines.push('开发工作台 · 统计');
  lines.push(`任务 ${stats.total}｜未完成 ${stats.open}｜进行中 ${stats.doing}｜受阻 ${stats.blocked}｜待验收 ${stats.review}`);
  lines.push(`今日到期 ${stats.dueToday}｜已逾期 ${stats.overdue}｜本周完成 ${stats.doneThisWeek}`);
  lines.push('');
  lines.push('按状态：' + S.STATUSES.map((s) => `${S.statusLabel(s)} ${stats.byStatus[s]}`).join('｜'));
  lines.push('按类型：' + S.TYPES.map((t) => `${S.typeLabel(t)} ${stats.byType[t]}`).join('｜'));
  return lines.join('\n');
}

/** 单项目统计文本（dev_board view=stats project=…）。 */
function projectStatsText(board, project, now) {
  const s = S.computeProjectStats(board, project.id, now);
  const lines = [];
  lines.push(`开发工作台 · 项目统计：${project.name}（${project.id}）｜${S.projectStatusLabel(project.status)}｜rev ${board.rev}`);
  lines.push(`任务 ${s.total}｜未完成 ${s.open}｜待办 ${s.todo}｜进行中 ${s.doing}｜待验收 ${s.review}｜受阻 ${s.blocked}｜已完成 ${s.done}｜已取消 ${s.canceled}`);
  lines.push(`完成率 ${s.progress}%｜最近到期 ${s.nextDue || '-'}｜3 天内到期 ${s.dueSoon}｜已逾期 ${s.overdue}`);
  if (project.description) {
    lines.push('');
    lines.push('说明：' + project.description);
  }
  return lines.join('\n');
}

function briefText(brief, applied, board) {
  const stats = brief.stats;
  const lines = [];
  const scope = brief.project ? `｜项目：${brief.project.name}（${brief.project.id}）` : '';
  lines.push(`开发工作台 · ${brief.period === 'week' ? '本周' : '今日'}简报（${brief.today}）${scope}｜rev ${brief.rev}`);
  lines.push(`任务 ${stats.total}｜进行中 ${stats.doing}｜今日到期 ${stats.dueToday}｜已逾期 ${stats.overdue}｜受阻 ${stats.blocked}｜待验收 ${stats.review}｜本周完成 ${stats.doneThisWeek}`);

  const sections = [
    ['overdue', '已逾期'], ['dueToday', '到期'], ['doing', '进行中'],
    ['blocked', '受阻'], ['review', '待验收'], ['stale', '停滞'],
  ];
  let any = false;
  for (const [key, label] of sections) {
    const arr = brief.focus[key] || [];
    if (!arr.length) continue;
    any = true;
    lines.push('');
    lines.push(`${label}（${arr.length}）`);
    for (const t of arr) lines.push(taskLine(t, brief.project ? null : projectOfTask(board, t)));
  }
  if (!any) {
    lines.push('');
    lines.push('（当前没有焦点任务：可以 dev_item action=create 建任务，或从待办里挑一个开始）');
  }
  if (brief.suggestions.length) {
    lines.push('');
    lines.push(`建议（${brief.suggestions.length}）`);
    brief.suggestions.slice(0, 10).forEach((s, i) => lines.push(`${i + 1}. [${s.code}] ${s.text}`));
    if (brief.suggestions.length > 10) lines.push(`…还有 ${brief.suggestions.length - 10} 条`);
  }

  const autonomy = board && board.settings ? board.settings.autonomy : 'observe';
  if (applied && applied.length) {
    lines.push('');
    lines.push(`安全动作：autonomy=${autonomy}，已给 ${applied.length} 个受阻且没有下一步日期的任务追加活动提示（未建新任务）。`);
  } else if (applied && applied.skipped) {
    lines.push('');
    lines.push('安全动作：当前 autonomy=observe，只给建议不执行。');
  }
  return lines.join('\n');
}

/* ---------------- 工具错误 ---------------- */

function toolFail(e) {
  const code = String((e && e.code) || 'ERROR');
  const reason = String((e && (e.message || e.code)) || e || '操作失败');
  const prefix = code === 'HUMAN_ONLY' ? '拒绝（只能由人执行）' : '操作失败';
  return { text: `${prefix}（${code}）：${reason}`, ok: false, code, reason };
}

/* ============================ 插件主体 ============================ */

export function apply(ctx) {
  const log = (m) => { try { ctx.logger?.info?.('dsh-devwork: ' + m); } catch { /* 忽略 */ } };
  const guard = makeGuard(ctx);
  const toolRoot = (a) => resolveRoot(ctx, a && a.root);

  /** ctx.effect 兜底：不可用时静默跳过清理注册。 */
  const effect = (fn, label) => {
    try {
      if (typeof ctx.effect === 'function') return ctx.effect(fn, label);
    } catch (e) {
      log('ctx.effect 不可用（' + U.errText(e) + '），跳过清理注册');
    }
    return undefined;
  };

  /* ---------------- SSE 连接集合 ---------------- */

  /** @type {Set<{res:object, timer:any, closed:boolean}>} */
  const streams = new Set();

  function closeStream(conn) {
    if (!conn || conn.closed) return;
    conn.closed = true;
    if (conn.timer) { clearInterval(conn.timer); conn.timer = null; }
    streams.delete(conn);
    try { conn.res.end(); } catch { /* 已断开 */ }
  }

  function broadcast(rev) {
    const data = JSON.stringify({ rev: Number(rev) || 0 });
    for (const conn of [...streams]) {
      try {
        if (conn.res.writableEnded) { closeStream(conn); continue; }
        conn.res.write(`event: state\ndata: ${data}\n\n`);
      } catch {
        closeStream(conn);
      }
    }
  }

  effect(() => () => {
    for (const conn of [...streams]) closeStream(conn);
    streams.clear();
  }, 'dsh-devwork: streams');

  /** 串行读-改-写 + 广播 rev。 */
  async function mutate(root, fn) {
    const { board, out } = await S.mutateBoard(root, fn);
    broadcast(board.rev);
    return { board, out };
  }

  /* ---------------- handoff（sessionController.create + prompt） ---------------- */

  function chooseWorkspace(root) {
    const reg = svcOfImpl(ctx, 'workspaceRegistry');
    const rn = U.normPath(root);
    const under = (p) => {
      if (!rn || !p) return false;
      const np = U.normPath(p);
      return np === rn || rn.startsWith(np + sep);
    };
    if (reg) {
      for (const m of ['current', 'getCurrent', 'active']) {
        try {
          const w = typeof reg[m] === 'function' ? reg[m]() : undefined;
          const id = workspaceIdOf(w);
          const p = workspacePathOf(w);
          if (id && (!rn || !p || under(p))) return { id, how: 'workspaceRegistry.' + m + '()' };
        } catch { /* 下一个方法 */ }
      }
      const list = listWorkspaces(ctx);
      const hit = list.find((w) => w && workspaceIdOf(w) && under(workspacePathOf(w)));
      if (hit) return { id: workspaceIdOf(hit), how: '匹配工作区根' };
      const first = list.find((w) => w && workspaceIdOf(w));
      if (first) return { id: workspaceIdOf(first), how: 'workspaceRegistry.list()' };
    }
    try {
      const sc = svcOfImpl(ctx, 'sessionController');
      const cur = sc && typeof sc.current === 'function' ? sc.current() : undefined;
      const id = workspaceIdOf(cur);
      if (id) return { id, how: '当前会话' };
    } catch { /* 忽略 */ }
    return { id: '', how: '默认工作区' };
  }

  async function handoffToSession(promptText, root) {
    const sc = svcOfImpl(ctx, 'sessionController');
    if (!sc || typeof sc.create !== 'function' || typeof sc.prompt !== 'function') {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        reason: '本部署未挂载 sessionController，无法自动开会话——请在对话框里粘贴下方提示词继续。',
      };
    }
    const choice = chooseWorkspace(root);
    try {
      const created = await sc.create(choice.id ? { workspaceId: choice.id } : {});
      const sessionId = created && (created.sessionId || created.id);
      if (!sessionId) return { ok: false, code: 'UNAVAILABLE', reason: '会话创建失败：未返回 sessionId' };
      await sc.prompt({
        requestId: `devwork-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: promptText }],
      }, new AbortController().signal);
      return { ok: true, sessionId, workspaceId: choice.id || '', workspaceHow: choice.how || '' };
    } catch (e) {
      return { ok: false, code: 'UNAVAILABLE', reason: '发起会话失败：' + U.errText(e) };
    }
  }

  /* ---------------- HTTP 路由 ---------------- */

  let routesMounted = false;

  function registerRoutes() {
    const ws = svcOfImpl(ctx, 'webServer');
    if (!ws || typeof ws.register !== 'function') { log('webServer 不可用，面板接口未注册'); return; }
    const disposers = [];

    const add = (path, opts, handler) => {
      const dispose = ws.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (!guard(req, res, opts)) return;
          Promise.resolve()
            .then(() => handler(req, res))
            .catch((e) => {
              try {
                log('路由 ' + path + ' 失败：' + U.errText(e));
              } catch { /* 忽略 */ }
              sendError(res, e);
            });
        },
      });
      if (typeof dispose === 'function') disposers.push(dispose);
      else if (dispose && typeof dispose.dispose === 'function') disposers.push(() => dispose.dispose());
    };

    /* ---- 只读：meta / state / stream ---- */

    add(`${API}/meta`, { methods: ['GET'] }, (req, res) => {
      let root = '';
      let how = 'unknown';
      try {
        const r = resolveRoot(ctx, qs(req).root);
        root = r.root;
        how = r.how;
      } catch { /* meta 不因工作区缺失而失败，如实标注 unknown */ }
      const sc = svcOfImpl(ctx, 'sessionController');
      json(res, 200, {
        ok: true,
        name,
        version: VERSION,
        api: API,
        boardFile: S.BOARD_DIR + '/' + S.BOARD_FILE,
        root,
        rootHow: how,
        hasWebServer: true,
        hasSessionController: !!(sc && typeof sc.create === 'function'),
        revision: 1,
        enums: {
          statuses: S.STATUSES.map((id) => ({ id, label: S.STATUS_LABELS[id] })),
          types: S.TYPES.map((id) => ({ id, label: S.TYPE_LABELS[id] })),
          priorities: S.PRIORITIES.slice(),
          linkKinds: S.LINK_KINDS.slice(),
          attentionKinds: S.ATTENTION_KINDS.map((id) => ({ id, label: S.ATTENTION_KIND_LABELS[id] })),
          activityKinds: S.ACTIVITY_KINDS.slice(),
          reportKinds: S.REPORT_KINDS.slice(),
          handoffModes: S.HANDOFF_MODES.slice(),
          autonomy: S.AUTONOMY_MODES.slice(),
          projectStatuses: S.PROJECT_STATUSES.map((id) => ({ id, label: S.PROJECT_STATUS_LABELS[id] })),
          projectColors: S.PROJECT_COLORS.slice(),
        },
        statuses: S.STATUSES.slice(),
        types: S.TYPES.slice(),
        priorities: S.PRIORITIES.slice(),
        projectStatuses: S.PROJECT_STATUSES.slice(),
        projectColors: S.PROJECT_COLORS.slice(),
        stateMachine: { transitions: S.transitionTable(), doneRequiresHuman: true, deleteRequiresHuman: true },
        transitions: S.transitionTable(),
        settings: S.defaultSettings(),
        limits: S.LIMITS,
        tools: ['dev_board', 'dev_item', 'dev_attention', 'dev_brief', 'dev_project'],
        humanOnly: ['task.done', 'task.delete', 'attention.resolve', 'project.delete'],
      });
    });

    add(`${API}/state`, { methods: ['GET'] }, (req, res) => {
      const { root, how } = resolveRoot(ctx, qs(req).root);
      const board = S.loadBoard(root);
      const now = U.nowIso();
      const projects = (Array.isArray(board.projects) ? board.projects : []).map((p) => ({
        ...p,
        stats: S.computeProjectStats(board, p.id, now),
      }));
      json(res, 200, {
        ok: true,
        root,
        rootHow: how,
        rev: board.rev,
        now,
        project: board.project,
        projects,
        settings: board.settings,
        tasks: board.tasks,
        attention: board.attention,
        activity: board.activity,
        stats: S.computeStats(board, now),
      });
    });

    add(`${API}/stream`, { methods: ['GET'] }, (req, res) => {
      let rev = 0;
      try {
        const { root } = resolveRoot(ctx, qs(req).root);
        rev = S.loadBoard(root).rev;
      } catch { rev = 0; }
      try {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`event: hello\ndata: ${JSON.stringify({ rev })}\n\n`);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
      } catch { return; }

      const conn = { res, timer: null, closed: false };
      conn.timer = setInterval(() => {
        try {
          if (res.writableEnded) { closeStream(conn); return; }
          res.write(': ping\n\n');
        } catch {
          closeStream(conn);
        }
      }, 20000);
      if (conn.timer && typeof conn.timer.unref === 'function') conn.timer.unref();
      streams.add(conn);

      const cleanup = () => closeStream(conn);
      req.on('close', cleanup);
      req.on('error', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
    });

    /* ---- 任务（面板路径 by=human） ---- */

    add(`${API}/task/create`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const { board, out } = await mutate(root, (b) => S.createTask(b, body, { by: 'human' }));
      json(res, 200, { ok: true, task: out.task, rev: board.rev });
    });

    add(`${API}/task/update`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const id = U.trimStr(body.id, 40);
      let patch = body.patch;
      if (!U.isPlainObject(patch)) {
        patch = {};
        for (const k of [...S.WRITABLE_TASK_FIELDS, 'status', 'note']) if (k in body) patch[k] = body[k];
      }
      const { board, out } = await mutate(root, (b) => S.updateTask(b, id, patch, { by: 'human' }));
      json(res, 200, { ok: true, task: out.task, changed: out.changed, rev: board.rev });
    });

    add(`${API}/task/move`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const id = U.trimStr(body.id, 40);
      const status = U.trimStr(body.status, 20);
      const note = U.trimStr(body.note, S.LIMITS.note);
      const { board, out } = await mutate(root, (b) => S.moveTask(b, id, status, { by: 'human', note }));
      json(res, 200, { ok: true, task: out.task, rev: board.rev });
    });

    add(`${API}/task/delete`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const id = U.trimStr(body.id, 40);
      const { board, out } = await mutate(root, (b) => S.deleteTask(b, id, { by: 'human' }));
      json(res, 200, { ok: true, id: out.id, rev: board.rev });
    });

    add(`${API}/task/checkin`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const { board, out } = await mutate(root, (b) => S.checkin(b, body, { by: 'human' }));
      json(res, 200, { ok: true, task: out.task, changed: out.changed, rev: board.rev });
    });

    /* ---- 项目（面板路径 by=human；删除仅人，CONTRACT §10.3） ---- */

    add(`${API}/project/create`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const { board, out } = await mutate(root, (b) => S.createProject(b, body, { by: 'human' }));
      json(res, 200, { ok: true, project: out.project, rev: board.rev });
    });

    add(`${API}/project/update`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const ref = U.trimStr(body.id || body.project, 120);
      let patch = body.patch;
      if (!U.isPlainObject(patch)) {
        patch = {};
        for (const k of ['name', 'color', 'description', 'status']) if (k in body) patch[k] = body[k];
      }
      const { board, out } = await mutate(root, (b) => S.updateProject(b, ref, patch, { by: 'human' }));
      json(res, 200, { ok: true, project: out.project, changed: out.changed, rev: board.rev });
    });

    add(`${API}/project/delete`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const ref = U.trimStr(body.id || body.project, 120);
      const opts = { by: 'human' };
      if (Object.prototype.hasOwnProperty.call(body, 'moveTo')) opts.moveTo = body.moveTo;
      const { board, out } = await mutate(root, (b) => S.deleteProject(b, ref, opts));
      json(res, 200, {
        ok: true,
        id: out.id,
        movedTasks: out.movedTasks,
        moveTo: out.moveTo,
        fallbackProject: out.fallbackProject,
        rev: board.rev,
      });
    });

    /* ---- 注意力（面板可 ask / resolve；agent 只能 ask / list） ---- */

    add(`${API}/attention/ask`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const { board, out } = await mutate(root, (b) => S.askAttention(b, body, { by: 'human' }));
      json(res, 200, { ok: true, attention: out.attention, rev: board.rev });
    });

    add(`${API}/attention/resolve`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const id = U.trimStr(body.id, 40);
      const answer = U.trimStr(body.answer, S.LIMITS.answer);
      const { board, out } = await mutate(root, (b) => S.resolveAttention(b, id, answer, { by: 'human' }));
      json(res, 200, { ok: true, attention: out.attention, rev: board.rev });
    });

    /* ---- 设置 ---- */

    add(`${API}/settings/update`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      let patch = body.patch;
      if (!U.isPlainObject(patch)) {
        patch = {};
        for (const k of ['autonomy', 'wipLimit', 'staleDays', 'owner', 'showCanceled']) if (k in body) patch[k] = body[k];
      }
      const { board, out } = await mutate(root, (b) => S.updateSettings(b, patch));
      json(res, 200, { ok: true, settings: out.settings, rev: board.rev });
    });

    /* ---- handoff：发起执行会话 ---- */

    add(`${API}/handoff`, { methods: ['POST'], json: true }, async (req, res) => {
      const body = await readJsonBody(req);
      const { root } = resolveRoot(ctx, rootParam(req, body));
      const mode = body.mode === undefined || body.mode === null || body.mode === '' ? 'work' : String(body.mode);
      if (!S.HANDOFF_MODES.includes(mode)) {
        throw U.fail('INVALID_INPUT', 'mode 只能是 work / review / plan');
      }
      const taskId = U.trimStr(body.taskId, 40);
      const board = S.loadBoard(root);
      const task = taskId ? S.findTask(board, taskId) : null;
      /* prompt 带项目名（§10.3）：优先任务归属项目；无任务时可用 body.projectId 指定 */
      let project = task ? projectOfTask(board, task) : null;
      const projectRef = U.trimStr(body.projectId, 120);
      if (!project && projectRef) project = S.resolveProject(board, projectRef);
      const custom = U.trimStr(body.prompt, 20000);
      const prompt = custom || S.HANDOFF_PROMPT(task, mode, project);

      const r = await handoffToSession(prompt, root);
      if (!r.ok) {
        json(res, 200, { ok: false, code: r.code || 'UNAVAILABLE', reason: r.reason, prompt });
        return;
      }

      /* 记录会话关系（by=human：这是人在面板发起的动作） */
      const { out } = await mutate(root, (b) => {
        if (task) {
          const t = S.findTask(b, task.id);
          t.sessionId = r.sessionId;
          if (!Array.isArray(t.links)) t.links = [];
          t.links = t.links.filter((x) => !(x && x.kind === 'session' && x.ref === r.sessionId));
          t.links.unshift({ kind: 'session', label: '执行会话', ref: r.sessionId });
          if (t.links.length > S.LIMITS.linksMax) t.links = t.links.slice(0, S.LIMITS.linksMax);
          t.updatedAt = U.nowIso();
          S.addActivity(b, { by: 'human', kind: 'update', taskId: t.id, text: '发起执行会话（' + mode + '）' });
          S.bump(b);
          return t;
        }
        S.addActivity(b, { by: 'human', kind: 'update', text: '发起执行会话（' + mode + '，未指定任务）' });
        S.bump(b);
        return null;
      });

      json(res, 200, {
        ok: true,
        sessionId: r.sessionId,
        workspaceId: r.workspaceId || '',
        workspaceHow: r.workspaceHow || '',
        task: out || null,
        prompt,
      });
    });

    effect(() => () => {
      for (const d of disposers) {
        try {
          if (typeof d === 'function') d();
          else if (d && typeof d.dispose === 'function') d.dispose();
        } catch { /* 忽略单个清理失败 */ }
      }
    }, 'dsh-devwork: routes');

    log('面板路由已注册（' + disposers.length + ' 条）');
  }

  /* ---------------- agent 工具 ---------------- */

  function registerTools() {
    const tools = svcOfImpl(ctx, 'tools');
    if (!tools || typeof tools.register !== 'function') { log('tools 服务不可用'); return; }

    /* 4.5 dev_project（v2 项目，CONTRACT §10.4） */
    tools.register({
      name: 'dev_project',
      description: '开发工作台：项目（多项目并行）。list=项目列表 + 统计；create=新建项目（名称唯一，颜色 8 色预设，最多 50 个）；update=改名称/颜色/描述/状态。删除项目只能由人在面板执行——本工具没有 delete，传入 delete 一律返回 HUMAN_ONLY。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'update', 'delete'], description: 'list=查看；create=新建；update=修改；delete=拒绝（只能由人）' },
          id: { type: 'string', description: '项目 id（update 必填；也可用 project）' },
          project: { type: 'string', description: '项目 id 或名称（update 用，替代 id）' },
          name: { type: 'string', description: 'create/update：项目名称（1–80 字，不允许重名）' },
          color: { type: 'string', description: 'create/update：颜色 #RRGGBB（缺省 #5B7CFA）' },
          description: { type: 'string', description: 'create/update：项目描述（≤2000 字）' },
          status: { type: 'string', enum: ['active', 'paused', 'done'], description: 'update：项目状态' },
          patch: { type: 'object', description: 'update 的 patch：{name?,color?,description?,status?}' },
          root: { type: 'string', description: '工作区根目录（可选）' },
        },
        required: ['action'],
      },
      output: { schema: { type: 'object' }, render: (_a, v) => text(v && v.text) },
      execute(args) {
        try {
          const a = args || {};
          const action = U.trimStr(a.action, 20) || 'list';
          const { root, how } = toolRoot(a);

          if (action === 'delete') {
            return Promise.resolve({
              text: '拒绝（只能由人执行）：删除项目只能由人在「开发工作台」面板的「项目」视图执行（红线）。如需清理，先用 dev_item action=update project=<其他项目> 把任务改归或改为未归属，再请人在面板删除。',
              ok: false,
              code: 'HUMAN_ONLY',
              reason: '删除项目只能由人在面板执行',
            });
          }
          if (!['list', 'create', 'update'].includes(action)) {
            throw U.fail('INVALID_INPUT', '未知 action：' + action);
          }

          if (action === 'list') {
            const board = S.loadBoard(root);
            const now = U.nowIso();
            const projects = (Array.isArray(board.projects) ? board.projects : []).map((p) => ({
              ...p,
              stats: S.computeProjectStats(board, p.id, now),
            }));
            const lines = [`开发工作台 · 项目 ${projects.length} 个（工作区：${root}，依据：${how}）`];
            for (const p of projects) lines.push(projectLine(p));
            const unassigned = (Array.isArray(board.tasks) ? board.tasks : []).filter((t) => t && !t.projectId).length;
            if (unassigned) lines.push(`未归属任务：${unassigned} 个（dev_item action=update project=<项目> 改归）`);
            lines.push('');
            lines.push('新建：dev_project action=create name=…；删除只能由人在面板执行。');
            return Promise.resolve({
              text: lines.join('\n'), ok: true, root, rootHow: how, projects, rev: board.rev,
            });
          }

          if (action === 'create') {
            const patch = U.isPlainObject(a.patch) ? a.patch : {};
            const input = {
              name: a.name !== undefined ? a.name : patch.name,
              color: a.color !== undefined ? a.color : patch.color,
              description: a.description !== undefined ? a.description : patch.description,
            };
            return S.mutateBoard(root, (b) => S.createProject(b, input, { by: 'agent' })).then((r) => {
              broadcast(r.board.rev);
              const p = r.out.project;
              return {
                text: `已创建项目 ${p.id} · ${p.name}（${S.projectStatusLabel(p.status)}｜${p.color}）\n下一步：dev_item action=create project=${p.id} 在项目里建任务；dev_board project=${p.id} 查看该项目。`,
                ok: true,
                root,
                project: p,
                rev: r.board.rev,
              };
            }).catch((e) => toolFail(e));
          }

          /* update */
          const ref = U.trimStr(a.id, 120) || U.trimStr(a.project, 120);
          if (!ref) throw U.fail('INVALID_INPUT', 'update 必须提供项目 id 或名称（id / project）');
          const patch = U.isPlainObject(a.patch) ? { ...a.patch } : {};
          for (const k of ['name', 'color', 'description', 'status']) {
            if (a[k] !== undefined && patch[k] === undefined) patch[k] = a[k];
          }
          if (!Object.keys(patch).length) {
            throw U.fail('INVALID_INPUT', 'update 至少提供 name / color / description / status 之一');
          }
          return S.mutateBoard(root, (b) => S.updateProject(b, ref, patch, { by: 'agent' })).then((r) => {
            broadcast(r.board.rev);
            const p = r.out.project;
            const ch = r.out.changed;
            return {
              text: ch.length
                ? `已更新项目 ${p.id} · ${p.name}：${ch.join('、')}`
                : `项目 ${p.id} 没有字段变化（未写入）。`,
              ok: true,
              root,
              project: p,
              changed: ch,
              rev: r.board.rev,
            };
          }).catch((e) => toolFail(e));
        } catch (e) {
          return Promise.resolve(toolFail(e));
        }
      },
      presentCall: (a) => ({
        card: 'generic',
        title: '开发工作台项目：' + String((a && a.action) || 'list'),
        kind: a && (a.action === 'create' || a.action === 'update') ? 'edit' : 'read',
      }),
    });

    /* 4.1 dev_board */
    tools.register({
      name: 'dev_board',
      description: '开发工作台：读看板。view=board（按状态分组清单）/ brief（今日简报）/ task（单任务全文）/ stats（统计）/ projects（项目总览）；只读。用户问「今天做什么 / 任务到哪一步 / 有什么卡住」时先调用本工具。可用 project 按项目过滤（id 或名称）。',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['board', 'brief', 'task', 'stats', 'projects'], description: '视图，默认 board' },
          id: { type: 'string', description: '任务 id（view=task 时必填）' },
          project: { type: 'string', description: '按项目过滤（项目 id 或名称，支持模糊匹配）' },
          status: { type: 'string', description: '按状态过滤：todo|doing|review|blocked|done|canceled' },
          type: { type: 'string', description: '按类型过滤：design|product|dev|qa|research|ops' },
          priority: { type: 'string', description: '按优先级过滤：P0|P1|P2|P3' },
          owner: { type: 'string', description: '按负责人过滤（包含匹配）' },
          q: { type: 'string', description: '按标题 / 描述 / 标签模糊搜索' },
          root: { type: 'string', description: '工作区根目录（可选，默认自动探测）' },
        },
      },
      output: { schema: { type: 'object' }, render: (_a, v) => text(v && v.text) },
      execute(args) {
        try {
          const a = args || {};
          const { root, how } = toolRoot(a);
          const board = S.loadBoard(root);
          const view = ['board', 'brief', 'task', 'stats', 'projects'].includes(a.view) ? a.view : 'board';
          const now = U.nowIso();
          const projectRef = U.trimStr(a.project, 120);
          const project = projectRef ? S.resolveProject(board, projectRef, { fuzzy: true }) : null;

          if (view === 'projects') {
            const r = projectsText(board, now, project);
            return Promise.resolve({
              text: r.text, ok: true, root, rootHow: how, rev: board.rev,
              projects: r.projects, stats: S.computeStats(board, now),
            });
          }
          if (view === 'task') {
            const id = U.trimStr(a.id, 40);
            if (!id) throw U.fail('INVALID_INPUT', 'view=task 时必须提供 id');
            const task = S.findTask(board, id);
            return Promise.resolve({ text: taskText(task, board), ok: true, root, rootHow: how, task, rev: board.rev });
          }
          if (view === 'stats') {
            if (project) {
              const pstats = S.computeProjectStats(board, project.id, now);
              return Promise.resolve({
                text: projectStatsText(board, project, now), ok: true, root, rootHow: how,
                project, projectStats: pstats, rev: board.rev,
              });
            }
            const stats = S.computeStats(board, now);
            return Promise.resolve({ text: statsText(stats), ok: true, root, rootHow: how, stats, rev: board.rev });
          }
          if (view === 'brief') {
            const brief = S.buildBrief(board, { period: 'today', projectId: project ? project.id : '' });
            return Promise.resolve({
              text: briefText(brief, null, board), ok: true, root, rootHow: how,
              brief, project: project || null, rev: board.rev,
            });
          }

          const tasks = filterTasks(board.tasks, a, project ? project.id : '');
          return Promise.resolve({
            text: boardText(board, tasks, root, how, a, project),
            ok: true,
            root,
            rootHow: how,
            rev: board.rev,
            project: project ? { id: project.id, name: project.name, color: project.color, status: project.status } : null,
            stats: S.computeStats(board, now),
            tasks,
            settings: board.settings,
          });
        } catch (e) {
          return Promise.resolve(toolFail(e));
        }
      },
      presentCall: () => ({ card: 'generic', title: '开发工作台', kind: 'read' }),
    });

    /* 4.2 dev_item */
    tools.register({
      name: 'dev_item',
      description: '开发工作台：任务建 / 改 / 移 / 回报。create/update 可用 project（项目 id 或名称）指定归属；未知项目会报错并提示 dev_project list。report 回报进度：progress（进行中）/ ready（只进待验收，不会自动完成）/ blocked（受阻并生成注意力）/ failed（保持进行中并生成注意力）/ dropped（取消）。标记 done 与删除只能由人在面板执行。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'move', 'report'], description: 'create=建任务；update=改字段；move=移泳道；report=回报' },
          id: { type: 'string', description: '任务 id（update / move / report 必填）' },
          patch: { type: 'object', description: 'create/update 可写字段：title/description/type/priority/owner/due/estimate/spent/progress/tags/checklist/artifacts/links/dependencies/blockedReason/reviewNote/projectId' },
          project: { type: 'string', description: '项目 id 或名称（create/update 用；assigns projectId）' },
          status: { type: 'string', enum: ['todo', 'doing', 'review', 'blocked', 'canceled'], description: 'move 的目标状态（done 只能由人）' },
          note: { type: 'string', description: 'move 的备注（≤500 字）' },
          report: {
            type: 'object',
            description: '回报体：{kind, text（≤300 字摘要）, artifacts（文件路径数组）}',
            properties: {
              kind: { type: 'string', enum: ['progress', 'ready', 'blocked', 'failed', 'dropped'] },
              text: { type: 'string' },
              artifacts: { type: 'array', items: { type: 'string' } },
            },
            required: ['kind', 'text'],
          },
          root: { type: 'string', description: '工作区根目录（可选）' },
        },
        required: ['action'],
      },
      output: { schema: { type: 'object' }, render: (_a, v) => text(v && v.text) },
      execute(args) {
        try {
          const a = args || {};
          const action = U.trimStr(a.action, 20);
          if (!action) throw U.fail('INVALID_INPUT', 'action 不能为空');
          if (action === 'delete') {
            return Promise.resolve({
              text: '拒绝：删除任务只能由人在「开发工作台」面板执行（红线）。删除会丢失任务历史，请让人在面板确认。',
              ok: false,
              code: 'HUMAN_ONLY',
              reason: '删除任务只能由人在面板执行',
            });
          }
          if (!['create', 'update', 'move', 'report'].includes(action)) {
            throw U.fail('INVALID_INPUT', '未知 action：' + action);
          }
          const { root } = toolRoot(a);
          const by = 'agent';

          if (action === 'create') {
            const patch = U.isPlainObject(a.patch) ? a.patch : {};
            const input = { ...patch };
            for (const k of [...S.WRITABLE_TASK_FIELDS, 'status']) {
              if (patch[k] === undefined && a[k] !== undefined) input[k] = a[k];
            }
            const projectRef = U.trimStr(a.project, 120) || U.trimStr(patch.project, 120);
            return S.mutateBoard(root, (b) => {
              /* §10.4：project（id 或名称）→ projectId；未知项目抛 INVALID_INPUT 并提示 dev_project list */
              if (projectRef) input.projectId = S.resolveProject(b, projectRef, { fuzzy: true }).id;
              return S.createTask(b, input, { by });
            }).then((r) => {
              broadcast(r.board.rev);
              const t = r.out.task;
              const pname = S.projectName(r.board, t.projectId) || '未归属';
              return {
                text: `已创建任务 ${t.id} · ${t.title}（${S.typeLabel(t.type)}｜${t.priority}｜${S.statusLabel(t.status)}｜项目 ${pname}）\n下一步：dev_item action=move status=doing 开始；完成后用 action=report 回报。`,
                ok: true,
                root,
                task: t,
                rev: r.board.rev,
              };
            }).catch((e) => toolFail(e));
          }

          if (action === 'update') {
            const id = U.trimStr(a.id, 40);
            const patch = U.isPlainObject(a.patch) ? a.patch : {};
            const projectRef = U.trimStr(a.project, 120) || U.trimStr(patch.project, 120);
            return S.mutateBoard(root, (b) => {
              const p = { ...patch };
              if (projectRef) p.projectId = S.resolveProject(b, projectRef, { fuzzy: true }).id;
              return S.updateTask(b, id, p, { by });
            }).then((r) => {
              broadcast(r.board.rev);
              const t = r.out.task;
              const ch = r.out.changed;
              const pname = S.projectName(r.board, t.projectId) || '未归属';
              return {
                text: ch.length
                  ? `已更新任务 ${t.id}：${ch.join('、')}\n当前：${S.statusLabel(t.status)}｜${t.priority}｜项目 ${pname}${t.due ? '｜到期 ' + t.due : ''}`
                  : `任务 ${t.id} 没有字段变化（未写入）。`,
                ok: true,
                root,
                task: t,
                changed: ch,
                rev: r.board.rev,
              };
            }).catch((e) => toolFail(e));
          }

          if (action === 'move') {
            const id = U.trimStr(a.id, 40);
            const status = U.trimStr(a.status, 20);
            const note = U.trimStr(a.note, S.LIMITS.note);
            if (!status) throw U.fail('INVALID_INPUT', 'move 必须提供 status');
            if (status === 'done') throw U.fail('HUMAN_ONLY', '任务完成（done）只能由人在面板验收');
            return S.mutateBoard(root, (b) => S.moveTask(b, id, status, { by, note })).then((r) => {
              broadcast(r.board.rev);
              const t = r.out.task;
              const hint = t.status === 'review'
                ? '\n已进入待验收：done 只能由人在面板点。'
                : (t.status === 'blocked' ? '\n已标记受阻：建议用 dev_attention action=ask 说明卡点，等人处理。' : '');
              return {
                text: `已移动 ${t.id}：${S.statusLabel(r.out.from)} → ${S.statusLabel(t.status)}${note ? '｜' + note : ''}${hint}`,
                ok: true,
                root,
                task: t,
                rev: r.board.rev,
              };
            }).catch((e) => toolFail(e));
          }

          /* report */
          const id = U.trimStr(a.id, 40);
          const report = U.isPlainObject(a.report)
            ? a.report
            : { kind: a.reportKind || a.kind, text: a.reportText || a.text, artifacts: a.reportArtifacts || a.artifacts };
          return S.mutateBoard(root, (b) => S.reportTask(b, id, report, { by })).then((r) => {
            broadcast(r.board.rev);
            const t = r.out.task;
            const att = r.out.attention;
            const lines = [`已回报（${r.out.kind}）：${t.title}（${t.id}）→ ${S.statusLabel(t.status)}｜项目 ${S.projectName(r.board, t.projectId) || '未归属'}`];
            if (r.out.kind === 'ready') lines.push('已进入待验收：done 只能由人在面板点，不会自动完成。');
            if (att) lines.push(`已生成注意力 ${att.id}：${oneLine(att.question, 80)}（等待人在面板处理）`);
            lines.push('提示：需要人决定的问题用 dev_attention action=ask。');
            return {
              text: lines.join('\n'),
              ok: true,
              root,
              task: t,
              attention: att || null,
              rev: r.board.rev,
            };
          }).catch((e) => toolFail(e));
        } catch (e) {
          return Promise.resolve(toolFail(e));
        }
      },
      presentCall: (a) => ({ card: 'generic', title: '开发工作台任务：' + String((a && a.action) || ''), kind: a && a.action === 'report' ? 'read' : 'edit' }),
    });

    /* 4.3 dev_attention */
    tools.register({
      name: 'dev_attention',
      description: '开发工作台：注意力（唯一通道）。ask=向人提问（生成待决定 / 待处理；可用 project 关联项目）；list=查看未处理的注意力；resolve 被拒绝——人只能在面板回答。需要人决定时用它，不要替人决定。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['ask', 'list', 'resolve'], description: 'ask=提问；list=查看未处理；resolve=拒绝（只能由人回答）' },
          question: { type: 'string', description: '要人回答的问题（ask 必填）' },
          kind: { type: 'string', enum: ['decision', 'blocked', 'question', 'review'], description: '注意力类型，默认 decision' },
          target: { type: 'string', description: '关联任务 id（可选）' },
          project: { type: 'string', description: '关联项目 id 或名称（ask 可选；给定时 target={kind:"project",id}）' },
          id: { type: 'string', description: '注意力 id（resolve 用，agent 会被拒绝）' },
          answer: { type: 'string', description: '回答（resolve 用，agent 会被拒绝）' },
          root: { type: 'string', description: '工作区根目录（可选）' },
        },
        required: ['action'],
      },
      output: { schema: { type: 'object' }, render: (_a, v) => text(v && v.text) },
      execute(args) {
        try {
          const a = args || {};
          const action = U.trimStr(a.action, 20) || 'list';
          if (action === 'resolve') {
            return Promise.resolve({
              text: '拒绝：注意力只能由人在「开发工作台」面板回答（红线）。如果问题需要人拍板，用 action=ask 提出并等待。',
              ok: false,
              code: 'HUMAN_ONLY',
              reason: '注意力只能由人在面板回答',
            });
          }
          const { root, how } = toolRoot(a);
          if (action === 'ask') {
            const question = U.trimStr(a.question, S.LIMITS.question);
            if (!question) throw U.fail('INVALID_INPUT', 'ask 必须提供 question');
            const kind = a.kind === undefined || a.kind === null ? 'decision' : String(a.kind);
            const projectRef = U.trimStr(a.project, 120);
            return S.mutateBoard(root, (b) => {
              let target = a.target;
              if (projectRef) {
                /* §10.4：project（id 或名称）→ target {kind:'project', id} */
                const p = S.resolveProject(b, projectRef, { fuzzy: true });
                target = { kind: 'project', id: p.id };
              }
              return S.askAttention(b, { question, kind, target }, { by: 'agent' });
            }).then((r) => {
              broadcast(r.board.rev);
              const att = r.out.attention;
              const tgt = att.target && att.target.kind === 'project'
                ? `（项目 ${S.projectName(r.board, att.target.id) || att.target.id}）`
                : '';
              return {
                text: `已生成注意力 ${att.id}（${S.attentionKindLabel(att.kind)}）${tgt}：${oneLine(att.question, 100)}\n请在左侧「开发工作台」面板回答；agent 不会代答。`,
                ok: true,
                root,
                attention: att,
                rev: r.board.rev,
              };
            }).catch((e) => toolFail(e));
          }
          if (action !== 'list') throw U.fail('INVALID_INPUT', '未知 action：' + action);
          const board = S.loadBoard(root);
          const open = S.listAttention(board);
          const lines = [`开发工作台 · 未处理注意力 ${open.length} 条（工作区：${root}，依据：${how}）`];
          for (const att of open) {
            const tgt = att.target && att.target.kind === 'task'
              ? '任务 ' + att.target.id
              : (att.target && att.target.kind === 'project'
                ? '项目 ' + (S.projectName(board, att.target.id) || att.target.id)
                : '看板');
            lines.push(`- ${att.id}｜${S.attentionKindLabel(att.kind)}｜${tgt}｜${oneLine(att.question, 100)}｜提出于 ${att.askedAt.slice(0, 16).replace('T', ' ')}`);
          }
          if (!open.length) lines.push('（没有待处理的注意力）');
          lines.push('回答只能由人在面板操作；agent 只能 ask / list。');
          return Promise.resolve({ text: lines.join('\n'), ok: true, root, rootHow: how, attention: open, rev: board.rev });
        } catch (e) {
          return Promise.resolve(toolFail(e));
        }
      },
      presentCall: (a) => ({ card: 'generic', title: '开发工作台注意力：' + String((a && a.action) || 'list'), kind: a && a.action === 'ask' ? 'edit' : 'read' }),
    });

    /* 4.4 dev_brief */
    tools.register({
      name: 'dev_brief',
      description: '开发工作台：今日 / 本周简报——焦点（进行中 / 今日到期 / 已逾期 / 受阻 / 待验收 / 停滞）+ 统计 + 建议。可用 project 只看某个项目（抬头带项目名）。apply=true 时按 settings.autonomy 执行安全动作（默认 observe 只建议：给受阻且无下一步日期的任务追加提示，不建重复任务）。',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'week'], description: '周期，默认 today' },
          project: { type: 'string', description: '按项目过滤（id 或名称）；抬头带项目名' },
          apply: { type: 'boolean', description: '是否按自主性模式执行安全动作，默认 false' },
          root: { type: 'string', description: '工作区根目录（可选）' },
        },
      },
      output: { schema: { type: 'object' }, render: (_a, v) => text(v && v.text) },
      execute(args) {
        try {
          const a = args || {};
          const { root, how } = toolRoot(a);
          const period = a.period === 'week' ? 'week' : 'today';
          const board = S.loadBoard(root);
          const projectRef = U.trimStr(a.project, 120);
          const project = projectRef ? S.resolveProject(board, projectRef, { fuzzy: true }) : null;
          const projectId = project ? project.id : '';
          let current = board;
          let applied = null;
          let brief = S.buildBrief(current, { period, projectId });
          const doApply = a.apply === true;
          if (doApply) {
            const autonomy = current.settings && current.settings.autonomy;
            if (autonomy === 'observe' || !S.AUTONOMY_MODES.includes(autonomy)) {
              applied = { applied: [], skipped: 'observe' };
            } else {
              return S.mutateBoard(root, (b) => S.applyBriefActions(b, { period, projectId })).then((r) => {
                broadcast(r.board.rev);
                current = r.board;
                applied = r.out;
                brief = S.buildBrief(current, { period, projectId });
                return {
                  text: briefText(brief, applied, current),
                  ok: true,
                  root,
                  rootHow: how,
                  project: brief.project,
                  brief,
                  applied: applied.applied,
                  rev: current.rev,
                };
              }).catch((e) => toolFail(e));
            }
          }
          return Promise.resolve({
            text: briefText(brief, applied, current),
            ok: true,
            root,
            rootHow: how,
            project: brief.project,
            brief,
            applied: applied ? applied.applied : [],
            rev: current.rev,
          });
        } catch (e) {
          return Promise.resolve(toolFail(e));
        }
      },
      presentCall: () => ({ card: 'generic', title: '开发工作台简报', kind: 'read' }),
    });

    log('agent 工具已注册：dev_board / dev_item / dev_attention / dev_brief / dev_project');
  }

  /* ---------------- 系统提示词（CONTRACT §7 逐字） ---------------- */

  function registerPrompt() {
    const sp = svcOfImpl(ctx, 'systemPrompt');
    if (!sp || typeof sp.section !== 'function') { log('systemPrompt 服务不可用'); return; }
    let order = 2950;
    try {
      if (typeof sp.getSectionOrder === 'function') {
        const o = sp.getSectionOrder('TOOL_REPORT');
        if (Number.isFinite(Number(o))) order = Number(o);
      }
    } catch { /* 用默认 order */ }

    sp.section({
      name: 'tool:dsh-devwork',
      order,
      text: [
        '开发工作台 · 插件已装配（面板在左侧「开发工作台」）。',
        '',
        '【身份】你是开发工作台的编排者：任务（task）在 5 列看板流转（待办 / 进行中 / 待验收 / 受阻 / 已完成），类型分设计、产品、开发、测试、调研、运维；需要人决定的事进注意力（attention）。',
        '',
        '【何时启用】用户问「今天做什么 / 任务到哪一步 / 有什么卡住」，或要求拆需求、排期、跟踪进度时：先 `dev_board`（view=brief）读状态，再执行。',
        '',
        '【状态落点】`<工作区>/.devwork/board.json`，只通过 `dev_board`/`dev_item`/`dev_attention`/`dev_brief` 与面板读写，不要手改文件。',
        '',
        '【工具边界】`dev_board` 只读；`dev_item` 建/改/移/回报；`dev_attention` 提问与查看；`dev_brief` 今日简报。不存在删除工具。',
        '',
        '【状态机】待办 → 进行中 → 待验收 → 已完成（`done` 只能由人验收）；受阻是异常停留列，恢复后回到进行中或待验收，须由人确认。',
        '',
        '【回报协议】执行完成后用 `dev_item` action=report 回报：progress（进行中）/ ready（待验收，只进待验收，不会自动完成）/ blocked（受阻并生成注意力）/ failed（保持进行中并生成注意力）/ dropped。摘要 ≤300 字 + artifacts 文件路径；长文写文件。',
        '',
        '【红线】① 标记任务完成（done）② 删除任务 ③ 代替人回答注意力 ④ 对外发送材料 —— 只能由人做。agent 只准备、建议、提问、提醒。',
        '',
        '【项目与并行】任务必须归属项目（`dev_project list` 查看；`dev_item create/update` 传 `project`）。',
        '多个项目可同时推进：默认在「全部项目」下工作，需要聚焦时用 `dev_board project=<id或名称>` 过滤；',
        '跨项目排期用 `dev_brief`。新建项目用 `dev_project create`；删除项目只能由人在面板执行。',
      ].join('\n'),
    });
    log('系统提示词已注册（order=' + order + '）');
  }

  /* ---------------- 挂载 ---------------- */

  const mountRoutes = () => {
    if (routesMounted) return;
    routesMounted = true;
    try {
      registerRoutes();
    } catch (e) {
      log('路由注册失败：' + U.errText(e));
    }
  };

  try {
    if (svcOfImpl(ctx, 'webServer')) mountRoutes();
    else if (typeof ctx.inject === 'function') {
      /* webServer 不是必需服务：就绪后再挂路由（非 Web 组合跳过）。 */
      try {
        ctx.inject(['webServer'], () => mountRoutes());
      } catch (e) {
        log('等待 webServer 失败（' + U.errText(e) + '），跳过路由');
      }
    } else {
      log('无 webServer 且 ctx.inject 不可用，跳过面板接口（工具与提示词照常）');
    }
  } catch (e) {
    log('路由挂载异常：' + U.errText(e));
  }

  try { registerTools(); } catch (e) { log('工具注册失败：' + U.errText(e)); }
  try { registerPrompt(); } catch (e) { log('提示词注册失败：' + U.errText(e)); }

  log('apply 完成');
}

export default { apply, inject, name };
