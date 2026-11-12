# dsh-devwork · 页面设计（ui-ux-pro-max 驱动）

> 设计来源：`ui-ux-pro-max` 本地数据集检索（2026-11-11）。
> 检索词与返回：`developer productivity task management kanban dark --design-system`（Flat Design，
> darkness 密度 8、variance 6、motion 5）、`developer tools dark productivity --domain color`
> （Developer Tool / IDE 调色板）、`dark mode dashboard developer tool --domain style`
> （Dark Mode / 高对比）、`dashboard data technical --domain typography`（Mono + Sans）、
> `kanban board drag drop task status --domain ux`（拖拽必须有单指针/键盘替代、实时徽标用
> `role="status"` 且带上下文）、`status change toast reduced motion --domain gsap`
> （动画尊重 `prefers-reduced-motion`，卸载时清理）。
>
> 落点：Harness Web UI 的 `sidebar.panellist` + `main` 槽（不是独立页面/iframe），
> 因此**容器一律继承宿主主题 token**，只有任务类型色与插图使用自有颜色。

## 1. 设计原则

1. **一屏作战台**：面板高度 100%，自身滚动，不带动整页滚动；看板五列各自滚动。
2. **项目是一等公民**：顶部项目切换器（全部 / 单项目）是全局上下文；「项目」视图给跨项目总览，任务卡/表格在全部项目模式下带项目色点标签。
2. **密度优先**：8px 节奏、12–13px 正文、32px 行高；卡片信息三行内说完。
3. **状态即颜色**：类型用 6 色小圆点 + 类型名；状态用列头色条；优先级只在 P0/P1 出现色块。
4. **实时可见**：右上角 live 徽标（实时/轮询/离线）+ 最近同步时间；外部变更轻提示。
5. **不打断**：新建/编辑在抽屉与对话框完成；危险操作（删除、验收）二次确认。
6. **可达**：拖拽不是唯一手段——每张卡有「移动」菜单（键盘可达）；焦点环、`role="status"`
   播报同步、`prefers-reduced-motion` 下取消动效。

## 2. 主题与 token

容器只用宿主 token（带浅色回退，来自 `cordis_inspect_query Theme` 与运行中宿主）：

| 语义 | token |
|---|---|
| 底/面 | `--dsw-alias-bg-base` / `bg-layer-1` / `bg-layer-2` / `bg-layer-3` |
| 线 | `--dsw-alias-border-l1` / `border-l2` |
| 字 | `--dsw-alias-label-primary` / `label-secondary` / `label-tertiary` |
| 主色 | `--dsw-alias-brand-primary`、`--dsw-alias-state-business-primary` |
| 状态 | `state-success-primary` / `state-warn-primary` / `state-error-primary` / `state-idle-primary` |
| 交互 | `--dsw-alias-interactive-bg-hover` / `interactive-bg-active` |
| 圆角 | `--dsw-radius-sm` / `--dsw-radius-md` |

内容色（自有，明暗通用，已按白/深底算过对比度）：

- 类型：设计 `#8B5CF6`、产品 `#0284C7`、开发 `#059669`、测试 `#D97706`、调研 `#DB2777`、运维 `#64748B`
- 状态：待办 `#64748B`、进行中 `#059669`、待验收 `#D97706`、受阻 `#DC2626`、完成 `#0D9488`、取消 `#94A3B8`
- 优先级：P0 `#DC2626`、P1 `#EA580C`、P2 `#0284C7`、P3 `#64748B`

## 3. 布局

```
┌──────────────────────────────────────────────────────────┐
│ 品牌 · 工作区  [项目切换▾]  今日 看板 列表 项目 活动  ●实时 [新建] │ 56px
├──────────────────────────────────────────────────────────┤
│ 今日：注意力横幅 → 指标条(5) → 进行中卡片 → 到期/逾期/待验收/受阻/停滞 │
│ 看板：过滤条 → 五列（列头计数+WIP），卡片带项目色点                   │
│ 列表：搜索 + 筛选 → 紧凑表格（含项目列）                             │
│ 项目：项目卡网格（状态/进度/各状态计数/最近到期/新建卡）              │
│ 活动：按天分组的时间线（按当前项目过滤）                             │
└──────────────────────────────────────────────────────────┘
                    右抽屉（任务详情 540px） / 项目对话框
```

### 3.1 项目切换器

- 触发器：色点 + 名称（全部项目 / 项目名）+ 未完成数 + 下拉箭头，最大宽 210px，窄屏缩到 160px。
- 菜单：全部项目（项目数 · 未完成数）→ 分隔线 → 每个项目（色点 + 名称 + 未完成数，选中态高亮）→ 分隔线 → 新建项目 / 管理项目。键盘可开合（Esc 关闭）。
- 筛选持久化：`localStorage['dsh-devwork:project']`；项目被删时自动回退「全部项目」。

### 3.2 项目视图与项目卡

