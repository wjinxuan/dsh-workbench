/**
 * dsh-devwork · 宿主半 · 通用工具
 *
 * 零第三方依赖（只用 node: 内置模块）。
 * 负责：时间、id、数值/字符串清洗、原子写 JSON、坏 JSON 备份读、工作区根安全校验。
 */

import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync, statSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, resolve, parse } from 'node:path';

/* ---------------- 错误 ---------------- */

/**
 * 带 code 的错误：INVALID_INPUT / INVALID_ROOT / NOT_FOUND / INVALID_TRANSITION /
 * HUMAN_ONLY / PROJECT_NOT_EMPTY / READ_FAILED / WRITE_FAILED。
 * 路由层按 code 映射 HTTP 状态码，工具层按 code 给中文提示。
 */
export class DevworkError extends Error {
  constructor(code, message, extra) {
    super(String(message || code || 'DEVWORK_ERROR'));
    this.name = 'DevworkError';
    this.code = String(code || 'ERROR');
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        if (k !== 'code' && k !== 'message' && k !== 'name') this[k] = v;
      }
    }
  }
}

/** 构造一个带 code 的错误（不 throw）。 */
export function fail(code, message, extra) {
  return new DevworkError(code, message, extra);
}

export function isDevworkError(e) {
  return e instanceof DevworkError;
}

/** 取错误文案（用于兜底日志 / reason）。 */
export function errText(e) {
  return String((e && (e.message || e.code)) || e || '未知错误');
}

/* ---------------- 时间 ---------------- */

/** 当前（或指定时间）ISO8601 字符串，UTC。 */
export function nowIso(d) {
  const x = d === undefined ? new Date() : new Date(d);
  return x.toISOString();
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 本地日期 YYYY-MM-DD（due 比较一律用本地日期，不用 UTC，避免时区错日）。
 */
export function localDateStr(d) {
  const x = d === undefined ? new Date() : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

/** 是否合法 ISO8601 时间串。 */
export function isIso(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

/** 是否合法本地日期 YYYY-MM-DD（含真实日历校验）。 */
export function isDateStr(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
  const x = new Date(y, mo - 1, da);
  return x.getFullYear() === y && x.getMonth() === mo - 1 && x.getDate() === da;
}

/** 本周一（本地）日期串。 */
export function weekStartDateStr(d) {
  const x = d === undefined ? new Date() : new Date(d);
  const day = x.getDay(); // 0=周日
  const back = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - back);
  return localDateStr(x);
}

/** 本周日（本地）日期串。 */
export function weekEndDateStr(d) {
  const x = d === undefined ? new Date() : new Date(d);
  const day = x.getDay();
  const fwd = day === 0 ? 0 : 7 - day;
  x.setDate(x.getDate() + fwd);
  return localDateStr(x);
}

/* ---------------- id ---------------- */

/** `T-12` / `A-3`：前缀 + 单调自增序号（永不复用）。 */
export function formatId(prefix, seq) {
  const n = Math.max(0, Math.trunc(Number(seq) || 0));
  return `${String(prefix || 'X')}-${n}`;
}

export const TASK_ID_RE = /^T-\d+$/;
export const ATTENTION_ID_RE = /^A-\d+$/;
export const PROJECT_ID_RE = /^P-\d+$/;
export const ANY_ID_RE = /^[TAP]-\d+$/;

/** 从 `T-12` / `A-3` / `P-1` 里取数字；不是合法 id 返回 0。 */
export function idSeq(id) {
  const m = /^[TAP]-(\d+)$/.exec(String(id || '').trim());
  return m ? Number(m[1]) : 0;
}

/* ---------------- 清洗 ---------------- */

/** trim + 长度上限；非字符串一律按空串处理（null/undefined → ''）。 */
export function trimStr(v, max = 200) {
  if (v === null || v === undefined) return '';
  let s;
  try { s = typeof v === 'string' ? v : String(v); } catch { return ''; }
  s = s.trim();
  if (!s) return '';
  return s.slice(0, Math.max(1, Math.trunc(Number(max) || 200)));
}

export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 整数夹取；非法返回 def。 */
export function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 数值夹取（保留两位小数）；非法返回 def。 */
export function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const x = Math.min(max, Math.max(min, n));
  return Math.round(x * 100) / 100;
}

/* ---------------- 文件 ---------------- */

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * 原子写 JSON：同目录 `<file>.tmp` → `rename`。
 * rename 在同一文件系统上是原子的，读方永远看到完整文件。
 */
export function atomicWriteJson(file, data) {
  const dir = dirname(file);
  ensureDir(dir);
  const tmp = file + '.tmp';
  let body;
  try {
    body = JSON.stringify(data, null, 2) + '\n';
  } catch (e) {
    throw fail('INVALID_INPUT', '状态序列化失败：' + errText(e));
  }
  try {
    writeFileSync(tmp, body, 'utf8');
  } catch (e) {
    throw fail('WRITE_FAILED', '写入临时文件失败：' + errText(e));
  }
  try {
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 忽略 */ }
    throw fail('WRITE_FAILED', '替换状态文件失败：' + errText(e));
  }
  return file;
}

