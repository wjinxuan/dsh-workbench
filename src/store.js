/**
 * dsh-devwork · 宿主半 · 看板存储与领域逻辑
 *
 * 数据文件：`<工作区根>/.devwork/board.json`（唯一事实源）。
 *
 * 约定：
 * - 所有变更函数入参/出参都是普通对象；非法输入抛 DevworkError（带 code）。
 * - `rev` 每次成功写入 +1；`seq` 自增永不复用（任务 T- / 注意力 A- / 项目 P- 共用一个 seq）。
 * - v2（CONTRACT §10）：projects + tasks[].projectId；v1 板读入即迁移（normalizeBoard，不丢任务）。
 * - v3（CONTRACT §11）：项目可绑定 DSH 工作区（workspaceId/workspacePath/workspaceTitle 快照）；
 *   v2 板读入即迁移（补空串，其余不变）。空间解析由 index.js 传入 registry 列表。
 * - `activity` 只保留最近 100 条（按时间顺序追加，最新在末尾）。
 * - 读-改-写通过同进程串行 promise 队列（mutateBoard），避免并发互相覆盖。
 */

import { join } from 'node:path';
import {
  nowIso, localDateStr, weekStartDateStr, weekEndDateStr, formatId, idSeq,
  trimStr, clampInt, clampNum, isPlainObject, isDateStr, isIso, fail, normPath,
  atomicWriteJson, readJsonSafe, TASK_ID_RE, ATTENTION_ID_RE, PROJECT_ID_RE,
} from './util.js';

/* ---------------- 常量 ---------------- */

export const BOARD_DIR = '.devwork';
export const BOARD_FILE = 'board.json';
export const BOARD_VERSION = 3;

export const STATUSES = ['todo', 'doing', 'review', 'blocked', 'done', 'canceled'];
export const TYPES = ['design', 'product', 'dev', 'qa', 'research', 'ops'];
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const LINK_KINDS = ['session', 'doc', 'url', 'spec'];
export const ATTENTION_KINDS = ['decision', 'blocked', 'question', 'review'];
export const ACTIVITY_KINDS = ['create', 'update', 'move', 'report', 'checkin', 'attention', 'delete', 'settings'];
export const ACTIVITY_BY = ['human', 'agent', 'system'];
export const AUTONOMY_MODES = ['observe', 'assisted', 'auto'];
export const REPORT_KINDS = ['progress', 'ready', 'blocked', 'failed', 'dropped'];
export const HANDOFF_MODES = ['work', 'review', 'plan'];
export const ACTIVITY_MAX = 100;

/* v2 项目（CONTRACT §10.1）：与 client.js 的 PROJECT_COLORS / PROJECT_STATUS 同源。 */
export const PROJECT_STATUSES = ['active', 'paused', 'done'];
export const PROJECT_COLORS = Object.freeze([
  '#5B7CFA', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#64748B',
]);
export const DEFAULT_PROJECT_COLOR = '#5B7CFA';
export const DEFAULT_PROJECT_NAME = '默认项目';

export const DEFAULT_SETTINGS = Object.freeze({
  autonomy: 'observe',
  wipLimit: 3,
  staleDays: 3,
  owner: '我',
  showCanceled: false,
});

export const LIMITS = Object.freeze({
  title: 200,
  description: 8000,
  name: 40,
  tag: 40,
  path: 500,
  activityText: 200,
  reportText: 300,
  question: 2000,
  answer: 2000,
  note: 500,
  tagsMax: 20,
  checklistMax: 100,
  artifactsMax: 50,
  linksMax: 50,
  dependenciesMax: 20,
  projectName: 80,
  projectDescription: 2000,
  projectsMax: 50,
  workspaceId: 200,
  workspaceTitle: 200,
  workspacePath: 2000,
  workspaceRef: 500,
});

export const STATUS_LABELS = Object.freeze({
  todo: '待办', doing: '进行中', review: '待验收', blocked: '受阻', done: '已完成', canceled: '已取消',
});

export const TYPE_LABELS = Object.freeze({
  design: '设计', product: '产品逻辑', dev: '开发', qa: '测试', research: '调研', ops: '运维',
});

export const ATTENTION_KIND_LABELS = Object.freeze({
  decision: '待决定', blocked: '受阻', question: '问题', review: '待验收',
});

export const PROJECT_STATUS_LABELS = Object.freeze({
  active: '进行中', paused: '已暂停', done: '已结束',
});

/* 状态机（CONTRACT §2）：方向不可跳级，done 只能由人进入。 */
const TRANSITIONS = Object.freeze({
  todo: ['doing', 'blocked', 'canceled'],
  doing: ['review', 'blocked', 'todo'],
  review: ['doing', 'done', 'canceled'],
  blocked: ['doing', 'todo', 'canceled'],
  done: ['review', 'todo'],
  canceled: ['todo'],
});

export function statusLabel(s) { return STATUS_LABELS[s] || String(s || ''); }
export function typeLabel(t) { return TYPE_LABELS[t] || String(t || ''); }
export function attentionKindLabel(k) { return ATTENTION_KIND_LABELS[k] || String(k || ''); }
export function projectStatusLabel(s) { return PROJECT_STATUS_LABELS[s] || String(s || ''); }

/** 允许的流转表（快照，供 /meta 只读暴露）。 */
export function transitionTable() {
  const out = {};
  for (const s of STATUSES) out[s] = TRANSITIONS[s].slice();
  return out;
}

/** from → to 是否合法（严格按 CONTRACT §2 表；同状态不算流转）。 */
export function allowedTransition(from, to) {
  const f = String(from || '');
  const t = String(to || '');
  if (!STATUSES.includes(f) || !STATUSES.includes(t)) return false;
  return TRANSITIONS[f].includes(t);
}

/* ---------------- 空板与规范化 ---------------- */

export function boardPath(root) {
  return join(root, BOARD_DIR, BOARD_FILE);
}

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function emptyBoard(workspace) {
  const now = nowIso();
  return {
    version: BOARD_VERSION,
    rev: 0,
    seq: 1,
    project: { name: '开发工作台', workspace: String(workspace || '') },
    settings: defaultSettings(),
    /* v2：空板自带默认项目（§10.1，seq >= 1） */
    projects: [defaultProject(now)],
    tasks: [],
    attention: [],
    activity: [],
    updatedAt: now,
  };
}

/** 默认项目（`P-1`「默认项目」）。 */
export function defaultProject(now) {
  const at = isIso(now) ? new Date(now).toISOString() : nowIso();
  return {
    id: 'P-1',
    name: DEFAULT_PROJECT_NAME,
    color: DEFAULT_PROJECT_COLOR,
    description: '',
    status: 'active',
    /* v3（§11.1）：空串 = 未绑定空间 */
    workspaceId: '',
    workspacePath: '',
    workspaceTitle: '',
    createdAt: at,
    updatedAt: at,
  };
}

/** 任务字段默认值（normalizeTask 的骨架）。 */
export function taskDefaults() {
  return {
    id: '', title: '', description: '', type: 'dev', status: 'todo', priority: 'P2',
    owner: '', due: '', estimate: 0, spent: 0, progress: 0, tags: [],
    checklist: [], artifacts: [], links: [], dependencies: [],
    blockedReason: '', reviewNote: '', sessionId: '', startedAt: '', doneAt: '',
    projectId: '',
    createdAt: '', updatedAt: '',
  };
}

function normStringArray(v, maxLen, maxCount) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const it of v) {
    const s = trimStr(it, maxLen);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxCount) break;
  }
  return out;
}

function normChecklist(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (let i = 0; i < v.length && out.length < LIMITS.checklistMax; i++) {
    const it = v[i];
    if (typeof it === 'string') {
      const text = trimStr(it, LIMITS.title);
      if (text) out.push({ id: 'c' + (out.length + 1), text, done: false });
      continue;
    }
    if (!isPlainObject(it)) continue;
    const text = trimStr(it.text, LIMITS.title);
    if (!text) continue;
    const id = trimStr(it.id, 20) || 'c' + (out.length + 1);
    out.push({ id, text, done: it.done === true });
  }
  return out;
}

function normArtifacts(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const it of v) {
    let label = '';
    let path = '';
    if (typeof it === 'string') {
      path = trimStr(it, LIMITS.path);
    } else if (isPlainObject(it)) {
      label = trimStr(it.label, LIMITS.name);
      path = trimStr(it.path, LIMITS.path);
    }
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ label: label || path.split(/[\\/]/).pop() || path, path });
    if (out.length >= LIMITS.artifactsMax) break;
  }
  return out;
}

function normLinks(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const it of v) {
    if (!isPlainObject(it)) continue;
    const kind = LINK_KINDS.includes(it.kind) ? it.kind : 'url';
    const label = trimStr(it.label, LIMITS.name);
    const ref = trimStr(it.ref, LIMITS.path);
    if (!ref) continue;
    out.push({ kind, label: label || ref, ref });
    if (out.length >= LIMITS.linksMax) break;
  }
  return out;
}

function normIsoOrEmpty(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = trimStr(v, 60);
  if (!s) return '';
  return isIso(s) ? new Date(s).toISOString() : '';
}

/* ---------------- 项目（CONTRACT §10） ---------------- */

/** 颜色必须是 #RRGGBB。 */
export function isProjectColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

/** 项目字段默认值（normalizeProject 骨架）。 */
export function projectDefaults() {
  return {
    id: '', name: '', color: DEFAULT_PROJECT_COLOR, description: '',
    status: 'active',
    /* v3（§11.1）：空间快照，空串合法 */
    workspaceId: '', workspacePath: '', workspaceTitle: '',
    createdAt: '', updatedAt: '',
  };
}

