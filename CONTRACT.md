# dsh-devwork · 实现契约（v0.1）

> 本文件是「开发工作台」插件宿主半与前端半之间的冻结契约。任何一方改动字段/路径，
> 必须同时更新本文件与 `client.js`。数据文件是唯一事实源。

## 0. 产品定位

在 DeepSeek Harness 的左侧栏增加「开发工作台」面板：一个人管理自己当前的工作任务
（设计 / 产品逻辑 / 开发 / 测试 / 调研 / 运维），用 5 列看板 + 今日焦点 + 活动流
实时跟踪状态；agent 通过工具读写同一份数据，执行会话用 `dev_item` 回报。

- 包名：`dsh-devwork`（宿主导入行 id 相同；客户端模块 id 相同）
- 侧栏入口 id：`devwork`，main 槽 key：`devwork`（与侧栏 id 一致）
- HTTP 前缀：`/devwork/api`
- 数据文件：`<工作区根>/.devwork/board.json`
- 面板名称：开发工作台（Dev workbench）

## 1. 数据模型

`board.json` 顶层：

```json
{
  "version": 1,
  "rev": 7,
  "seq": 7,
  "project": { "name": "开发工作台", "workspace": "/abs/workspace" },
  "settings": {
    "autonomy": "observe",
    "wipLimit": 3,
    "staleDays": 3,
    "owner": "我",
    "showCanceled": false
  },
  "tasks": [],
  "attention": [],
  "activity": [],
  "updatedAt": "2026-11-11T06:30:00.000Z"
}
```

- `rev`：每次成功写入 +1，SSE 与轮询用它判断是否变化。
- `seq`：任务/注意力编号自增，id 形如 `T-12`、`A-3`（永不复用）。
- `activity` 只保留最近 100 条，**最新条目在数组末尾**（面板倒序渲染）。

### 1.1 Task

```json
{
  "id": "T-12",
  "title": "登录页空状态设计",
  "description": "支持换行纯文本；不做 markdown 渲染。",
  "type": "design",
  "status": "todo",
  "priority": "P2",
  "owner": "我",
  "due": "2026-11-14",
  "estimate": 4,
  "spent": 1.5,
  "progress": 0,
  "tags": ["登录", "v0.2"],
  "checklist": [{ "id": "c1", "text": "线框", "done": false }],
  "artifacts": [{ "label": "设计稿", "path": "docs/login.fig" }],
  "links": [{ "kind": "session", "label": "执行会话", "ref": "session-xxx" }],
  "dependencies": ["T-3"],
  "blockedReason": "",
  "reviewNote": "",
  "sessionId": "",
  "startedAt": "",
  "doneAt": "",
  "createdAt": "2026-11-11T06:00:00.000Z",
  "updatedAt": "2026-11-11T06:20:00.000Z"
}
```

枚举：

- `type`: `design`（设计）| `product`（产品逻辑）| `dev`（开发）| `qa`（测试）| `research`（调研）| `ops`（运维）
- `status`: `todo`（待办）| `doing`（进行中）| `review`（待验收）| `blocked`（受阻）| `done`（已完成）| `canceled`（已取消）
- `priority`: `P0` | `P1` | `P2` | `P3`
- `links[].kind`: `session` | `doc` | `url` | `spec`

边界：`due` 为本地日期 `YYYY-MM-DD` 或空串；`estimate`/`spent` 为小时数（可为小数）；
`progress` 0–100 整数；字符串字段一律 trim 且长度上限（title 200、description 8000、
tags/名 40、path 500）。

### 1.2 Attention（注意力）

```json
{
  "id": "A-3",
  "target": { "kind": "task", "id": "T-12" },
  "kind": "decision",
  "question": "这个交互要保留双栏吗？",
  "askedAt": "2026-11-11T06:10:00.000Z",
  "status": "open",
  "answer": "",
  "resolvedAt": ""
}
```

- `kind`: `decision` | `blocked` | `question` | `review`
- `target.kind`: `task` | `board`
- 只有人能在面板上 resolve；agent 工具只能 ask/list。