/** 备份时间戳：20261111-143001（本地，文件名安全）。 */
function backupStamp(d) {
  const x = d || new Date();
  return `${x.getFullYear()}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}-${pad2(x.getHours())}${pad2(x.getMinutes())}${pad2(x.getSeconds())}`;
}

/**
 * 安全读 JSON：
 * - 不存在 → { ok:true, existed:false, value:null }
 * - 空文件 → { ok:true, existed:true, empty:true, value:null }
 * - 坏 JSON → 原名备份为 `<file>.bad-<ts>`，返回 { ok:false, bad:true, backup }
 * - 其他读失败 → { ok:false, error }
 */
export function readJsonSafe(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, existed: false, value: null, backup: '' };
    return { ok: false, existed: true, bad: false, value: null, backup: '', error: errText(e) };
  }
  if (!raw || !raw.trim()) return { ok: true, existed: true, empty: true, value: null, backup: '' };
  try {
    return { ok: true, existed: true, value: JSON.parse(raw), backup: '' };
  } catch (e) {
    const backup = `${file}.bad-${backupStamp()}`;
    try {
      renameSync(file, backup);
      return { ok: false, existed: true, bad: true, value: null, backup, error: errText(e) };
    } catch (e2) {
      return { ok: false, existed: true, bad: true, value: null, backup: '', error: errText(e2) };
    }
  }
}

/**
 * 工作区根安全校验：必须显式给出、存在、是目录、不是文件系统根。
 * @returns {string} 绝对路径
 * @throws {DevworkError} INVALID_ROOT / INVALID_INPUT
 */
export function assertSafeRoot(root) {
  const raw = trimStr(root, 2000);
  if (!raw) throw fail('INVALID_INPUT', '工作区根为空');
  let abs;
  try {
    abs = resolve(raw);
  } catch {
    throw fail('INVALID_ROOT', '工作区路径非法：' + raw);
  }
  const p = parse(abs);
  if (abs === p.root || abs === '/') {
    throw fail('INVALID_ROOT', '不能使用文件系统根作为工作区：' + abs);
  }
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw fail('INVALID_ROOT', '工作区不存在：' + abs);
  }
  if (!st.isDirectory()) throw fail('INVALID_ROOT', '工作区必须是目录：' + abs);
  return abs;
}

/** 规范化路径（realpath 失败时回退 resolve），用于根比较。 */
export function normPath(p) {
  const raw = trimStr(p, 4000);
  if (!raw) return '';
  try {
    return realpathSync(resolve(raw));
  } catch {
    try { return resolve(raw); } catch { return raw; }
  }
}

/** 路径 p 是否在 root 之下（含 root 本身）。 */
export function isUnder(root, p) {
  const r = normPath(root);
  const x = normPath(p);
  if (!r || !x) return false;
  return x === r || x.startsWith(r + '/') || x.startsWith(r + '\\');
}

/** 文件/目录是否存在（吞异常）。 */
export function exists(p) {
  try { return existsSync(p); } catch { return false; }
}