/** 规范化项目：修 id 形状、裁剪长度、非法枚举回默认。 */
export function normalizeProject(raw, opts = {}) {
  const r = isPlainObject(raw) ? raw : {};
  const now = isIso(opts.now) ? new Date(opts.now).toISOString() : nowIso();
  const p = projectDefaults();
  p.id = PROJECT_ID_RE.test(trimStr(r.id, 20)) ? trimStr(r.id, 20) : '';
  p.name = trimStr(r.name, LIMITS.projectName);
  p.color = isProjectColor(r.color) ? String(r.color).trim() : DEFAULT_PROJECT_COLOR;
  p.description = trimStr(r.description, LIMITS.projectDescription);
  p.status = PROJECT_STATUSES.includes(r.status) ? r.status : 'active';
  /* v3（§11.1）：三字段一律 trim，空串合法；id 为空时 path/title 一并清空（避免脏快照） */
  p.workspaceId = trimStr(r.workspaceId, LIMITS.workspaceId);
  p.workspacePath = trimStr(r.workspacePath, LIMITS.workspacePath);
  p.workspaceTitle = trimStr(r.workspaceTitle, LIMITS.workspaceTitle);
  if (!p.workspaceId) {
    p.workspacePath = '';
    p.workspaceTitle = '';
  }
  p.createdAt = normIsoOrEmpty(r.createdAt) || now;
  p.updatedAt = normIsoOrEmpty(r.updatedAt) || p.createdAt;
  return p;
}

/** 按 id 精确查项目（找不到返回 null，不抛）。 */
export function findProject(board, id) {
  const k = trimStr(id, 40);
  if (!k) return null;
  const arr = Array.isArray(board && board.projects) ? board.projects : [];
  return arr.find((p) => p && p.id === k) || null;
}

/** 项目名（未知/空 → 空串）。 */
export function projectName(board, projectId) {
  const p = findProject(board, projectId);
  return p ? p.name : '';
}

/** 提示用：可用项目清单。 */
export function projectListHint(board) {
  const arr = Array.isArray(board && board.projects) ? board.projects : [];
  if (!arr.length) return '（当前没有项目，可用 dev_project create 新建）';
  return arr.map((p) => `${p.id} ${p.name}`).join('、');
}

/* ---------------- 空间（CONTRACT §11） ---------------- */

/**
 * 项目已绑定的空间快照：`{id,title,path}`；未绑定返回 null。
 * 纯读，不做 registry 校验（是否仍存在由调用方按当前 registry 现取）。
 */
export function projectWorkspaceSnapshot(project) {
  if (!isPlainObject(project)) return null;
  const id = trimStr(project.workspaceId, LIMITS.workspaceId);
  if (!id) return null;
  return {
    id,
    title: trimStr(project.workspaceTitle, LIMITS.workspaceTitle),
    path: trimStr(project.workspacePath, LIMITS.workspacePath),
  };
}

/** 项目空间显示名（title → path → id）；未绑定返回空串。 */
export function projectWorkspaceLabel(project) {
  const sp = projectWorkspaceSnapshot(project);
  if (!sp) return '';
  return sp.title || sp.path || sp.id;
}

/**
 * 解析空间引用（CONTRACT §11.1）：id 精确 → path 精确 → title 忽略大小写 / 首尾空格。
 * registry 列表由 index.js 传入（store 不直接依赖宿主服务）；未命中返回 null。
 * @param {Array<{id:string,title?:string,path?:string}>} registryList
 * @param {string} ref
 * @returns {{id:string,title:string,path:string}|null}
 */
export function resolveWorkspaceRef(registryList, ref) {
  const raw = trimStr(ref, LIMITS.workspaceRef);
  if (!raw) return null;
  const items = (Array.isArray(registryList) ? registryList : [])
    .filter((w) => isPlainObject(w))
    .map((w) => ({
      id: trimStr(w.id, LIMITS.workspaceId),
      title: trimStr(w.title, LIMITS.workspaceTitle),
      path: trimStr(w.path, LIMITS.workspacePath),
    }))
    .filter((w) => w.id);
  if (!items.length) return null;

  const byId = items.find((w) => w.id === raw);
  if (byId) return byId;
  const byPath = items.find((w) => w.path && w.path === raw);
  if (byPath) return byPath;
  /* path 写法差异（符号链接 / 末尾斜杠）：按规范化路径再精确比一次 */
  const rawPath = normPath(raw);
  if (rawPath) {
    const byNormPath = items.find((w) => w.path && normPath(w.path) === rawPath);
    if (byNormPath) return byNormPath;
  }
  const kw = raw.toLowerCase();
  return items.find((w) => w.title && w.title.trim().toLowerCase() === kw) || null;
}

/** 提示用：可用空间清单（名称｜路径）。 */
export function workspaceListHint(registryList) {
  const items = (Array.isArray(registryList) ? registryList : []).filter((w) => isPlainObject(w));
  if (!items.length) return '（workspaceRegistry 未注册任何工作区）';
  return items
    .map((w) => `${trimStr(w.title, LIMITS.workspaceTitle) || trimStr(w.id, LIMITS.workspaceId)}（${trimStr(w.path, LIMITS.workspacePath)}）`)
    .join('、');
}

/**
 * 归一化写入用的 workspace 值（CONTRACT §11.1 第 3 层）：
 * - undefined → undefined（字段未提供，保持原绑定 / 不绑定）；
 * - null / 空串 → null（清空三字段）；
 * - 空间对象 `{id,path?,title?}` → `{id,title,path}`（调用方解析后传入）；
 * - 非空字符串 → INVALID_INPUT（必须先经 resolveWorkspaceRef 解析，store 不碰 registry）。
 * @returns {{id:string,title:string,path:string}|null|undefined}
 * @throws {DevworkError}
 */
export function normalizeWorkspaceBinding(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    if (!trimStr(value, LIMITS.workspaceRef)) return null;
    throw fail('INVALID_INPUT', 'workspace 必须先解析为空间对象再写入（可用 resolveWorkspaceRef(registry.list(), 引用)）');
  }
  if (!isPlainObject(value)) throw fail('INVALID_INPUT', 'workspace 必须是空间对象 / 空串 / null');
  const id = trimStr(value.id, LIMITS.workspaceId);
  if (!id) throw fail('INVALID_INPUT', 'workspace 对象缺少 id');
  return {
    id,
    title: trimStr(value.title, LIMITS.workspaceTitle),
    path: trimStr(value.path, LIMITS.workspacePath),
  };
}

/** 把空间快照写进项目；返回三字段是否真正变化。 */
function setProjectWorkspace(project, workspace) {
  const next = workspace || { id: '', title: '', path: '' };
  const id = trimStr(next.id, LIMITS.workspaceId);
  const path = id ? trimStr(next.path, LIMITS.workspacePath) : '';
  const title = id ? trimStr(next.title, LIMITS.workspaceTitle) : '';
  const changed = project.workspaceId !== id || project.workspacePath !== path || project.workspaceTitle !== title;
  project.workspaceId = id;
  project.workspacePath = path;
  project.workspaceTitle = title;
  return changed;
}

/**
 * 把「项目 id 或名称」解析成项目对象（CONTRACT §10.4）。
 * - id 精确；名称忽略大小写与首尾空格；`opts.fuzzy` 时允许名称包含匹配（唯一命中）。
 * - 找不到：id 形状 → NOT_FOUND；否则 INVALID_INPUT。两者都带可用项目名提示。
 * @throws {DevworkError}
 */
export function resolveProject(board, ref, opts = {}) {
  const raw = trimStr(ref, 120);
  const arr = Array.isArray(board && board.projects) ? board.projects : [];
  if (!raw) {
    throw fail('INVALID_INPUT', '项目不能为空；可用项目：' + projectListHint(board));
  }
  const byId = arr.find((p) => p && p.id === raw);
  if (byId) return byId;
  const kw = raw.toLowerCase();
  const byName = arr.find((p) => p && String(p.name || '').trim().toLowerCase() === kw);
  if (byName) return byName;
  if (opts.fuzzy) {
    const hits = arr.filter((p) => p && String(p.name || '').toLowerCase().includes(kw));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw fail('INVALID_INPUT', `项目名「${raw}」匹配到多个：${hits.map((p) => p.id + ' ' + p.name).join('、')}；请用项目 id 指定`);
    }
  }
  const hint = '；可用项目：' + projectListHint(board) + '；也可用 dev_project list 查看全部';
  if (PROJECT_ID_RE.test(raw)) throw fail('NOT_FOUND', '项目不存在：' + raw + hint);
  throw fail('INVALID_INPUT', '未知项目：' + raw + hint);
}

/** 项目名唯一性（忽略大小写与首尾空格）。 */
function assertUniqueProjectName(projects, name, exceptId) {
  const k = String(name || '').trim().toLowerCase();
  const dup = (Array.isArray(projects) ? projects : []).find(
    (p) => p && p.id !== exceptId && String(p.name || '').trim().toLowerCase() === k,
  );
  if (dup) throw fail('INVALID_INPUT', `项目名称已存在：${dup.name}（${dup.id}）`);
}

/**
 * 规范化任务：补齐全部字段、裁剪长度、丢弃非法枚举（回默认）、校验 id 形如 T-<n>。
 * @param {object} raw
 * @param {{owner?:string, now?:string}} [opts]
 */
