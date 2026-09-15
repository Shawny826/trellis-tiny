# 调研：skill 根目录分发模型与 Channel 系统足迹

日期：2026-09-14 · 调研于上游 Trellis v0.6.17 源码（`./Trellis`）

## 1. skill 分发模型（单源多根）

### 源头

所有 skill 模板单源存放于 `packages/cli/src/templates/common/`：

- `common/skills/*.md` — 单文件自动触发 skill 模板（含 `{{占位符}}`）
- `common/bundled-skills/<name>/` — 多文件内置 skill（trellis-meta、trellis-channel 等，含 references/）
- `common/commands/*.md` — 命令模板（start / continue / finish-work），在部分平台折叠为 skill

平台差异在渲染时注入（`configurators/shared.ts` 的 `resolvePlaceholders`）：
`{{CMD_REF:name}}`、`{{EXECUTOR_AI}}`、`{{USER_ACTION_LABEL}}`、`{{CLI_FLAG}}`、`{{PYTHON_CMD}}`、`{{#FLAG}}/{{^FLAG}}` 条件块。

### 分发目标（用户项目内的物理布局）

| 平台 | workflow skill 根 | 命令型 skill（start/continue/finish-work） | 渲染器 |
|---|---|---|---|
| codex | `.agents/skills/`（共享根） | 同根保留（无 hook，需用户可调用入口） | `resolveAllAsSkillsNeutral` |
| dsh | `.agents/skills/`（rank 200） | `.dsh/skills/`（rank 100，仅 3 个入口） | neutral（共享根）/ 平台化（私有根） |
| gemini / pi / kimi | `.agents/skills/`（共享根） | — | neutral |
| zcode | `.zcode/skills/`（私有根） | `.zcode/commands/trellis/`（斜杠命令） | `resolveSkills`（平台化） |
| claude-code | `.claude/skills/`（私有根） | `.claude/commands/trellis/` | 平台化 |

`filterCommands`（shared.ts:391）：`agentCapable && hasHooks` 的平台剔除 `start`（SessionStart hook 已自动注入）。

### 关键实证（本仓库 trellis-tiny 工作区）

- `.agents/skills/`（12 个）与 `.zcode/skills/`（9 个）共有 skill **md5 字节级相同** → 纯物理拷贝，无内容差异。
- 当前 ZCode 会话的 skill 发现列表中，每个 trellis skill 出现**两次**（`.zcode\skills\...` 与 `.agents\skills\...` 双路径）→ **ZCode 同时扫描两根**。结论：`.zcode/skills/` 写入可取消，仅保留 `.agents/skills/` 单一根。
- 风险备忘：双根扫描是当前 ZCode 版本行为，无官方契约。回退方案 = zcode configurator 恢复私有根写入（模板源不变，仅改目标路径）。

## 2. Channel 系统足迹（移除清单依据）

| 位置 | 体量 | 说明 |
|---|---|---|
| `packages/core/src/channel/` | 4,544 行 TS | 事件存储、投递、worker 状态机 |
| `packages/cli/src/commands/channel/` | 8,383 行 TS | channel 命令树、supervisor、store |
| `common/bundled-skills/trellis-channel/` | 1 skill + 5 references | 用户侧入口 |
| `templates/trellis/agents/`（implement.md、check.md） | 2 个 agent | **channel 运行时专属**（"spawned by trellis channel spawn"），非平台子代理 |
| CLI 注册 | `registerChannelCommand` | cli/index.ts |

- `.trellis/agents/` 里的 architect / plan / research 是 Trellis 仓库自身的开发 agent，不分发给用户项目；分发的只有 implement/check 两个（channel 用）。
- **Python 脚本层（`.trellis/scripts/`）对 channel 零依赖**（grep 无命中），可原样保留。
- 平台原生子代理定义（`.zcode/agents/*.md`、`.codex/agents/*.toml`）与 channel 无关，保留。

## 3. 其余体量数据

- `core/src/mem/`：6,087 行（`trellis mem` 会话记忆，D2 决定保留 → 原样移植）
- `core/src/task/`：561 行（task.json schema，CLI `utils/task-json.ts` 依赖 → 移植）
- `common/cli_adapter.py`：~33KB，Python 侧 hook 输入格式适配器，枚举全部 20 平台 → tiny 原样保留（后续任务可裁枚举）
- `scripts/hooks/linear_sync.py`：Linear 集成 → tiny 不拷贝
- 上游 `init.ts` 2,079 行 / `update.ts` 2,924 行：23 平台矩阵的产物，tiny 按 3 平台重写

## 4. workflow.md 面包屑契约（改写 no_task 块的约束）

- `[workflow-state:STATUS]` 块是唯一事实源；`inject-workflow-state.py`（Python 平台）只解析、无内嵌文案。
- STATUS 字符集 `[A-Za-z0-9_-]+`；找不到标签时降级为通用提示（故意可见）。
- 回归不变量（test/regression.test.ts）：每个 `[required · once]` 步骤必须在对应 workflow-state 块中有强制行。
- 改 no_task 块为"默认直通"时必须同步：Request Triage 段、Phase 1.0 的 consent 前提、以及 `trellis-start` skill 触发文案（三者描述同一分流决策）。
