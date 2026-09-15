# trellis-tiny

Trellis 的精简发行版：只保留日常使用所需的平台与工作流，去掉维护负担。
上游完整版见 [Trellis](https://github.com/mindfoldhq/trellis)（v0.6.17 参照源）。

## 安装

```bash
npm i -g trellis-tiny
# 或
pnpm i -g trellis-tiny
```

安装后提供 `tt` 命令（别名 `trellis-tiny`）。要求 Node ≥ 18.17、Python ≥ 3.9。

## 初始化

在项目根目录执行：

```bash
tt init                 # 交互式选择平台（默认勾选 zcode + codex）
tt init --zcode --codex # 显式指定平台，可组合 --dsh
tt init --dry-run       # 只打印计划（含上游遗留收敛清单），不写不删
```

- 支持平台：`--zcode`、`--codex`、`--dsh`（claude-code 为休眠扩展位，`--claude` 仅提示）。
- 在被上游 Trellis 初始化过的项目里，init 会检测并清理上游遗留（如 `.zcode/skills/`、
  channel skill、Linear 脚本），用户数据（`.trellis/tasks|workspace|spec`）不动。
- init 会写 `.trellis/` 工作流骨架、所选平台目录，以及唯一的 skill 根
  `.agents/skills/`（三个平台共用；dsh 另有 `.dsh/skills/` 三个命令入口）。

## 两档工作流

- **直通档（默认）**：简单任务（单包、少量文件、无架构影响、可即时验证）不建任务目录、
  不写 PRD。AI 直接：加载 `trellis-before-dev` 相关 spec → inline 实现 → `trellis-check` 验证。
- **任务制**：复杂 / 多交付物 / 有架构影响的任务，走完整三阶段
  （brainstorm → prd/design/implement → implement/check → finish）。
  用户任意一轮说"升级为任务"即可从头建任务。

## 其他命令

- `tt update` — 按 `.trellis/.template-hashes.json` 三方对比刷新模板；你改过的文件会先询问
  （保留 / 覆盖 / 存 .new），非交互环境默认保留并报告；幂等，无变更时零写入。
- `tt uninstall` — 按清单逆向删除 tiny 写入的所有文件；`.trellis/tasks|workspace|spec` 与
  `.gitattributes` 保留。
- `tt mem` — 会话记忆检索（跨会话找"上次怎么解决的"），供 `trellis-session-insight` skill 调用。

## 与上游 Trellis 的差异

- 平台矩阵 21 → 3：仅 zcode / codex / dsh（claude-code 留休眠扩展位）。
- skill 单一根：只写 `.agents/skills/`，不再双根分发（每会话少 9 个重复条目）。
- 零任务直通档：简单任务不再强制建任务目录。
- 移除 Channel 多 Agent 协作系统及 ablate/restore、远程模板体系、workflow 命令。
- 模板升级不走迁移体系：`tt update` 基于 hash 清单做三方对比，升级换版本直接
  `npm i -g trellis-tiny@latest`。

## 许可

AGPL-3.0-only（与上游一致），见 [LICENSE](./LICENSE)。