export function normalizeTask(raw, opts = {}) {
  const r = isPlainObject(raw) ? raw : {};
  const now = isIso(opts.now) ? new Date(opts.now).toISOString() : nowIso();
  const t = taskDefaults();
  t.id = trimStr(r.id, 20);
  t.title = trimStr(r.title, LIMITS.title);
  t.description = trimStr(r.description, LIMITS.description);
  t.type = TYPES.includes(r.type) ? r.type : 'dev';
  t.status = STATUSES.includes(r.status) ? r.status : 'todo';
  t.priority = PRIORITIES.includes(r.priority) ? r.priority : 'P2';
  t.owner = trimStr(r.owner === undefined ? opts.owner : r.owner, LIMITS.name) || trimStr(opts.owner, LIMITS.name);
  t.due = isDateStr(r.due) ? String(r.due).trim() : '';
  t.estimate = clampNum(r.estimate, 0, 9999, 0);
  t.spent = clampNum(r.spent, 0, 9999, 0);
  t.progress = clampInt(r.progress, 0, 100, 0);
  t.tags = normStringArray(r.tags, LIMITS.tag, LIMITS.tagsMax);
  t.checklist = normChecklist(r.checklist);
  t.artifacts = normArtifacts(r.artifacts);
  t.links = normLinks(r.links);
  t.dependencies = normStringArray(r.dependencies, 20, LIMITS.dependenciesMax);
  t.blockedReason = trimStr(r.blockedReason, LIMITS.description);
  t.reviewNote = trimStr(r.reviewNote, LIMITS.description);
  t.sessionId = trimStr(r.sessionId, 100);
  t.startedAt = normIsoOrEmpty(r.startedAt);
  t.doneAt = normIsoOrEmpty(r.doneAt);
  /* 仅 trim；是否存在由 normalizeBoard / createTask / updateTask 校验（空串合法）。 */
  t.projectId = trimStr(r.projectId, 40);
  t.createdAt = normIsoOrEmpty(r.createdAt) || now;
  t.updatedAt = normIsoOrEmpty(r.updatedAt) || t.createdAt;
  if (!TASK_ID_RE.test(t.id)) t.id = '';
  return t;
}

/** 规范化注意力条目。 */
export function normalizeAttention(raw, opts = {}) {
  const r = isPlainObject(raw) ? raw : {};
  const now = isIso(opts.now) ? new Date(opts.now).toISOString() : nowIso();
  const status = r.status === 'resolved' ? 'resolved' : 'open';
  return {
    id: ATTENTION_ID_RE.test(trimStr(r.id, 20)) ? trimStr(r.id, 20) : '',
    target: normalizeTarget(r.target),
    kind: ATTENTION_KINDS.includes(r.kind) ? r.kind : 'decision',
    question: trimStr(r.question, LIMITS.question),
    askedAt: normIsoOrEmpty(r.askedAt) || now,
    status,
    answer: trimStr(r.answer, LIMITS.answer),
    resolvedAt: normIsoOrEmpty(r.resolvedAt),
  };
}

/** target 允许 `{kind,id}` 或直接任务 id 字符串。 */
export function normalizeTarget(raw) {
  if (typeof raw === 'string') {
    const id = trimStr(raw, 40);
    return id ? { kind: 'task', id } : { kind: 'board', id: '' };
  }
  if (isPlainObject(raw)) {
    const id = trimStr(raw.id, 40);
    if (raw.kind === 'task' && id) return { kind: 'task', id };
    if (raw.kind === 'project' && id) return { kind: 'project', id };
    return { kind: 'board', id: '' };
  }
  return { kind: 'board', id: '' };
}

/** 规范化设置：非法值回默认，数值夹取。 */
export function normalizeSettings(raw) {
  const s = defaultSettings();
  if (!isPlainObject(raw)) return s;
  if (AUTONOMY_MODES.includes(raw.autonomy)) s.autonomy = raw.autonomy;
  s.wipLimit = clampInt(raw.wipLimit, 1, 20, s.wipLimit);
  s.staleDays = clampInt(raw.staleDays, 1, 60, s.staleDays);
  const owner = trimStr(raw.owner, LIMITS.name);
  if (owner) s.owner = owner;
  if (typeof raw.showCanceled === 'boolean') s.showCanceled = raw.showCanceled;
  return s;
}

/**
 * 规范化整板（读盘后调用）：修 id、修 seq、裁剪 activity。
 * v1 → v2 迁移（CONTRACT §10.1）：projects 缺失/为空 → 默认项目；
 * 任务 projectId 缺失/非法/指向不存在项目 → 改归默认项目；显式空串保留为「未归属」。
 * v2 → v3 迁移（CONTRACT §11.1）：Project 缺失 workspaceId/workspacePath/workspaceTitle → 补空串；
 * 任务、注意力、seq 不受影响。
 */
export function normalizeBoard(raw, workspace) {
  const b = emptyBoard(workspace);
  if (!isPlainObject(raw)) return b;
  b.version = BOARD_VERSION;
  b.rev = clampInt(raw.rev, 0, 1e9, 0);
  b.seq = clampInt(raw.seq, 0, 1e9, 0);
  const pn = trimStr(raw.project && raw.project.name, 80);
  const pw = trimStr(raw.project && raw.project.workspace, 2000);
  b.project = { name: pn || b.project.name, workspace: pw || String(workspace || '') };
  b.settings = normalizeSettings(raw.settings);

  /* ---- 项目：规范化 → 无项目时补默认项目（迁移 1） ---- */
  b.projects = [];
  const usedP = new Set();
  const seenNames = new Set();
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
  for (const it of rawProjects) {
    if (b.projects.length >= LIMITS.projectsMax) break;
    const p = normalizeProject(it);
    if (!p.name) continue;
    const nk = p.name.trim().toLowerCase();
    if (seenNames.has(nk)) continue; // 重名项目丢弃（保留先出现的）
    if (!p.id || usedP.has(p.id)) {
      b.seq += 1;
      p.id = formatId('P', b.seq);
    }
    usedP.add(p.id);
    b.seq = Math.max(b.seq, idSeq(p.id));
    seenNames.add(nk);
    b.projects.push(p);
  }
  if (!b.projects.length) {
    b.seq = Math.max(1, b.seq);
    b.projects.push(defaultProject(nowIso()));
  }
  const fallbackId = b.projects[0].id;
  const projectIds = new Set(b.projects.map((p) => p.id));

  const used = new Set();
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  for (const it of tasks) {
    const t = normalizeTask(it, { owner: b.settings.owner });
    if (!t.title) continue; // 无标题的坏条目丢弃
    if (!t.id || used.has(t.id)) t.id = formatId('T', ++b.seq);
    used.add(t.id);
    b.seq = Math.max(b.seq, idSeq(t.id));
    /* 迁移 2：缺失/非法/指向不存在 → 默认项目；显式空串=未归属，保留 */
    const rawPid = isPlainObject(it) ? it.projectId : undefined;
    const explicitEmpty = rawPid === '';
    if (explicitEmpty) t.projectId = '';
    else if (!t.projectId || !projectIds.has(t.projectId)) t.projectId = fallbackId;
    b.tasks.push(t);
  }

  const usedA = new Set();
  const attention = Array.isArray(raw.attention) ? raw.attention : [];
  for (const it of attention) {
    const a = normalizeAttention(it);
    if (!a.question) continue;
    if (!a.id || usedA.has(a.id)) a.id = formatId('A', ++b.seq);
    usedA.add(a.id);
    b.seq = Math.max(b.seq, idSeq(a.id));
    b.attention.push(a);
  }

  const activity = Array.isArray(raw.activity) ? raw.activity : [];
  for (const it of activity) {
    if (!isPlainObject(it)) continue;
    b.activity.push({
      at: normIsoOrEmpty(it.at) || nowIso(),
      by: ACTIVITY_BY.includes(it.by) ? it.by : 'system',
      kind: ACTIVITY_KINDS.includes(it.kind) ? it.kind : 'update',
      taskId: trimStr(it.taskId, 40),
      text: trimStr(it.text, LIMITS.activityText),
    });
  }
  if (b.activity.length > ACTIVITY_MAX) b.activity = b.activity.slice(-ACTIVITY_MAX);

  b.updatedAt = normIsoOrEmpty(raw.updatedAt) || nowIso();
  return b;
}

/* ---------------- 读写（同进程串行队列） ---------------- */