- 网格 `auto-fill minmax(280px,1fr)`，卡片左侧 3px 项目色条。
- 卡头：色点 + 名称 + 状态胶囊（进行中绿 / 已暂停琥珀 / 已结束灰）+ 「更多」菜单（编辑 / 删除）。
- 卡身：说明两行截断 → 完成率进度条 + 百分比 → 互斥状态计数（待办 / 进行中 / 待验收 / 受阻 / 完成）→ 底部「空间 chip + 任务数 + 最近到期」。空间 chip 显示绑定的 DSH 工作区名（未绑定显示「未绑定空间」）。
- 项目对话框新增「空间」下拉：不绑定 + `state.workspaces`（当前看板空间标「当前空间」并显示路径），新建项目默认当前看板空间；说明「派给 agent 的会话会在该空间打开」。顶部副标题显示「看板空间：<空间名> · <路径>」。
- 「新建项目」虚线卡；项目对话框：名称、8 色色板、状态（编辑时）、说明、删除（人二次确认，有任务时再确认移到「未归属」）。

### 3.3 项目标签

- 任务卡/表格里 `色点 + 名称`（>9 字截断），浅色底 + 1px 边框；「全部项目」模式才显示，切到单项目后隐藏（减少冗余）。

## 4. 组件规格

- **LiveBadge**：8px 圆点 + 文本「实时/轮询中/离线」；实时态呼吸动画 1.6s，`reduced-motion` 关闭。
- **指标条**：等宽数字 + 迷你进度环（本周完成率），点击跳对应筛选。
- **任务卡**：类型圆点+类型名 / 优先级 / 「更多」菜单；标题两行截断；元信息行（到期、清单 n/m、
  附件数）；进行中卡片带进度条与已用时长；底部负责人首字母与相对更新时间。
- **列头**：状态色条 + 名称 + 计数胶囊；进行中列显示 WIP 使用条（超限变警示色）。
- **抽屉**：标题即编辑框；状态/类型/优先级三段选择；负责人、到期、工时、进度；描述；
  检查清单；交付物；关联会话；该任务的活动流；底部 agent 动作（执行/复核/拆解）+ 删除。
- **空状态**：内联 SVG 看板插图 + 「新建任务」「让 agent 拆解」。
- **Toast**：底部居中，3 秒自动消失，`aria-live="polite"`。

## 5. 交互与实时

- 轮询兜底 15s（页面隐藏暂停）；SSE 连上后立即刷新，`rev` 变化才弹「看板已同步」。
- 拖拽：HTML5 DnD，`dragover` 才高亮投放列；投放后乐观更新，失败回滚并 toast。
- 键盘：`n` 新建、`1–5` 切视图、`Esc` 关抽屉/对话框；卡片 `Enter` 打开；项目切换器可键盘开合。
- 键盘移动：卡片菜单「移到 …」列出全部允许状态（服务端状态机同源）。
- 验收与删除：抽屉内二次确认；agent 无这两条路径（红线）。

## 7. 主题系统（v0.4）

- 四个选项：**跟随宿主**（默认，沿用宿主 token）、**海洋**、**日落**、**森林**。
- 实现：`.dw-root[data-dw-theme][data-dw-tone]` 上覆盖 `--dw-accent / --dw-accent-2 /
  --dw-on-accent / --dw-brand / --dw-on-brand / --dw-accent-soft / --dw-focus`；其余 token 仍取宿主。
- **明暗自适应**：用 `getComputedStyle(documentElement)` 读 `--dsw-alias-label-primary` 的亮度，
  判定 `dark/light` 后套对应一套强调色（深底用亮强调色 + 深色按钮字，浅底用深强调色 + 白字），
  并监听 DOM 属性变化 + 每 5s 复查一次。
- 主题只影响强调色与氛围：页头/主区渐变、品牌渐变标题、主按钮、活动页签、进度条、
  状态色列头/列背景、统计图标、项目卡悬停光晕、表头与抽屉轻着色；语义色（成功/警告/危险）不变。
- 选择持久化：`localStorage['dsh-devwork:theme']`；未知值回退 `host`。
- 无障碍：对比度按 A/AA 选取（深底亮色配深字，浅底深色配白字）；`prefers-reduced-motion` 下动效关闭；
  主题按钮有 `aria-pressed`。

## 6. 自检清单（交付前）

- [x] 无 emoji 作图标，统一 24×24 stroke 1.8 SVG（自绘，无外部依赖）
- [x] 只用宿主主题 token 做容器；明暗主题均通过回退色可读
- [x] 可点击元素 `cursor:pointer` + hover/active/focus 三态
- [x] 拖拽有按钮/菜单替代；`role="status"` 播报同步与错误
- [x] `prefers-reduced-motion: reduce` 关闭动画
- [x] 宽 900px 以下看板转横向滚动，最小列宽 240px
- [x] 项目筛选跨刷新保留；项目删除后自动回退「全部项目」
- [x] 项目色仅用于色点/色条/边框，文字仍用宿主 token，明暗主题均通过