### 1.3 Activity

```json
{ "at": "ISO", "by": "human", "kind": "move", "taskId": "T-12", "text": "待办 → 进行中" }
```

- `by`: `human` | `agent` | `system`
- `kind`: `create` | `update` | `move` | `report` | `checkin` | `attention` | `delete` | `settings`
- `text` ≤ 200 字。

## 2. 状态机

允许的流转（方向不可跳级，`done` 只能由人进入）：

| 从 | 到 |
|---|---|
| todo | doing, blocked, canceled |
| doing | review, blocked, todo |
| review | doing, done（人）, canceled |
| blocked | doing, todo, canceled |
| done | review, todo（重开） |
| canceled | todo |

- 进入 `doing`：`startedAt = now`（若为空）。
- 进入 `done`：`doneAt = now`、`progress = 100`。
- 进入 `review`：`doneAt` 清空。
- 非法流转：HTTP 409 `{ok:false, code:"INVALID_TRANSITION", reason}`。
- **`done` 只能由 human 触发**；agent 工具带 `status:"done"` 一律 409/工具错误 `HUMAN_ONLY`。
- **删除任务只能由人**；agent 工具不提供 delete。

## 3. HTTP API

统一：JSON、`ok:true` / `ok:false` + `reason` + `code`；`Cache-Control: no-store`。
可选 `root` 参数（query/body）指定工作区根；缺省用工作区自动探测。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/devwork/api/meta` | 版本、枚举、状态机、工作区根 |
| GET | `/devwork/api/state` | 全量状态（见下） |
| GET | `/devwork/api/stream` | SSE：`hello` / `state`（rev 变化）事件 |
| POST | `/devwork/api/task/create` | `{title, ...fields}` → `{ok,task,rev}` |
| POST | `/devwork/api/task/update` | `{id, patch}` → `{ok,task,rev}` |
| POST | `/devwork/api/task/move` | `{id, status, note?}` → `{ok,task,rev}` |
| POST | `/devwork/api/task/delete` | `{id}` → `{ok,rev}`（面板专用） |
| POST | `/devwork/api/task/checkin` | `{id, note, status?, progress?, spent?}` |
| POST | `/devwork/api/attention/ask` | `{question, kind?, target?}` |
| POST | `/devwork/api/attention/resolve` | `{id, answer}`（面板专用） |
| POST | `/devwork/api/settings/update` | `{patch}` |
| POST | `/devwork/api/handoff` | `{taskId?, mode:"work"|"review"|"plan", prompt?}` → `{ok,sessionId}` |

`GET /state` 响应：

```json
{
  "ok": true,
  "root": "/abs/workspace",
  "rootHow": "workspaceRegistry.list()",
  "rev": 7,
  "now": "2026-11-11T06:30:00.000Z",
  "project": { "name": "开发工作台", "workspace": "/abs/workspace" },
  "settings": { "autonomy": "observe", "wipLimit": 3, "staleDays": 3, "owner": "我", "showCanceled": false },
  "tasks": [],
  "attention": [],
  "activity": [],
  "stats": {
    "total": 0,
    "byStatus": { "todo": 0, "doing": 0, "review": 0, "blocked": 0, "done": 0, "canceled": 0 },
    "byType": { "design": 0, "product": 0, "dev": 0, "qa": 0, "research": 0, "ops": 0 },
    "open": 0, "doing": 0, "dueToday": 0, "overdue": 0, "blocked": 0, "review": 0, "doneThisWeek": 0
  }
}
```

SSE：`event: state\ndata: {"rev":8}\n\n`；`event: hello\ndata: {"rev":7}\n\n`；
每 20s 发 `: ping\n\n`。连接关闭时清理。

## 4. agent 工具（宿主半注册）

工具名前缀 `dev_`，中文描述。全部返回 `{ text, ...结构化数据 }`，`render` 输出 text。

### 4.1 `dev_board`

- `view`: `board` | `brief` | `task` | `stats`（默认 `board`）
- `id`：view=task 时必填
- 过滤：`status` `type` `priority` `owner` `q`（标题/标签模糊）
- `root` 可选
- 只读。`board` 返回按状态分组的清单 + 统计；`task` 返回单任务全文。

### 4.2 `dev_item`

- `action`: `create` | `update` | `move` | `report`
- `id`（update/move/report 必填）
- `patch`（create/update）：可写字段 `title/description/type/priority/owner/due/estimate/spent/progress/tags/checklist/artifacts/links/dependencies/blockedReason/reviewNote`
- `status` + `note`（move）
- `report`: `{ kind: progress|ready|blocked|failed|dropped, text, artifacts?: string[] }`
- `root` 可选

report 语义：

| kind | 效果 |
|---|---|
| progress | status=doing，activity=report |
| ready | status=review，reviewNote=text，artifacts 追加，activity |
| blocked | status=blocked，blockedReason=text，自动建 attention（kind=blocked）。注：状态机无 review→blocked 直达边，宿主沿用合法路径逐步推进（如 review→doing→blocked），move 仍严格单步 |
| failed | 保持 doing，自动建 attention（kind=blocked，问题=失败摘要） |
| dropped | status=canceled |

红线：`create/update/move` 不得写 `status:"done"`；不得删除；`report` 不得产生 `done`。

### 4.3 `dev_attention`

- `action`: `ask` | `list` | `resolve`
- `ask`: `question` 必填，`kind`（默认 decision）、`target`
- `list`: 返回 open 注意力
- `resolve`: **拒绝**（`HUMAN_ONLY`，人只能在面板回答）
- `root` 可选

### 4.4 `dev_brief`

- `period`: `today` | `week`（默认 today）
- `apply`: boolean（默认 false）。`apply=true` 且 `settings.autonomy` 非 observe 时，
  把「无下一步的受阻任务」建议落成一次安全动作：给该任务追加活动提示（不建重复任务）。
- `root` 可选
- 返回：今日焦点（进行中 / 今日到期 / 已逾期 / 受阻 / 待验收 / 停滞）、统计、建议。

## 5. 工作区根解析

顺序（与 FDE 工作站一致，避免多工作区错认）：

1. 显式 `root`：必须存在、是目录、非文件系统根，且（若 registry 可用）在已注册工作区内。
2. `workspaceRegistry.current()/getCurrent()/active()` 返回对象的路径。
3. `workspaceRegistry.list()` 中第一个存在的路径。
4. `sessionController.current()` 的 cwd/workspace。
5. `process.cwd()` 逐级上溯（≤6 层），找到含 `.git` / `package.json` / `.devwork` 的目录。
6. 兜底 `process.cwd()`。

`rootHow` 记录依据，面板显示。

## 6. 宿主实现要求

- `index.js` ESM，`export function apply(ctx)`；`export const inject = ['tools', 'systemPrompt']`。
- 可选服务用 `ctx.get(...)`：`webServer`、`connection`、`workspaceRegistry`、`sessionController`、`logger`。
- 路由注册统一守卫：方法白名单 → `connection.admit(req)`（不可用时 Host/Origin 回环 fence）→ POST JSON 类型。
- 所有副作用在 `apply` 内用 `ctx.effect` / 返回清理函数。
- 文件写入：同目录 `board.json.tmp` → `rename`；同进程串行队列；坏 JSON 备份为 `board.json.bad-<ts>` 后重建空板。
- SSE 连接集合：mutation 后广播 `{rev}`；`ctx.effect` 关闭时清理所有连接。
- 系统提示词注入（见 §7）。
- 时间：`new Date().toISOString()`；本地日期用于 due 比较（`YYYY-MM-DD`）。

## 7. 系统提示词注入（逐字使用，order 取 TOOL_REPORT）

```text
开发工作台 · 插件已装配（面板在左侧「开发工作台」）。

