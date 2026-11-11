# 市场收录（Marketplace listings）

- 仓库：<https://github.com/wjinxuan/dsh-workbench>
- 包名：`dsh-devwork`（安装命令 `dsh plugin --profile web add github:wjinxuan/dsh-workbench`）
- 许可证：MIT · 无 `preinstall/install/postinstall/prepare` 生命周期脚本
- 分类建议：DSH Market `tools`/`ui`；WhaleHub `web-ui`；awesome-dsh-plugin `tools`
- npm：暂未发布（GitHub 安装即可，市场收录不要求 npm）。

## 已提交

| 市场 | 入口 | 状态 |
|---|---|---|
| DSH STORE（dsh.store） | https://github.com/AI-Scarlett/DSH-Store/issues/1865 | 已提交；机器人自动固定 commit 并做静态预检，等待 Catalog 审核 |
| WhaleHub | https://github.com/vvlife/whalehub-dsh/issues/101 | 已提交，等待维护者审核 |
| DSH Market（dshplugin.io） | https://github.com/tjsdyy/dshplugin/issues/46 | 已提交（该仓库没有 `plugin-submission` 标签，按普通 Issue 提交） |
| awesome-dsh-plugin | fork 分支 `wjinxuan/awesome-dsh-plugin:add-dsh-workbench` 已放好条目 | 仓库需创建满 1 天（2026-11-12 15:12 之后）再开 PR |

## awesome-dsh-plugin PR（满 1 天后执行）

分支已就绪：`wjinxuan/awesome-dsh-plugin:add-dsh-workbench`（含
`data/plugins/wjinxuan__dsh-workbench.yml`）。仓库创建于 2026-11-11 15:12，
满足「满 1 天」后执行：

```bash
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head wjinxuan:add-dsh-workbench \
  --title "Add wjinxuan/dsh-workbench" \
  --body "Adds \`wjinxuan/dsh-workbench\` (\`dsh-devwork\`): a multi-project dev workbench for DeepSeek Harness. Public repo, MIT, \`dsh.bundle.patch\` present, no lifecycle scripts, real working code; verified on DSH Desktop 0.2.2-rc.1."
```

## 条目内容

提交到 `awesome-dsh-plugin/awesome-dsh-plugin`，新增
`data/plugins/wjinxuan__dsh-workbench.yml`：

```yaml
url: https://github.com/wjinxuan/dsh-workbench
name: wjinxuan/dsh-workbench
category: tools
description:
  en: 'Multi-project dev workbench: kanban, today focus, project overview and live status for design, product and engineering tasks, with agent tools that report progress back.'
  zh: '多项目开发工作台：设计/产品/开发任务看板、今日焦点、项目总览与实时状态，agent 通过工具回报进展。'
```

> 仅 `description.en` 必填；描述含 `: ` 时需加引号（上面已加）。

## 重新提交前的检查

```bash
npm run check
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

- 确认 `package.json` 的 `repository` 指向本仓库；
- 确认 `dsh.bundle.patch` 与 `cordis.patch.yml` 内的 id/包名一致（`dsh-devwork`）；
- 市场通常固定到 40 位 commit，推 tag / release 后在 Issue 里可补充版本号。