/** 串行队列：所有写盘串行执行，避免并发读-改-写互相覆盖。 */
let writeChain = Promise.resolve();
function enqueue(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 读板。文件不存在 / 空文件 → 空板；坏 JSON → 备份 `.bad-<ts>` 后重建空板并落盘。
 * @throws {DevworkError} READ_FAILED
 */
export function loadBoard(root) {
  const file = boardPath(root);
  const r = readJsonSafe(file);
  if (!r.ok) {
    if (r.bad) {
      const board = emptyBoard(root);
      try { atomicWriteJson(file, board); } catch { /* 备份成功但重建失败时仍返回空板 */ }
      return board;
    }
    throw fail('READ_FAILED', '读取看板失败：' + (r.error || file));
  }
  const board = normalizeBoard(r.existed ? r.value : null, root);
  return board;
}

/** 写板（快照序列化后进串行队列）。 */
export function saveBoard(root, board) {
  const file = boardPath(root);
  const payload = JSON.parse(JSON.stringify(board || {}));
  return enqueue(() => {
    atomicWriteJson(file, payload);
    return file;
  });
}

/**
 * 串行读-改-写：fn(board) 内做变更；fn 抛错则不写盘。
 * @returns {Promise<{board:object, out:any}>}
 */
export function mutateBoard(root, fn) {
  const file = boardPath(root);
  return enqueue(() => {
    const board = loadBoard(root);
    const out = typeof fn === 'function' ? fn(board) : undefined;
    atomicWriteJson(file, board);
    return { board, out };
  });
}

/* ---------------- 基础变更 ---------------- */

/** rev +1、updatedAt 刷新。返回新 rev。 */
export function bump(board) {
  board.rev = clampInt(board.rev, 0, 1e9, 0) + 1;
  board.updatedAt = nowIso();
  return board.rev;
}

function normBy(by) {
  return ACTIVITY_BY.includes(by) ? by : 'human';
}

/** 追加活动，只保留最近 ACTIVITY_MAX 条。 */
export function addActivity(board, entry = {}) {
  if (!Array.isArray(board.activity)) board.activity = [];
  const e = {
    at: isIso(entry.at) ? new Date(entry.at).toISOString() : nowIso(),
    by: ACTIVITY_BY.includes(entry.by) ? entry.by : 'system',
    kind: ACTIVITY_KINDS.includes(entry.kind) ? entry.kind : 'update',
    taskId: trimStr(entry.taskId, 40),
    text: trimStr(entry.text, LIMITS.activityText),
  };
  board.activity.push(e);
  if (board.activity.length > ACTIVITY_MAX) board.activity = board.activity.slice(-ACTIVITY_MAX);
  return e;
}

export function findTask(board, id) {
  const k = trimStr(id, 40);
  if (!k) throw fail('INVALID_INPUT', '任务 id 不能为空');
  const t = (Array.isArray(board.tasks) ? board.tasks : []).find((x) => x && x.id === k);
  if (!t) throw fail('NOT_FOUND', '任务不存在：' + k);
  return t;
}

export function findAttention(board, id) {
  const k = trimStr(id, 40);
  if (!k) throw fail('INVALID_INPUT', '注意力 id 不能为空');
  const a = (Array.isArray(board.attention) ? board.attention : []).find((x) => x && x.id === k);
  if (!a) throw fail('NOT_FOUND', '注意力不存在：' + k);
  return a;
}

/* ---------------- 项目 CRUD（CONTRACT §10.1 / §10.3） ---------------- */

function nextProjectId(board) {
  board.seq = clampInt(board.seq, 0, 1e9, 0) + 1;
  return formatId('P', board.seq);
}

/**
 * 新建项目：名称必填且唯一（忽略大小写/首尾空格），≤50 个，颜色缺省 #5B7CFA。
 * v3（§11.1）：`input.workspace` 可为空间对象（调用方按 registry 解析）或空串/null（不绑定）；
 * 非空字符串由 store 拒绝（必须先解析），保证落盘的是 `{id,path,title}` 快照。
 * @returns {{project:object}}
 */
export function createProject(board, input, opts = {}) {
  const by = normBy(opts.by);
  if (!isPlainObject(input)) throw fail('INVALID_INPUT', '项目数据必须是对象');
  const name = trimStr(input.name, LIMITS.projectName);
  if (!name) throw fail('INVALID_INPUT', '项目名称不能为空');
  if (!Array.isArray(board.projects)) board.projects = [];
  if (board.projects.length >= LIMITS.projectsMax) {
    throw fail('INVALID_INPUT', `项目数已达上限 ${LIMITS.projectsMax} 个`);
  }
  assertUniqueProjectName(board.projects, name);
  if (input.color !== undefined && input.color !== null && String(input.color).trim() !== '' && !isProjectColor(input.color)) {
    throw fail('INVALID_INPUT', '颜色必须是 #RRGGBB 形式（如 #5B7CFA）');
  }
  if (input.status !== undefined && input.status !== null && !PROJECT_STATUSES.includes(input.status)) {
    throw fail('INVALID_INPUT', '非法项目状态：' + String(input.status));
  }
  /* v3（§11.1）：空串/null = 不绑定；对象 = 调用方已解析的空间快照 */
  const workspace = normalizeWorkspaceBinding(input.workspace);
  const now = nowIso();
  const project = normalizeProject({ ...input, name, id: nextProjectId(board) }, { now });
  if (workspace !== undefined) setProjectWorkspace(project, workspace);
  project.createdAt = now;
  project.updatedAt = now;
  board.projects.push(project);
  addActivity(board, { by, kind: 'create', text: '新建项目：' + project.name });
  bump(board);
  return { project };
}

/**
 * 改项目字段：name / color / description / status（重名拒绝）。
 * @returns {{project:object, changed:string[]}}
 */
export function updateProject(board, ref, patch, opts = {}) {
  const by = normBy(opts.by);
  if (!isPlainObject(patch)) throw fail('INVALID_INPUT', 'patch 必须是对象');
  const project = resolveProject(board, ref);
  const projects = Array.isArray(board.projects) ? board.projects : [];
  const changed = [];

  if ('name' in patch) {
    const v = trimStr(patch.name, LIMITS.projectName);
    if (!v) throw fail('INVALID_INPUT', '项目名称不能为空');
    assertUniqueProjectName(projects, v, project.id);
    if (v !== project.name) { project.name = v; changed.push('name'); }
  }
  if ('color' in patch) {
    if (!isProjectColor(patch.color)) throw fail('INVALID_INPUT', '颜色必须是 #RRGGBB 形式（如 #5B7CFA）');
    const v = String(patch.color).trim();
    if (v.toLowerCase() !== String(project.color || '').toLowerCase()) { project.color = v; changed.push('color'); }
  }
  if ('description' in patch) {
    const v = trimStr(patch.description, LIMITS.projectDescription);
    if (v !== project.description) { project.description = v; changed.push('description'); }
  }
  if ('status' in patch) {
    if (!PROJECT_STATUSES.includes(patch.status)) {
      throw fail('INVALID_INPUT', '非法项目状态：' + String(patch.status || '(空)'));
    }
    if (patch.status !== project.status) { project.status = patch.status; changed.push('status'); }
  }
  /* v3（§11.1）：workspace 空串/null = 解除绑定；对象 = 调用方解析后的空间快照 */
  if (Object.prototype.hasOwnProperty.call(patch, 'workspace')) {
    const ws = normalizeWorkspaceBinding(patch.workspace === undefined ? null : patch.workspace);
    if (setProjectWorkspace(project, ws)) changed.push('workspace');
  }

  if (changed.length) {
    project.updatedAt = nowIso();
    addActivity(board, { by, kind: 'update', text: `更新项目「${project.name}」：` + changed.join('、') });
    bump(board);
  }
  return { project, changed };
}

/**
 * 删除项目：仅 human（面板）。
 * - 项目下有任务且未给 moveTo → PROJECT_NOT_EMPTY；
 * - moveTo 为合法项目 id / 名称 → 任务先改归该项目；'' → 改为「未归属」；
 * - 删空后自动补默认项目。
 * @returns {{id:string, name:string, movedTasks:number, moveTo:string, fallbackProject:object|null}}
 */
export function deleteProject(board, ref, opts = {}) {
  const by = normBy(opts.by);
  if (by !== 'human') throw fail('HUMAN_ONLY', '删除项目只能由人在面板执行');
  const project = resolveProject(board, ref);
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const owned = tasks.filter((t) => t && t.projectId === project.id);
  const hasMoveTo = Object.prototype.hasOwnProperty.call(opts, 'moveTo')
    && opts.moveTo !== undefined && opts.moveTo !== null;

  let moveToId = '';
  let target = null;
  if (hasMoveTo) {
    const raw = opts.moveTo === '' ? '' : trimStr(opts.moveTo, 120);
    if (raw) {
      target = resolveProject(board, raw);
      if (target.id === project.id) throw fail('INVALID_INPUT', 'moveTo 不能是被删除的项目本身');
      moveToId = target.id;
    }
  }
  if (owned.length && !hasMoveTo) {
    throw fail(
      'PROJECT_NOT_EMPTY',
      `项目「${project.name}」下还有 ${owned.length} 个任务；请先把任务改归其他项目，或指定 moveTo（空串=未归属）后再删除`,
      { count: owned.length },
    );
  }

  const now = nowIso();
  for (const t of owned) {
    t.projectId = moveToId;
    t.updatedAt = now;
  }
  board.projects = (Array.isArray(board.projects) ? board.projects : []).filter(
    (p) => p && p.id !== project.id,
  );

  let fallbackProject = null;
  if (!board.projects.length) {
    fallbackProject = normalizeProject({ id: nextProjectId(board), name: DEFAULT_PROJECT_NAME }, { now });
    fallbackProject.createdAt = now;
    fallbackProject.updatedAt = now;
    board.projects.push(fallbackProject);
  }

  let text = '删除项目：' + project.name;
  if (owned.length) {
    text += moveToId && target
      ? `（${owned.length} 个任务改归「${target.name}」）`
      : `（${owned.length} 个任务改为未归属）`;
  }
  addActivity(board, { by, kind: 'delete', text });
  bump(board);
  return { id: project.id, name: project.name, movedTasks: owned.length, moveTo: moveToId, fallbackProject };
}

/* ---------------- 任务 ---------------- */

/** 白名单可写字段（CONTRACT §4.2 + §10.3 projectId）。 */
export const WRITABLE_TASK_FIELDS = Object.freeze([
  'title', 'description', 'type', 'priority', 'owner', 'due', 'estimate', 'spent',
  'progress', 'tags', 'checklist', 'artifacts', 'links', 'dependencies',
  'blockedReason', 'reviewNote', 'projectId',
]);

function assertArrayIfPresent(patch, key) {
  if (key in patch && patch[key] !== null && patch[key] !== undefined && !Array.isArray(patch[key])) {
    throw fail('INVALID_INPUT', `${key} 必须是数组`);
  }
}

/** 把 patch 合进任务，返回真正变化的字段名列表；非法输入抛 INVALID_INPUT。 */
function applyTaskPatch(task, patch, board) {
  const changed = [];
  const p = patch || {};

  if ('title' in p) {
    const v = trimStr(p.title, LIMITS.title);
    if (!v) throw fail('INVALID_INPUT', '标题不能为空');
    if (v !== task.title) { task.title = v; changed.push('title'); }
  }
  if ('description' in p) {
    const v = trimStr(p.description, LIMITS.description);
    if (v !== task.description) { task.description = v; changed.push('description'); }
  }
  if ('type' in p && p.type !== task.type) {
    if (!TYPES.includes(p.type)) throw fail('INVALID_INPUT', '非法类型：' + String(p.type));
    task.type = p.type; changed.push('type');
  }
  if ('priority' in p && p.priority !== task.priority) {
    if (!PRIORITIES.includes(p.priority)) throw fail('INVALID_INPUT', '非法优先级：' + String(p.priority));
    task.priority = p.priority; changed.push('priority');
  }
  if ('owner' in p) {
    const v = trimStr(p.owner, LIMITS.name);
    if (v !== task.owner) { task.owner = v; changed.push('owner'); }
  }
  if ('due' in p) {
    const raw = p.due === null || p.due === undefined ? '' : String(p.due).trim();
    if (raw && !isDateStr(raw)) throw fail('INVALID_INPUT', 'due 必须是 YYYY-MM-DD 或空串');
    if (raw !== task.due) { task.due = raw; changed.push('due'); }
  }
  if ('estimate' in p) {
    const v = clampNum(p.estimate, 0, 9999, task.estimate);
    if (v !== task.estimate) { task.estimate = v; changed.push('estimate'); }
  }
  if ('spent' in p) {
    const v = clampNum(p.spent, 0, 9999, task.spent);
    if (v !== task.spent) { task.spent = v; changed.push('spent'); }
  }
  if ('progress' in p) {
    const v = clampInt(p.progress, 0, 100, task.progress);
    if (v !== task.progress) { task.progress = v; changed.push('progress'); }
  }
  if ('tags' in p) {
    assertArrayIfPresent(p, 'tags');
    const v = normStringArray(p.tags, LIMITS.tag, LIMITS.tagsMax);
    if (JSON.stringify(v) !== JSON.stringify(task.tags)) { task.tags = v; changed.push('tags'); }
  }
  if ('checklist' in p) {
    assertArrayIfPresent(p, 'checklist');
    const v = normChecklist(p.checklist);
    if (JSON.stringify(v) !== JSON.stringify(task.checklist)) { task.checklist = v; changed.push('checklist'); }
  }
  if ('artifacts' in p) {
    assertArrayIfPresent(p, 'artifacts');
    const v = normArtifacts(p.artifacts);
    if (JSON.stringify(v) !== JSON.stringify(task.artifacts)) { task.artifacts = v; changed.push('artifacts'); }
  }
  if ('links' in p) {
    assertArrayIfPresent(p, 'links');
    const v = normLinks(p.links);
    if (JSON.stringify(v) !== JSON.stringify(task.links)) { task.links = v; changed.push('links'); }
  }
  if ('dependencies' in p) {
    assertArrayIfPresent(p, 'dependencies');
    const v = normStringArray(p.dependencies, 20, LIMITS.dependenciesMax);
    if (JSON.stringify(v) !== JSON.stringify(task.dependencies)) { task.dependencies = v; changed.push('dependencies'); }
  }
  if ('blockedReason' in p) {
    const v = trimStr(p.blockedReason, LIMITS.description);
    if (v !== task.blockedReason) { task.blockedReason = v; changed.push('blockedReason'); }
  }
  if ('reviewNote' in p) {
    const v = trimStr(p.reviewNote, LIMITS.description);
    if (v !== task.reviewNote) { task.reviewNote = v; changed.push('reviewNote'); }
  }
  if ('projectId' in p) {
    const raw = trimStr(p.projectId, 40);
    let next = '';
    if (raw) {
      /* 存在性校验；空串允许（= 未归属） */
      next = resolveProject(board, raw).id;
    }
    if (next !== task.projectId) { task.projectId = next; changed.push('projectId'); }
  }
  return changed;
}

/**
 * 建任务。title 必填；type/priority/due 严格校验；done 只能 human。
 * @returns {{task:object}}
 */
export function createTask(board, input, opts = {}) {
  const by = normBy(opts.by);
  if (!isPlainObject(input)) throw fail('INVALID_INPUT', '任务数据必须是对象');
  const title = trimStr(input.title, LIMITS.title);
  if (!title) throw fail('INVALID_INPUT', '任务标题不能为空');
  if (input.type !== undefined && input.type !== null && !TYPES.includes(input.type)) {
    throw fail('INVALID_INPUT', '非法类型：' + String(input.type));
  }
  if (input.priority !== undefined && input.priority !== null && !PRIORITIES.includes(input.priority)) {
    throw fail('INVALID_INPUT', '非法优先级：' + String(input.priority));
  }
  if (input.status !== undefined && input.status !== null) {
    if (!STATUSES.includes(input.status)) throw fail('INVALID_INPUT', '非法状态：' + String(input.status));
    if (input.status === 'done' && by !== 'human') throw fail('HUMAN_ONLY', '任务完成（done）只能由人在面板标记');
  }
  if (input.due !== undefined && input.due !== null && input.due !== '' && !isDateStr(String(input.due))) {
    throw fail('INVALID_INPUT', 'due 必须是 YYYY-MM-DD 或空串');
  }
  for (const k of ['tags', 'checklist', 'artifacts', 'links', 'dependencies']) assertArrayIfPresent(input, k);

  /* §10.1：显式 projectId 校验存在（空串=未归属）；未给时只有 1 个项目则用它，否则空串 */
  const projects = Array.isArray(board.projects) ? board.projects : [];
  let projectId = '';
  if (input.projectId !== undefined && input.projectId !== null) {
    const raw = trimStr(input.projectId, 40);
    projectId = raw ? resolveProject(board, raw).id : '';
  } else if (projects.length === 1) {
    projectId = projects[0].id;
  }

  const now = nowIso();
  const id = formatId('T', ++board.seq);
  const task = normalizeTask({ ...input, id, projectId }, { owner: board.settings.owner, now });
  task.projectId = projectId;
  task.createdAt = now;
  task.updatedAt = now;
  if (task.status === 'done') { task.doneAt = now; task.progress = 100; }
  if (task.status === 'doing' && !task.startedAt) task.startedAt = now;
  if (!Array.isArray(board.tasks)) board.tasks = [];
  board.tasks.push(task);
  addActivity(board, { by, kind: 'create', taskId: task.id, text: '新建任务：' + task.title });
  bump(board);
  return { task };
}

/**
 * 改任务字段。`status` 单独走 move 语义（面板可使用；agent 必须走 move）。
 * @returns {{task:object, changed:string[]}}
 */
export function updateTask(board, id, patch, opts = {}) {
  const by = normBy(opts.by);
  if (!isPlainObject(patch)) throw fail('INVALID_INPUT', 'patch 必须是对象');
  const task = findTask(board, id);
  const changed = [];
  if ('status' in patch && patch.status !== task.status) {
    const to = String(patch.status || '');
    if (!STATUSES.includes(to)) throw fail('INVALID_INPUT', '非法状态：' + (to || '(空)'));
    if (by !== 'human') {
      if (to === 'done') throw fail('HUMAN_ONLY', '任务完成（done）只能由人在面板验收');
      throw fail('INVALID_INPUT', 'agent 改状态请用 dev_item action=move（不得经 update 改 status）');
    }
    const r = changeStatus(board, task, to, { by, note: trimStr(patch.note, LIMITS.note) });
    if (r.changed) changed.push('status');
  }
  const rest = {};
  for (const k of WRITABLE_TASK_FIELDS) if (k in patch) rest[k] = patch[k];
  const fieldChanged = applyTaskPatch(task, rest, board);
  for (const k of fieldChanged) changed.push(k);

  if (changed.length) {
    task.updatedAt = nowIso();
    addActivity(board, {
      by, kind: 'update', taskId: task.id,
      text: '更新：' + changed.slice(0, 6).join('、') + (changed.length > 6 ? ' 等' : ''),
    });
    bump(board);
  }
  return { task, changed };
}

/**
 * 内部统一的状态变更：校验流转、维护时间戳、可选记一条活动（不 bump）。
 * @returns {{from:string, to:string, changed:boolean}}
 */
function changeStatus(board, task, to, opts = {}) {
  const by = normBy(opts.by);
  const from = task.status;
  const target = String(to || '').trim();
  if (!STATUSES.includes(target)) throw fail('INVALID_INPUT', '非法状态：' + (target || '(空)'));
  if (target === 'done' && by !== 'human') throw fail('HUMAN_ONLY', '任务完成（done）只能由人在面板验收');
  if (target === from) return { from, to: target, changed: false };
  if (!allowedTransition(from, target)) {
    throw fail('INVALID_TRANSITION', `不允许从「${statusLabel(from)}」流转到「${statusLabel(target)}」`);
  }
  const now = nowIso();
  const wasBlocked = from === 'blocked';
  task.status = target;
  if (target === 'doing') {
    if (!task.startedAt) task.startedAt = now;
    if (task.doneAt) task.doneAt = '';
  } else if (target === 'done') {
    task.doneAt = now;
    task.progress = 100;
  } else if (target === 'review') {
    task.doneAt = '';
  } else if (target === 'todo') {
    task.doneAt = '';
  }
  if (wasBlocked && target !== 'blocked') task.blockedReason = '';
  if (target === 'blocked' && opts.note) task.blockedReason = trimStr(opts.note, LIMITS.description);
  task.updatedAt = now;
  if (opts.activityKind) {
    addActivity(board, {
      by,
      kind: opts.activityKind,
      taskId: task.id,
      text: opts.activityText || `${statusLabel(from)} → ${statusLabel(target)}`,
    });
  }
  return { from, to: target, changed: true };
}

/**
 * 移动泳道。不允许的流转抛 INVALID_TRANSITION；done 非 human 抛 HUMAN_ONLY。
 * @returns {{task:object, from:string, to:string, changed:boolean}}
 */
export function moveTask(board, id, to, opts = {}) {
  const by = normBy(opts.by);
  const note = trimStr(opts.note, LIMITS.note);
  const task = findTask(board, id);
  const target = String(to || '').trim();
  if (!STATUSES.includes(target)) throw fail('INVALID_INPUT', '非法状态：' + (target || '(空)'));
  if (target === task.status) {
    if (note) {
      addActivity(board, { by, kind: 'move', taskId: task.id, text: `${statusLabel(target)}（补充）：${note}` });
      bump(board);
    }
    return { task, from: task.status, to: target, changed: false };
  }
  const text = `${statusLabel(task.status)} → ${statusLabel(target)}` + (note ? `｜${note}` : '');
  const r = changeStatus(board, task, target, { by, note, activityKind: 'move', activityText: text });
  bump(board);
  return { task, from: r.from, to: r.to, changed: r.changed };
}

/**
 * 删除任务：仅 human（面板）。agent 调用抛 HUMAN_ONLY。
 * @returns {{id:string, title:string}}
 */
export function deleteTask(board, id, opts = {}) {
  const by = normBy(opts.by);
  if (by !== 'human') throw fail('HUMAN_ONLY', '删除任务只能由人在面板执行');
  const task = findTask(board, id);
  board.tasks = (Array.isArray(board.tasks) ? board.tasks : []).filter((t) => t && t.id !== task.id);
  addActivity(board, { by, kind: 'delete', taskId: task.id, text: '删除任务：' + task.title });
  bump(board);
  return { id: task.id, title: task.title };
}

/**
 * 打卡：记一条 checkin，可同时改状态 / 进度 / 已投入。
 * `spent` 为绝对值（本次投入请自行累加后传入），避免重复累计。
 * @returns {{task:object, changed:string[]}}
 */
export function checkin(board, input, opts = {}) {
  const by = normBy(opts.by);
  if (!isPlainObject(input)) throw fail('INVALID_INPUT', '打卡数据必须是对象');
  const task = findTask(board, input.id);
  const note = trimStr(input.note, LIMITS.note);
  const changed = [];
  let text = note || '打卡';

  if (input.status !== undefined && input.status !== null && String(input.status) !== task.status) {
    const r = changeStatus(board, task, String(input.status), { by });
    if (r.changed) changed.push('status');
  }
  if (input.progress !== undefined && input.progress !== null) {
    const v = clampInt(input.progress, 0, 100, task.progress);
    if (v !== task.progress) { task.progress = v; changed.push('progress'); }
    text += `｜进度 ${task.progress}%`;
  }
  if (input.spent !== undefined && input.spent !== null) {
    const v = clampNum(input.spent, 0, 9999, task.spent);
    if (v !== task.spent) { task.spent = v; changed.push('spent'); }
    text += `｜已投入 ${task.spent}h`;
  }
  if (!note && !changed.length) {
    throw fail('INVALID_INPUT', '打卡至少需要 note / progress / spent / status 之一');
  }
  task.updatedAt = nowIso();
  addActivity(board, { by, kind: 'checkin', taskId: task.id, text });
  bump(board);
  return { task, changed };
}

/** BFS 找 from → to 的最短合法流转路径（不含 from；不可达返回 null）。 */
function findStatusPath(from, to) {
  if (from === to) return [];
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const next of (TRANSITIONS[last] || [])) {
      if (next === to) return [...path.slice(1), next];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

/**
 * 仅用于 report 语义（CONTRACT §4.2 表要求终态固定）：沿状态机的合法路径推进到目标，
 * 不跳过任何一级（例如 review → blocked 实际走 review → doing → blocked）。
 * 不可达 → INVALID_TRANSITION；done 仍只允许 human。
 */
function advanceTo(board, task, target, opts = {}) {
  const by = normBy(opts.by);
  if (task.status === target) return { changed: false, path: [] };
  if (target === 'done' && by !== 'human') throw fail('HUMAN_ONLY', '任务完成（done）只能由人在面板验收');
  const steps = findStatusPath(task.status, target);
  if (!steps || !steps.length) {
    throw fail('INVALID_TRANSITION', `不允许从「${statusLabel(task.status)}」流转到「${statusLabel(target)}」`);
  }
  for (const step of steps) changeStatus(board, task, step, { by, note: opts.note });
  return { changed: true, path: steps };
}

/**
 * 回报（执行会话用；语义严格按 CONTRACT §4.2 表）。
 * progress → doing；ready → review（reviewNote=text，artifacts 追加）；
 * blocked → blocked（blockedReason=text，自动建注意力）；failed → 保持 doing + 注意力；
 * dropped → canceled。任何情况下都不会产生 done。
 * @returns {{task:object, attention:object|null, kind:string}}
 */
export function reportTask(board, id, report, opts = {}) {
  const by = normBy(opts.by);
  const task = findTask(board, id);
  const r = isPlainObject(report) ? report : {};
  const kind = trimStr(r.kind, 20);
  if (!REPORT_KINDS.includes(kind)) throw fail('INVALID_INPUT', 'report.kind 非法：' + (kind || '(空)'));
  const text = trimStr(r.text, LIMITS.reportText);
  if (!text) throw fail('INVALID_INPUT', 'report.text 不能为空');
  const artifacts = normArtifacts(r.artifacts);

  const appendArtifacts = () => {
    if (!artifacts.length) return;
    if (!Array.isArray(task.artifacts)) task.artifacts = [];
    const seen = new Set(task.artifacts.map((a) => a.path));
    for (const a of artifacts) {
      if (seen.has(a.path)) continue;
      seen.add(a.path);
      task.artifacts.push(a);
    }
    if (task.artifacts.length > LIMITS.artifactsMax) task.artifacts = task.artifacts.slice(-LIMITS.artifactsMax);
  };

  let attention = null;
  if (kind === 'progress') {
    advanceTo(board, task, 'doing', { by });
    appendArtifacts();
    addActivity(board, { by, kind: 'report', taskId: task.id, text: '回报进行中：' + text });
  } else if (kind === 'ready') {
    advanceTo(board, task, 'review', { by });
    task.reviewNote = text;
    appendArtifacts();
    addActivity(board, { by, kind: 'report', taskId: task.id, text: '回报待验收：' + text });
  } else if (kind === 'blocked') {
    advanceTo(board, task, 'blocked', { by, note: text });
    appendArtifacts();
    addActivity(board, { by, kind: 'report', taskId: task.id, text: '回报受阻：' + text });
    attention = createAttentionInternal(board, {
      question: '受阻：' + task.title + '｜' + text,
      kind: 'blocked',
      target: { kind: 'task', id: task.id },
    }, { by });
  } else if (kind === 'failed') {
    advanceTo(board, task, 'doing', { by });
    appendArtifacts();
    addActivity(board, { by, kind: 'report', taskId: task.id, text: '回报失败：' + text });
    attention = createAttentionInternal(board, {
      question: '失败：' + task.title + '｜' + text,
      kind: 'blocked',
      target: { kind: 'task', id: task.id },
    }, { by });
  } else {
    /* dropped */
    advanceTo(board, task, 'canceled', { by });
    appendArtifacts();
    addActivity(board, { by, kind: 'report', taskId: task.id, text: '回报取消：' + text });
  }
  task.updatedAt = nowIso();
  bump(board);
  return { task, attention, kind };
}

/* ---------------- 注意力 ---------------- */

/** 内部建注意力（不 bump；调用方负责 bump）。 */
function createAttentionInternal(board, input, opts = {}) {
  const by = normBy(opts.by);
  const question = trimStr(input.question, LIMITS.question);
  if (!question) throw fail('INVALID_INPUT', 'question 不能为空');
  const kind = input.kind === undefined || input.kind === null ? 'decision' : String(input.kind);
  if (!ATTENTION_KINDS.includes(kind)) throw fail('INVALID_INPUT', '注意力类型非法：' + kind);
  const target = normalizeTarget(input.target);
  if (target.kind === 'task') {
    if (!target.id) throw fail('INVALID_INPUT', 'target.kind=task 时 target.id 不能为空');
    findTask(board, target.id); // 不存在 → NOT_FOUND
  } else if (target.kind === 'project') {
    if (!target.id) throw fail('INVALID_INPUT', 'target.kind=project 时 target.id 不能为空');
    resolveProject(board, target.id); // 不存在 → NOT_FOUND
  }
  const attention = {
    id: formatId('A', ++board.seq),
    target,
    kind,
    question,
    askedAt: nowIso(),
    status: 'open',
    answer: '',
    resolvedAt: '',
  };
  if (!Array.isArray(board.attention)) board.attention = [];
  board.attention.push(attention);
  addActivity(board, {
    by, kind: 'attention', taskId: target.kind === 'task' ? target.id : '',
    text: '提问（' + attentionKindLabel(kind) + '）：' + question,
  });
  return attention;
}

/** 建注意力（agent 与 human 都可以提问；只有 human 能 resolve）。 */
export function askAttention(board, input, opts = {}) {
  const by = normBy(opts.by);
  if (!isPlainObject(input)) throw fail('INVALID_INPUT', '注意力数据必须是对象');
  const attention = createAttentionInternal(board, input, { by });
  bump(board);
  return { attention };
}

/** 回答并关闭注意力：仅 human。 */
export function resolveAttention(board, id, answer, opts = {}) {
  const by = normBy(opts.by);
  if (by !== 'human') throw fail('HUMAN_ONLY', '注意力只能由人在面板回答');
  const attention = findAttention(board, id);
  if (attention.status === 'resolved') throw fail('INVALID_INPUT', '该注意力已处理：' + attention.id);
  attention.status = 'resolved';
  attention.answer = trimStr(answer, LIMITS.answer);
  attention.resolvedAt = nowIso();
  addActivity(board, {
    by, kind: 'attention', taskId: attention.target && attention.target.kind === 'task' ? attention.target.id : '',
    text: '已回答：' + (attention.answer || '（关闭）'),
  });
  bump(board);
  return { attention };
}

/** 未处理的注意力（默认只列 open）。 */
export function listAttention(board, opts = {}) {
  const onlyOpen = opts.onlyOpen !== false;
  const arr = Array.isArray(board.attention) ? board.attention : [];
  return arr.filter((a) => a && (!onlyOpen || a.status === 'open'));
}

/* ---------------- 设置 ---------------- */

/** 更新设置（面板专用；agent 没有对应工具）。 */
export function updateSettings(board, patch) {
  if (!isPlainObject(patch)) throw fail('INVALID_INPUT', 'patch 必须是对象');
  if ('autonomy' in patch && !AUTONOMY_MODES.includes(patch.autonomy)) {
    throw fail('INVALID_INPUT', 'autonomy 只能是 observe / assisted / auto');
  }
  if ('wipLimit' in patch && !(Number.isFinite(Number(patch.wipLimit)) && Number(patch.wipLimit) >= 1 && Number(patch.wipLimit) <= 20)) {
    throw fail('INVALID_INPUT', 'wipLimit 必须是 1–20 的整数');
  }
  if ('staleDays' in patch && !(Number.isFinite(Number(patch.staleDays)) && Number(patch.staleDays) >= 1 && Number(patch.staleDays) <= 60)) {
    throw fail('INVALID_INPUT', 'staleDays 必须是 1–60 的整数');
  }
  if ('owner' in patch && !trimStr(patch.owner, LIMITS.name)) {
    throw fail('INVALID_INPUT', 'owner 不能为空');
  }
  if ('showCanceled' in patch && typeof patch.showCanceled !== 'boolean') {
    throw fail('INVALID_INPUT', 'showCanceled 必须是布尔值');
  }
  const before = JSON.stringify(board.settings);
  board.settings = normalizeSettings({ ...board.settings, ...patch });
  const changed = before !== JSON.stringify(board.settings);
  if (changed) {
    addActivity(board, { by: 'human', kind: 'settings', text: '更新设置：' + Object.keys(patch).join('、') });
    bump(board);
  }
  return { settings: board.settings, changed };
}

/* ---------------- 统计 ---------------- */

/** 看板统计（CONTRACT §3 GET /state.stats）——全局语义不变。 */
export function computeStats(board, now) {
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : [];
  return computeStatsOf(tasks, now);
}

/** 对给定任务集合算全局形状的统计（项目级也要同形状）。 */
function computeStatsOf(tasks, now) {
  const today = localDateStr(now);
  const weekStart = weekStartDateStr(now);
  const total = tasks.length;
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = 0;
  const byType = {};
  for (const t of TYPES) byType[t] = 0;
  let open = 0;
  let dueToday = 0;
  let overdue = 0;
  let doneThisWeek = 0;
  for (const t of tasks) {
    if (!t) continue;
    if (Object.prototype.hasOwnProperty.call(byStatus, t.status)) byStatus[t.status] += 1;
    if (Object.prototype.hasOwnProperty.call(byType, t.type)) byType[t.type] += 1;
    const isOpen = t.status !== 'done' && t.status !== 'canceled';
    if (isOpen) {
      open += 1;
      if (t.due) {
        if (t.due === today) dueToday += 1;
        else if (t.due < today) overdue += 1;
      }
    }
    if (t.status === 'done' && t.doneAt) {
      const d = localDateStr(new Date(t.doneAt));
      if (d && d >= weekStart && d <= today) doneThisWeek += 1;
    }
  }
  return {
    total,
    byStatus,
    byType,
    open,
    doing: byStatus.doing,
    dueToday,
    overdue,
    blocked: byStatus.blocked,
    review: byStatus.review,
    doneThisWeek,
  };
}

/**
 * 项目统计（CONTRACT §10.2，服务端算，客户端直接用）。
 * progress = done / (total - canceled)，0–100 取整；dueSoon = 今天…+3 天（含）；
 * overdue = due < 今天；nextDue = 未关闭任务里最早的非空 due。
 */
export function computeProjectStats(board, projectId, now) {
  const pid = trimStr(projectId, 40);
  const project = findProject(board, pid);
  const nowDate = now === undefined ? new Date() : new Date(now);
  const base = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const today = localDateStr(base);
  const soonEnd = localDateStr(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 3));
  const tasks = (Array.isArray(board && board.tasks) ? board.tasks : []).filter(
    (t) => t && t.projectId === pid,
  );

  const out = {
    total: 0, open: 0, todo: 0, doing: 0, review: 0, blocked: 0, done: 0, canceled: 0,
    dueSoon: 0, overdue: 0, progress: 0, nextDue: '',
    updatedAt: project ? project.updatedAt : '',
  };
  const statuses = ['todo', 'doing', 'review', 'blocked', 'done', 'canceled'];
  for (const t of tasks) {
    out.total += 1;
    if (statuses.includes(t.status)) out[t.status] += 1;
    const isOpen = t.status !== 'done' && t.status !== 'canceled';
    if (!isOpen) continue;
    out.open += 1;
    if (t.due) {
      if (t.due < today) out.overdue += 1;
      else if (t.due <= soonEnd) out.dueSoon += 1;
      if (!out.nextDue || t.due < out.nextDue) out.nextDue = t.due;
    }
  }
  const denom = out.total - out.canceled;
  out.progress = denom > 0 ? Math.round((out.done / denom) * 100) : 0;
  return out;
}

function compactTask(t) {
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    typeLabel: typeLabel(t.type),
    status: t.status,
    statusLabel: statusLabel(t.status),
    priority: t.priority,
    owner: t.owner,
    due: t.due,
    progress: t.progress,
    estimate: t.estimate,
    spent: t.spent,
    blockedReason: t.blockedReason,
    reviewNote: t.reviewNote,
    projectId: t.projectId,
    startedAt: t.startedAt,
    updatedAt: t.updatedAt,
  };
}