【身份】你是开发工作台的编排者：任务（task）在 5 列看板流转（待办 / 进行中 / 待验收 / 受阻 / 已完成），类型分设计、产品、开发、测试、调研、运维；需要人决定的事进注意力（attention）。

【何时启用】用户问「今天做什么 / 任务到哪一步 / 有什么卡住」，或要求拆需求、排期、跟踪进度时：先 `dev_board`（view=brief）读状态，再执行。

【状态落点】`<工作区>/.devwork/board.json`，只通过 `dev_board`/`dev_item`/`dev_attention`/`dev_brief` 与面板读写，不要手改文件。

【工具边界】`dev_board` 只读；`dev_item` 建/改/移/回报；`dev_attention` 提问与查看；`dev_brief` 今日简报。不存在删除工具。

【状态机】待办 → 进行中 → 待验收 → 已完成（`done` 只能由人验收）；受阻是异常停留列，恢复后回到进行中或待验收，须由人确认。

【回报协议】执行完成后用 `dev_item` action=report 回报：progress（进行中）/ ready（待验收，只进待验收，不会自动完成）/ blocked（受阻并生成注意力）/ failed（保持进行中并生成注意力）/ dropped。摘要 ≤300 字 + artifacts 文件路径；长文写文件。

【红线】① 标记任务完成（done）② 删除任务 ③ 代替人回答注意力 ④ 对外发送材料 —— 只能由人做。agent 只准备、建议、提问、提醒。
```

## 8. 面板（client.js）契约

- 注册：`ctx.slots.inject('sidebar.panellist', ...)` 注册 id `devwork`、order 34、label「开发工作台」；
  `ctx.slots.inject('main', ...)` 注册 key `devwork` 渲染面板。
- 依赖：`inject: ['slots', 'uiWorkspace']`。
- 数据：启动 `GET /devwork/api/state`；`EventSource('/devwork/api/stream')` 收到 state 事件即重拉；
  失败降级为 15s 轮询（页面隐藏时暂停）；所有写操作后重拉。
- 打开会话：`POST /handoff` 拿 `sessionId`，再 `uiWorkspace.openSession(sessionId)`。
- 只用 `--dsw-alias-*` 主题 token + 自身类型色；明暗主题均可读；不得读写其它插件 DOM。

## 9. 文件所有权（并行开发）

| 文件 | 负责人 |
|---|---|
| `index.js`, `src/store.js`, `src/util.js` | host-dev |
| `client.js`, `DESIGN.md`, `README.md` | lead |
| `package.json`, `cordis.patch.yml`, `locale/*`, `icon.svg`, `CONTRACT.md` | lead（host-dev 只读） |

---

## 10. v2：项目与多项目并行（本次增强）

> 目标：任务归属到项目；同一看板并行推进多个项目；面板可「全部项目」总览或切到单个项目；
> agent 可按项目创建 / 查询 / 简报。数据向后兼容 v1（自动迁移，不丢任务）。

### 10.1 数据结构（version = 2）

```json
{
  "version": 2,
  "projects": [
    {
      "id": "P-1",
      "name": "默认项目",
      "color": "#5B7CFA",
      "description": "",
      "status": "active",
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  ],
  "tasks": [ { "projectId": "P-1" } ]
}
```

- `projects` 最多 50 个；`status`: `active` | `paused` | `done`。
- `name` 1–80 字符且不允许重复（忽略大小写与首尾空格）；`color` 必须 `^#[0-9a-fA-F]{6}$`，
  缺省 `#5B7CFA`；`description` ≤ 2000。
- `tasks[].projectId`：必须是已存在的项目 id；空串表示未归属。
- `seq` 在 T/A/P 之间共享自增；项目 id 形如 `P-3`。
- **默认项目**：空板初始化时创建 `{id:'P-1', name:'默认项目', color:'#5B7CFA'}`，`seq>=1`。
- **v1 → v2 迁移**（`normalizeBoard` 内，读入即迁移，保存后落盘）：
  1) `projects` 缺失/为空 → 建 `P-1 默认项目`；
  2) `tasks[].projectId` 缺失、非法或指向不存在项目 → 改为 `P-1`；
  3) `version` 写 2。
- 创建任务未给 `projectId` 时：只有 1 个项目 → 用该项目；否则留空串（未归属）。

### 10.2 项目统计

`GET /state` 的每个 project 附带 `stats`（服务端算，客户端直接用）：

```json
"stats": {
  "total": 8, "open": 5, "todo": 2, "doing": 2, "review": 1, "blocked": 1, "done": 2, "canceled": 1,
  "dueSoon": 2, "overdue": 1, "progress": 75,
  "nextDue": "2026-11-12", "updatedAt": "ISO"
}
```

- `progress` = 非 canceled 任务的完成率（done / (total - canceled)，0–100 取整）。
- `dueSoon` = 未关闭且 due 在「今天…+3 天」内（含今天）；`overdue` = 未关闭且 due < 今天。
- `nextDue` = 未关闭任务里最早的非空 due，没有则空串。

### 10.3 HTTP 变更

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/state` | 增加 `projects: [Project + stats]`（stats 全局字段不变） |
| POST | `/project/create` | `{name, color?, description?}` → `{ok, project, rev}`（human 面板路径） |
| POST | `/project/update` | `{id, patch:{name?,color?,description?,status?}}` → `{ok, project, rev}` |
| POST | `/project/delete` | `{id, moveTo?}` → `{ok, rev}`；仅 human。项目有任务且未给 `moveTo` → 409 `PROJECT_NOT_EMPTY`；`moveTo`（项目 id 或 `""`）先把任务改归该项目再删；删到 0 个项目时自动补默认项目 |
| POST | `/task/create` | 接受 `projectId`（校验存在；空串允许） |
| POST | `/task/update` | `patch` 可含 `projectId`（允许改归属；空串=未归属） |
| POST | `/handoff` | prompt 里带上项目名（`task` 存在时） |

`GET /meta` 增加：`projectStatuses`、`projectColors`、`limits.projectsMax`。

### 10.4 工具变更

- **新增 `dev_project`**
  - `action`: `list` | `create` | `update`
  - `create`: `{name, color?, description?}`；`update`: `{id 或 project, patch:{name?,color?,description?,status?}}`
  - `list` 返回各项目 + stats；**没有 delete**（删除只能由人在面板执行，agent 调用 delete → 返回 HUMAN_ONLY）
- **`dev_board`**：新增 `project`（id 或名称，模糊匹配）；`view` 新增 `projects`（项目总览文本）。
  过滤优先级：`project` 参数 > 无（全部项目）。
- **`dev_item`**：`create` / `update` 接受 `project`（id 或名称）解析为 `projectId`；未知项目 → `INVALID_INPUT`。
  `patch.projectId` 也可直接写（HTTP 路径用）。任务输出里带项目名。
- **`dev_brief`**：新增 `project` 过滤；简报抬头带项目名。
- **`dev_attention`**：`ask` 新增可选 `project`（id 或名称）→ target `{kind:'project', id}`。
- **系统提示词**（§7）追加一段：

```text
【项目与并行】任务必须归属项目（`dev_project list` 查看；`dev_item create/update` 传 `project`）。
多个项目可同时推进：默认在「全部项目」下工作，需要聚焦时用 `dev_board project=<id或名称>` 过滤；
跨项目排期用 `dev_brief`。新建项目用 `dev_project create`；删除项目只能由人在面板执行。
```

### 10.5 面板（client.js）变更

- 顶部新增**项目切换器**：`全部项目 · N` / 单个项目（色点 + 名称 + 未完成数）；菜单含
  「全部项目」、每个项目、「＋ 新建项目」、「管理项目」。
- 视图变为 5 个：今日 / 看板 / 列表 / **项目** / 活动；所有视图尊重当前项目筛选。
- 任务卡与表格在「全部项目」模式下显示项目色点 + 短名。
- 任务抽屉与新建对话框增加「项目」下拉（默认当前筛选项目或唯一项目）。
- 新增「项目」视图：项目卡片（色条、名称、状态、进度条、各状态计数、最近到期），
  卡片菜单：编辑 / 删除（删除需人确认，失败显示原因）。
- 项目对话框：新建/编辑名称、颜色（8 色预设）、描述、状态。
- 项目筛选持久化在 `localStorage['dsh-devwork:project']`；指向已删除项目时回退「全部项目」。
- 空状态：没有项目时提示新建项目（正常空板会自动带默认项目）。

### 10.6 验收

1. `node --check` 三文件通过；mock 联调：v1 板读入自动迁移、项目 CRUD、按项目过滤、
   跨项目统计、delete 保护（PROJECT_NOT_EMPTY / HUMAN_ONLY）。
2. 真机：`dev_project create` 建两个项目 → 分别建任务 → `dev_board project=<名称>` 只出该项目任务 →
   `dev_brief project=<名称>` 抬头正确 → 面板切换器与项目视图显示两项目统计。
3. 面板截图（stub 数据）：两个项目同时显示、项目视图、项目切换菜单、任务抽屉项目下拉。

---

## 11. v3：项目关联空间（DSH workspace）

> 目标：项目可绑定一个 DSH 工作区（用户口中的「空间」）；项目卡显示空间，派给 agent 的
> 会话在该空间打开；看板数据仍按当前工作区存放，空间绑定是项目的属性。向后兼容 v2。

### 11.1 数据（version = 3）

Project 新增：

```json
{
  "workspaceId": "workspace-id 或空串",
  "workspacePath": "/abs/path 或空串",
  "workspaceTitle": "空间显示名或空串"
}
```

- `BOARD_VERSION = 3`。v2→v3 迁移：缺失字段补空串，其余不变；任务、注意力、seq 不受影响。
- 绑定解析（`workspace` 参数）：
  1) 空串 / null → 清空三个字段；
  2) `workspaceRegistry.list()` 中按 **id 精确 → path 精确 → title 忽略大小写** 匹配；
     命中写三字段；未命中抛 `INVALID_INPUT`，提示可用空间（名称/路径）；
  3) registry 不可用 → 只允许清空；绑定请求返回 `UNAVAILABLE` 并说明原因。
- `GET /state`：
  - 每个 project 附 `workspace`：`{id,title,path}` —— 按 `workspaceId` 从 registry 现取，
    找不到用快照，未绑定为 `null`；
  - 顶层新增 `workspaces: [{id,title,path,isBoard}]` 与 `workspacesHow`；
    `isBoard = (path === 当前看板 root)`。
- `GET /meta` 增加 `workspaceBinding: true`。

### 11.2 handoff（派会话）

- 任务所属项目有 `workspaceId` 且该空间仍在 registry → `sessionController.create({workspaceId})`，
  `workspaceHow = '项目空间'`；否则沿用现有 `chooseWorkspace(root)`。
- prompt 中明确「项目：X ｜空间：Y」。

### 11.3 工具

- `dev_project`：`create` / `update` 新增 `workspace`（id / 名称 / 路径；空串=解除绑定）。
  `list` 每项输出「空间：名称｜路径」，并附「可用空间」清单。
- `dev_board view=projects` 每项输出空间名。
- 系统提示词追加：

```text
【项目与空间】项目可绑定 DSH 工作区（空间）：`dev_project update project=<项目> workspace=<空间名或路径>`；
绑定后派给 agent 的会话会在该空间打开。查看可用空间用 `dev_project list`。
```

### 11.4 客户端

- 项目对话框新增「空间」下拉：`不绑定` + `state.workspaces`（`isBoard` 的标「当前空间」）；
  新建项目默认选当前看板空间（若是注册空间）。
- 项目卡底部显示空间 chip（`空间名`；未绑定显示「未绑定空间」）。
- 项目切换器菜单项显示空间名（空间名短时显示）。
- 顶部无空间选择器；看板始终跟随宿主当前工作区（数据目录），空间绑定只影响项目与派会话。
