# Changelog

## 0.3.0 — 2026-11-11

- 项目可绑定 DSH 工作区（空间）：`workspaceId/workspacePath/workspaceTitle`，数据版本 v3，
  v2 旧板自动迁移（绑定为空，不丢项目/任务）。
- 项目卡、切换器菜单显示所属空间；顶部副标题显示「看板空间」；项目对话框新增「空间」下拉
  （默认当前看板空间，支持解绑）。
- 派给 agent 的会话在项目绑定的空间打开；`dev_project` list/create/update 支持 workspace，
  `/state` 返回 `workspaces`（含 isBoard）与每个项目的 `workspace`。
- 系统提示词新增【项目与空间】；`dev_brief` / `HANDOFF_PROMPT` 带空间名。

## 0.2.0 — 2026-11-11

- 新增项目层：任务归属项目，`projects[]` + `tasks[].projectId`；v1 板自动迁移，任务不丢。
- 多项目并行：顶部项目切换器（全部项目 / 单项目，筛选持久化）、新增「项目」视图
  （完成率、各状态计数、最近到期）、任务卡/表格项目标签。
- 新增 `dev_project` 工具（list/create/update；删除仅由人在面板执行）；
  `dev_board` 支持 `project` 过滤与 `view=projects`；`dev_item` 支持 `project`；
  `dev_brief` 按项目；`dev_attention` 支持项目目标。
- 修订：`dev_board` 按项目过滤时抬头统计改为项目范围；`dev_item` 兼容 `project` 写在 `patch` 里。

## 0.1.0 — 2026-11-11

- 首个版本：开发工作台面板（今日 / 看板 / 列表 / 活动、任务抽屉、新建对话框、设置）。
- 5 列看板与状态机、注意力、活动流；SSE 实时 + 15s 轮询兜底。
- agent 工具 `dev_board` / `dev_item` / `dev_attention` / `dev_brief`；
  红线：done、删除、注意力回答只能由人执行。
- 数据落在 `<工作区>/.devwork/board.json`，原子写 + 串行队列 + 坏 JSON 备份。