function daysSince(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 0;
  const base = now === undefined ? Date.now() : new Date(now).getTime();
  return Math.max(0, Math.floor((base - t) / 86400000));
}

/**
 * 今日 / 本周简报：焦点分组 + 统计 + 建议（CONTRACT §4.4、§3 dev_brief）。
 * `opts.projectId` 给出时先按项目过滤任务与统计（§10.4）。
 * @param {object} board
 * @param {{period?:'today'|'week', now?:string|Date, projectId?:string}} [opts]
 */
export function buildBrief(board, opts = {}) {
  const period = opts.period === 'week' ? 'week' : 'today';
  const nowDate = opts.now === undefined ? new Date() : new Date(opts.now);
  const now = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const today = localDateStr(now);
  const weekStart = weekStartDateStr(now);
  const weekEnd = weekEndDateStr(now);
  const inPeriod = (due) => (period === 'week' ? due >= weekStart && due <= weekEnd : due === today);
  const staleDays = clampInt(board && board.settings && board.settings.staleDays, 1, 60, 3);

  const projectRef = trimStr(opts.projectId, 40);
  let project = null;
  if (projectRef) {
    project = findProject(board, projectRef);
    if (!project) {
      throw fail('INVALID_INPUT', '未知项目：' + projectRef + '；可用项目：' + projectListHint(board));
    }
  }
  const scopedTasks = (Array.isArray(board && board.tasks) ? board.tasks : []).filter(
    (t) => t && (!project || t.projectId === project.id),
  );
  const tasks = scopedTasks.filter((t) => t.status !== 'canceled');
  const isOpen = (t) => t.status !== 'done' && t.status !== 'canceled';

  const focus = { doing: [], dueToday: [], overdue: [], blocked: [], review: [], stale: [] };
  for (const t of tasks) {
    if (t.status === 'doing') focus.doing.push(compactTask(t));
    if (isOpen(t) && t.due && inPeriod(t.due)) focus.dueToday.push(compactTask(t));
    if (isOpen(t) && t.due && t.due < today) focus.overdue.push(compactTask(t));
    if (t.status === 'blocked') focus.blocked.push(compactTask(t));
    if (t.status === 'review') focus.review.push(compactTask(t));
    if (t.status === 'doing' && daysSince(t.updatedAt || t.createdAt, now) >= staleDays) focus.stale.push(compactTask(t));
  }

  /* §10.4：简报建议里体现项目名（全局简报时标注；单项目简报由抬头体现） */
  const projContext = (item) => {
    const pid = item && item.projectId ? item.projectId : '';
    const p = pid ? findProject(board, pid) : null;
    return {
      projectId: pid,
      projectName: p ? p.name : '',
      suffix: project ? '' : (p ? `（项目：${p.name}）` : '（未归属项目）'),
    };
  };
  const suggestions = [];
  for (const t of focus.overdue) {
    const n = Math.max(0, (Date.parse(today) - Date.parse(t.due)) / 86400000);
    const c = projContext(t);
    suggestions.push({
      code: 'overdue', severity: 'high', action: 'reschedule', taskId: t.id, title: t.title,
      projectId: c.projectId, projectName: c.projectName,
      text: `已逾期 ${Math.round(n)} 天：${t.title}——今天处理或改 due 重新排期${c.suffix}`,
    });
  }
  for (const t of focus.dueToday) {
    const c = projContext(t);
    suggestions.push({
      code: 'due', severity: 'medium', action: 'advance', taskId: t.id, title: t.title,
      projectId: c.projectId, projectName: c.projectName,
      text: `${period === 'week' ? '本周' : '今日'}到期：${t.title}——优先推进${c.suffix}`,
    });
  }
  for (const t of focus.blocked) {
    const c = projContext(t);
    suggestions.push({
      code: 'blocked', severity: 'high', action: 'unblock', taskId: t.id, title: t.title,
      projectId: c.projectId, projectName: c.projectName,
      text: `受阻：${t.title}${t.blockedReason ? '｜' + t.blockedReason : ''}——先处理卡点，或让 agent 用 dev_attention 提问${c.suffix}`,
    });
  }
  for (const t of focus.review) {
    const c = projContext(t);
    suggestions.push({
      code: 'review', severity: 'medium', action: 'human-review', taskId: t.id, title: t.title,
      projectId: c.projectId, projectName: c.projectName,
      text: `待验收：${t.title}——请在面板确认是否完成（done 只能由人验收）${c.suffix}`,
    });
  }
  for (const t of focus.stale) {
    const c = projContext(t);
    suggestions.push({
      code: 'stale', severity: 'low', action: 'update', taskId: t.id, title: t.title,
      projectId: c.projectId, projectName: c.projectName,
      text: `停滞 ${daysSince(t.updatedAt, now)} 天：${t.title}——推进、改状态或登记卡点${c.suffix}`,
    });
  }

  return {
    ok: true,
    period,
    today,
    window: period === 'week' ? { start: weekStart, end: weekEnd } : { start: today, end: today },
    generatedAt: nowIso(),
    rev: clampInt(board && board.rev, 0, 1e9, 0),
    project: project
      ? {
          id: project.id,
          name: project.name,
          color: project.color,
          status: project.status,
          /* v3（§11）：项目绑定的空间快照（未绑定为 null） */
          workspace: projectWorkspaceSnapshot(project),
          workspaceName: projectWorkspaceLabel(project),
        }
      : null,
    projectName: project ? project.name : '',
    focus,
    stats: computeStatsOf(scopedTasks, now),
    suggestions,
  };
}

/**
 * `dev_brief` apply=true 时的安全动作（仅 assisted / auto）：
 * 给「受阻且没有下一步日期」的任务追加一条活动提示，不建重复任务、不改任务字段。
 * observe 模式不做任何事。
 * @returns {{applied:Array<{taskId:string,text:string}>, skipped:string}}
 */
export function applyBriefActions(board, opts = {}) {
  const autonomy = board && board.settings ? board.settings.autonomy : 'observe';
  if (autonomy === 'observe' || !AUTONOMY_MODES.includes(autonomy)) {
    return { applied: [], skipped: 'observe' };
  }
  const brief = buildBrief(board, opts);
  const applied = [];
  for (const item of brief.focus.blocked) {
    if (item.due) continue; // 已有下一步日期，不重复提醒
    const text = '简报提示：任务受阻且没有下一步日期——补 due 或处理卡点后回到进行中';
    addActivity(board, { by: 'agent', kind: 'update', taskId: item.id, text });
    applied.push({ taskId: item.id, text });
  }
  if (applied.length) bump(board);
  return { applied, skipped: '' };
}

/* ---------------- handoff 提示词 ---------------- */

const statusStep = {
  todo: '待办', doing: '进行中', review: '待验收', blocked: '受阻', done: '已完成', canceled: '已取消',
};

function oneLine(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 项目标签：`名称（P-1）`；接受项目对象或名称字符串。 */
function projectLabelOf(project) {
  if (!project) return '';
  if (typeof project === 'string') return trimStr(project, LIMITS.projectName);
  const nm = trimStr(project.name, LIMITS.projectName);
  if (!nm) return '';
  return project.id ? `${nm}（${project.id}）` : nm;
}

function fmtTaskBlock(task, project) {
  const lines = [];
  lines.push(`【任务】${task.id} · ${task.title}`);
  lines.push(`状态：${statusLabel(task.status)}｜类型：${typeLabel(task.type)}｜优先级：${task.priority}｜负责人：${task.owner || '我'}`);
  const projectLabel = projectLabelOf(project);
  if (projectLabel) {
    /* v3（§11.2）：派会话的 prompt 明确「项目：X｜空间：Y」 */
    const sp = projectWorkspaceSnapshot(project);
    const spaceLabel = sp ? (sp.title || sp.path || sp.id) : '未绑定';
    lines.push('项目：' + projectLabel + '｜空间：' + spaceLabel);
  }
  const meta = [];
  if (task.due) meta.push('到期 ' + task.due);
  if (task.estimate) meta.push('预估 ' + task.estimate + 'h');
  if (task.spent) meta.push('已投入 ' + task.spent + 'h');
  meta.push('进度 ' + task.progress + '%');
  lines.push(meta.join('｜'));
  if (task.description) {
    lines.push('');
    lines.push('【说明】');
    lines.push(task.description.length > 2000 ? task.description.slice(0, 2000) + '\n…（说明过长已截断，完整内容见看板）' : task.description);
  }
  if (task.checklist && task.checklist.length) {
    lines.push('');
    lines.push('【检查项】');
    for (const c of task.checklist) lines.push(`- [${c.done ? 'x' : ' '}] ${c.text}（${c.id}）`);
  }
  if (task.artifacts && task.artifacts.length) {
    lines.push('');
    lines.push('【已有产出】');
    for (const a of task.artifacts) lines.push(`- ${a.label}：${a.path}`);
  }
  if (task.links && task.links.length) {
    lines.push('');
    lines.push('【链接】');
    for (const l of task.links) lines.push(`- [${l.kind}] ${l.label}：${l.ref}`);
  }
  if (task.dependencies && task.dependencies.length) {
    lines.push('');
    lines.push('【依赖】' + task.dependencies.join('、'));
  }
  if (task.blockedReason) {
    lines.push('');
    lines.push('【当前卡点】' + task.blockedReason);
  }
  if (task.reviewNote) {
    lines.push('');
    lines.push('【上轮回执】' + task.reviewNote);
  }
  return lines.join('\n');
}

const REPORT_RULE = [
  '【回报协议】完成后用 `dev_item`（action=report）回报，kind 取：',
  '- progress（进行中）/ ready（待验收，只进待验收，不会自动完成）/ blocked（受阻并生成注意力）/ failed（保持进行中并生成注意力）/ dropped（取消）。',
  '- 摘要 ≤300 字 + artifacts 文件路径；长文写文件，不要整段贴进消息。',
  '- 需要人决定时用 `dev_attention`（action=ask）提问，不要自行替人决定。',
  '- 不得标记任务完成（done）、不得删除任务、不得代替人回答注意力（红线）。',
];

/**
 * handoff 提示词：按 mode 生成执行会话的初始指令。
 * @param {object|null} task 任务（可为 null：不指定任务）
 * @param {'work'|'review'|'plan'} mode
 * @param {object|string|null} [project] 项目（对象或名称；给了就在 prompt 里带项目名与空间名，v3 §11.2）
 */
export function HANDOFF_PROMPT(task, mode, project) {
  const m = HANDOFF_MODES.includes(mode) ? mode : 'work';
  const t = task && typeof task === 'object' && task.id ? task : null;
  const projectLabel = projectLabelOf(project);
  const lines = [];

  if (!t) {
    lines.push('开发工作台 · 执行会话（未指定任务）');
    if (projectLabel) {
      lines.push('');
      lines.push('【项目】' + projectLabel);
      const sp = projectWorkspaceSnapshot(project);
      const spaceLabel = sp ? (sp.title || sp.path || sp.id) : '未绑定';
      lines.push('【空间】' + spaceLabel + (sp && sp.title && sp.path ? '（' + sp.path + '）' : ''));
      lines.push('需要只看该项目时用 `dev_board`（view=board, project=' + projectLabel + '）。');
    }
    lines.push('');
    lines.push('【第一步】先 `dev_board`（view=brief）读今日简报；需要全量看板时 view=board。');
    lines.push('');
    if (m === 'review') {
      lines.push('【本轮目标】验收巡检：逐条检查「待验收」任务，确认产出可复现、验收标准是否满足，给出逐项结论与返工建议。');
      lines.push('- 用 `dev_board`（view=task, id=…）读任务全文与 artifacts；必要时查看产出文件。');
      lines.push('- 结论用 `dev_item` action=report（kind=ready，附审查文件路径）回报；最终 done 只能由人在面板点。');
    } else if (m === 'plan') {
      lines.push('【本轮目标】规划：结合今日简报与看板，拆解接下来要做的任务、排期、依赖与风险，输出一份计划文件。');
      lines.push('- 可写：用 `dev_item` action=create 建任务、action=update 补 description/checklist/dependencies/due。');
      lines.push('- 不得把任务标记为 done；不得删除任务。');
    } else {
      lines.push('【本轮目标】从看板里挑一个最该做的任务（优先：已逾期 → 今日到期 → 受阻恢复 → 进行中），开始执行。');
      lines.push('- 用 `dev_board`（view=task, id=…）读任务全文；执行前先用 `dev_item` action=move 把任务移到 doing。');
    }
    lines.push('');
    lines.push(...REPORT_RULE);
    return lines.join('\n');
  }

  if (m === 'plan') {
    lines.push(`开发工作台 · 任务规划（${t.id}）`);
  } else if (m === 'review') {
    lines.push(`开发工作台 · 任务验收（${t.id}）`);
  } else {
    lines.push(`开发工作台 · 任务执行（${t.id}）`);
  }
  lines.push('');
  lines.push(fmtTaskBlock(t, project));
  lines.push('');
  if (m === 'work') {
    lines.push('【本轮目标】把该任务推进到可交付状态。');
    lines.push('1. 先用 `dev_board`（view=task, id=' + t.id + '）确认上下文（说明 / 检查项 / 产出 / 依赖）。');
    lines.push('2. 已明确要做的工作直接做；开始执行前用 `dev_item` action=move, status=doing 把任务移到进行中。');
    lines.push('3. 遇到需要人拍板的问题，用 `dev_attention` action=ask 提问，不要替人决定。');
    lines.push('4. 完成后按回报协议回报（通常 kind=ready 等验收）。');
  } else if (m === 'review') {
    lines.push('【本轮目标】验收评审：核对产出与验收标准，找出问题与缺口。');
    lines.push('1. 先 `dev_board`（view=task, id=' + t.id + '）读任务全文，逐条核对检查项与 artifacts。');
    lines.push('2. 产出审查结论（通过 / 有条件通过 / 返工），写成文件并把路径放进 report.artifacts。');
    lines.push('3. 有阻塞或需要人决定，用 `dev_attention` action=ask 提问。');
    lines.push('4. 用 `dev_item` action=report 回报结论；最终 done 只能由人在面板点。');
  } else {
    lines.push('【本轮目标】把任务拆解成可执行的计划。');
    lines.push('1. 先 `dev_board`（view=task, id=' + t.id + '）确认现状与约束。');
    lines.push('2. 用 `dev_item` action=update 补 description / checklist / dependencies / due（可写字段见工具说明）。');
    lines.push('3. 需要独立跟踪的子项用 `dev_item` action=create 建任务（不要重复建同一件事）。');
    lines.push('4. 计划写成文件，用 report.artifacts 附上路径；不得把任务标记为 done。');
  }
  lines.push('');
  lines.push(...REPORT_RULE);
  return lines.join('\n');
}

/** 当前状态文案（供提示词/文本复用）。 */
export function taskStatusStep(task) {
  return statusStep[task && task.status] || '';
}
